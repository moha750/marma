-- 1. إضافة إعدادات المواعيد إلى الأرضيات
ALTER TABLE public.fields
  ADD COLUMN slot_duration_minutes int NOT NULL DEFAULT 60
    CHECK (slot_duration_minutes IN (30, 45, 60, 75, 90, 105, 120, 150, 180)),
  ADD COLUMN opening_time time NOT NULL DEFAULT '16:00',
  ADD COLUMN closing_time time NOT NULL DEFAULT '02:00';

-- 2. تنظيف الحجوزات (لا توجد حجوزات إنتاج)
DELETE FROM public.bookings;

-- 3. حذف RPC القديمة التي حلّت محلها get_available_slots
DROP FUNCTION IF EXISTS public.get_field_busy_slots(uuid, uuid, date);

-- 4. RPC جديدة: توليد كل المواعيد لأرضية في تاريخ معين
CREATE OR REPLACE FUNCTION public.get_available_slots(
  p_tenant_id uuid,
  p_field_id uuid,
  p_date date
)
RETURNS TABLE (
  slot_start timestamptz,
  slot_end timestamptz,
  is_available boolean,
  is_past boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_field record;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_slot_start timestamptz;
  v_slot_end timestamptz;
  v_min_future timestamptz;
BEGIN
  -- التحقق من الأرضية
  SELECT id, tenant_id, name, hourly_price, is_active,
         slot_duration_minutes, opening_time, closing_time
  INTO v_field
  FROM public.fields
  WHERE id = p_field_id AND tenant_id = p_tenant_id AND is_active = true;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- حساب بداية ونهاية يوم العمل (مع التعامل مع تجاوز منتصف الليل)
  v_day_start := (p_date::text || ' ' || v_field.opening_time::text)::timestamptz;
  IF v_field.closing_time <= v_field.opening_time THEN
    v_day_end := ((p_date + 1)::text || ' ' || v_field.closing_time::text)::timestamptz;
  ELSE
    v_day_end := (p_date::text || ' ' || v_field.closing_time::text)::timestamptz;
  END IF;

  v_min_future := now() + interval '1 hour';
  v_slot_start := v_day_start;

  -- توليد slots
  WHILE v_slot_start < v_day_end LOOP
    v_slot_end := v_slot_start + make_interval(mins => v_field.slot_duration_minutes);
    EXIT WHEN v_slot_end > v_day_end;

    slot_start := v_slot_start;
    slot_end := v_slot_end;
    is_past := v_slot_start < v_min_future;
    is_available := NOT is_past AND NOT EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.field_id = p_field_id
        AND b.status IN ('pending', 'confirmed', 'completed')
        AND tstzrange(b.start_time, b.end_time, '[)') && tstzrange(v_slot_start, v_slot_end, '[)')
    );
    RETURN NEXT;

    v_slot_start := v_slot_end;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.get_available_slots(uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_available_slots(uuid, uuid, date) TO anon, authenticated;

-- 5. تعديل create_pending_booking: لا يستقبل end_time، يتحقق من slot صحيح
DROP FUNCTION IF EXISTS public.create_pending_booking(uuid, uuid, timestamptz, timestamptz, text, text, text);

CREATE OR REPLACE FUNCTION public.create_pending_booking(
  p_tenant_id uuid,
  p_field_id uuid,
  p_start_time timestamptz,
  p_customer_name text,
  p_customer_phone text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_field record;
  v_customer record;
  v_customer_id uuid;
  v_customer_input_name text;
  v_total_price numeric;
  v_end_time timestamptz;
  v_booking_id uuid;
  v_clean_name text;
  v_clean_phone text;
  v_day_start timestamptz;
  v_delta_seconds numeric;
  v_slot_seconds int;
  v_local_date date;
BEGIN
  v_clean_name := btrim(p_customer_name);
  v_clean_phone := btrim(p_customer_phone);

  IF v_clean_name IS NULL OR v_clean_name = '' THEN
    RAISE EXCEPTION 'اسم العميل مطلوب' USING ERRCODE = 'P0001';
  END IF;
  IF v_clean_phone IS NULL OR v_clean_phone = '' THEN
    RAISE EXCEPTION 'رقم الجوال مطلوب' USING ERRCODE = 'P0001';
  END IF;

  -- التحقق من الأرضية
  SELECT id, tenant_id, name, hourly_price, is_active,
         slot_duration_minutes, opening_time, closing_time
  INTO v_field
  FROM public.fields
  WHERE id = p_field_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الأرضية غير موجودة' USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_field.is_active THEN
    RAISE EXCEPTION 'هذه الأرضية غير متاحة للحجز حالياً' USING ERRCODE = 'P0001';
  END IF;

  -- حساب وقت النهاية تلقائياً من إعدادات الأرضية
  v_end_time := p_start_time + make_interval(mins => v_field.slot_duration_minutes);

  -- التحقق الزمني: ساعة على الأقل
  IF p_start_time < now() + interval '1 hour' THEN
    RAISE EXCEPTION 'يجب الحجز قبل ساعة على الأقل من الموعد' USING ERRCODE = 'P0001';
  END IF;

  -- التحقق أن start_time يطابق slot صحيح (مضاعفات slot_duration من opening_time)
  -- نحسب التاريخ المحلي للحجز ثم نقارن مع opening_time
  v_local_date := p_start_time::date;
  -- لو opening > closing، فالأيام بعد منتصف الليل تنتمي لليوم السابق
  IF v_field.closing_time <= v_field.opening_time
     AND p_start_time::time < v_field.closing_time THEN
    v_local_date := v_local_date - 1;
  END IF;

  v_day_start := (v_local_date::text || ' ' || v_field.opening_time::text)::timestamptz;
  v_delta_seconds := EXTRACT(EPOCH FROM (p_start_time - v_day_start));
  v_slot_seconds := v_field.slot_duration_minutes * 60;

  IF v_delta_seconds < 0 OR (v_delta_seconds::int % v_slot_seconds) <> 0 THEN
    RAISE EXCEPTION 'الموعد المختار غير صالح حسب إعدادات الأرضية' USING ERRCODE = 'P0001';
  END IF;

  -- حساب السعر
  v_total_price := round(((v_field.slot_duration_minutes / 60.0) * v_field.hourly_price)::numeric, 2);

  -- البحث عن العميل / إنشاؤه
  SELECT id, full_name INTO v_customer
  FROM public.customers
  WHERE tenant_id = p_tenant_id AND phone = v_clean_phone;

  IF FOUND THEN
    v_customer_id := v_customer.id;
    IF btrim(v_customer.full_name) <> v_clean_name THEN
      v_customer_input_name := v_clean_name;
    END IF;
  ELSE
    INSERT INTO public.customers (tenant_id, full_name, phone)
    VALUES (p_tenant_id, v_clean_name, v_clean_phone)
    RETURNING id INTO v_customer_id;
  END IF;

  -- إنشاء الحجز
  BEGIN
    INSERT INTO public.bookings (
      tenant_id, field_id, customer_id, start_time, end_time,
      total_price, paid_amount, status, notes, customer_input_name, created_by
    )
    VALUES (
      p_tenant_id, p_field_id, v_customer_id, p_start_time, v_end_time,
      v_total_price, 0, 'pending', NULLIF(btrim(coalesce(p_notes, '')), ''),
      v_customer_input_name, NULL
    )
    RETURNING id INTO v_booking_id;
  EXCEPTION
    WHEN exclusion_violation THEN
      RAISE EXCEPTION 'هذا الموعد محجوز بالفعل على نفس الأرضية' USING ERRCODE = 'P0001';
  END;

  RETURN jsonb_build_object(
    'booking_id', v_booking_id,
    'total_price', v_total_price,
    'end_time', v_end_time,
    'message', 'تم استلام طلب الحجز بنجاح'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_pending_booking(uuid, uuid, timestamptz, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_pending_booking(uuid, uuid, timestamptz, text, text, text) TO anon, authenticated;
;