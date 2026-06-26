-- 1. حذف الفترات الموجودة (لا توجد بيانات إنتاج) لتجنب NULL في field_id
DELETE FROM public.working_periods;

-- 2. إضافة field_id (لكل أرضية فتراتها)
ALTER TABLE public.working_periods
  ADD COLUMN field_id uuid NOT NULL REFERENCES public.fields(id) ON DELETE CASCADE;

-- 3. تحديث الفهارس
DROP INDEX IF EXISTS idx_working_periods_tenant_day;
CREATE INDEX idx_working_periods_field_day ON public.working_periods(field_id, day_of_week);
CREATE INDEX idx_working_periods_tenant ON public.working_periods(tenant_id);

-- 4. get_available_slots: الاستعلام يصبح حسب field_id بدل tenant_id
DROP FUNCTION IF EXISTS public.get_available_slots(uuid, uuid, date);

CREATE FUNCTION public.get_available_slots(
  p_tenant_id uuid,
  p_field_id uuid,
  p_date date
)
RETURNS TABLE (
  slot_start timestamptz,
  slot_end timestamptz,
  is_available boolean,
  is_past boolean,
  slot_duration_minutes int,
  slot_price numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_field record;
  v_period record;
  v_target_dow int;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_slot_start timestamptz;
  v_slot_end timestamptz;
  v_min_future timestamptz;
BEGIN
  SELECT id, tenant_id, is_active
  INTO v_field
  FROM public.fields
  WHERE id = p_field_id AND tenant_id = p_tenant_id AND is_active = true;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_target_dow := EXTRACT(DOW FROM p_date)::int;
  v_min_future := now() + interval '1 hour';

  FOR v_period IN
    SELECT wp.open_time, wp.close_time, wp.slot_duration_minutes AS duration, wp.hourly_price AS price
    FROM public.working_periods wp
    WHERE wp.field_id = p_field_id AND wp.day_of_week = v_target_dow
    ORDER BY wp.open_time
  LOOP
    v_day_start := (p_date::text || ' ' || v_period.open_time::text)::timestamptz;
    IF v_period.close_time <= v_period.open_time THEN
      v_day_end := ((p_date + 1)::text || ' ' || v_period.close_time::text)::timestamptz;
    ELSE
      v_day_end := (p_date::text || ' ' || v_period.close_time::text)::timestamptz;
    END IF;

    v_slot_start := v_day_start;
    WHILE v_slot_start < v_day_end LOOP
      v_slot_end := v_slot_start + make_interval(mins => v_period.duration);
      EXIT WHEN v_slot_end > v_day_end;

      slot_start := v_slot_start;
      slot_end := v_slot_end;
      slot_duration_minutes := v_period.duration;
      slot_price := round(((v_period.duration / 60.0) * v_period.price)::numeric, 2);
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
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.get_available_slots(uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_available_slots(uuid, uuid, date) TO anon, authenticated;

-- 5. create_pending_booking: يستعلم بـ field_id
DROP FUNCTION IF EXISTS public.create_pending_booking(uuid, uuid, timestamptz, text, text, text);

CREATE FUNCTION public.create_pending_booking(
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
  v_target_date date;
  v_target_time time;
  v_target_dow int;
  v_period record;
  v_day_start timestamptz;
  v_delta_seconds numeric;
  v_slot_seconds int;
  v_matched_duration int;
  v_matched_price numeric;
  v_matched boolean := false;
BEGIN
  v_clean_name := btrim(p_customer_name);
  v_clean_phone := btrim(p_customer_phone);

  IF v_clean_name IS NULL OR v_clean_name = '' THEN
    RAISE EXCEPTION 'اسم العميل مطلوب' USING ERRCODE = 'P0001';
  END IF;
  IF v_clean_phone IS NULL OR v_clean_phone = '' THEN
    RAISE EXCEPTION 'رقم الجوال مطلوب' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, tenant_id, name, is_active
  INTO v_field
  FROM public.fields
  WHERE id = p_field_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الأرضية غير موجودة' USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_field.is_active THEN
    RAISE EXCEPTION 'هذه الأرضية غير متاحة للحجز حالياً' USING ERRCODE = 'P0001';
  END IF;

  IF p_start_time < now() + interval '1 hour' THEN
    RAISE EXCEPTION 'يجب الحجز قبل ساعة على الأقل من الموعد' USING ERRCODE = 'P0001';
  END IF;

  v_target_date := p_start_time::date;
  v_target_time := p_start_time::time;
  v_target_dow := EXTRACT(DOW FROM v_target_date)::int;

  -- البحث في فترات اليوم نفسه لهذه الأرضية
  FOR v_period IN
    SELECT wp.open_time, wp.close_time, wp.slot_duration_minutes AS duration, wp.hourly_price AS price
    FROM public.working_periods wp
    WHERE wp.field_id = p_field_id AND wp.day_of_week = v_target_dow
  LOOP
    v_slot_seconds := v_period.duration * 60;
    IF v_period.close_time > v_period.open_time THEN
      IF v_target_time >= v_period.open_time AND v_target_time < v_period.close_time THEN
        v_day_start := (v_target_date::text || ' ' || v_period.open_time::text)::timestamptz;
        v_delta_seconds := EXTRACT(EPOCH FROM (p_start_time - v_day_start));
        IF v_delta_seconds >= 0 AND (v_delta_seconds::int % v_slot_seconds) = 0
           AND p_start_time + make_interval(mins => v_period.duration) <=
               (v_target_date::text || ' ' || v_period.close_time::text)::timestamptz THEN
          v_matched_duration := v_period.duration;
          v_matched_price := v_period.price;
          v_matched := true;
          EXIT;
        END IF;
      END IF;
    ELSE
      IF v_target_time >= v_period.open_time THEN
        v_day_start := (v_target_date::text || ' ' || v_period.open_time::text)::timestamptz;
        v_delta_seconds := EXTRACT(EPOCH FROM (p_start_time - v_day_start));
        IF v_delta_seconds >= 0 AND (v_delta_seconds::int % v_slot_seconds) = 0
           AND p_start_time + make_interval(mins => v_period.duration) <=
               ((v_target_date + 1)::text || ' ' || v_period.close_time::text)::timestamptz THEN
          v_matched_duration := v_period.duration;
          v_matched_price := v_period.price;
          v_matched := true;
          EXIT;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- فترات overnight من اليوم السابق
  IF NOT v_matched THEN
    FOR v_period IN
      SELECT wp.open_time, wp.close_time, wp.slot_duration_minutes AS duration, wp.hourly_price AS price
      FROM public.working_periods wp
      WHERE wp.field_id = p_field_id
        AND wp.day_of_week = ((v_target_dow - 1 + 7) % 7)
        AND wp.close_time <= wp.open_time
    LOOP
      v_slot_seconds := v_period.duration * 60;
      IF v_target_time < v_period.close_time THEN
        v_day_start := ((v_target_date - 1)::text || ' ' || v_period.open_time::text)::timestamptz;
        v_delta_seconds := EXTRACT(EPOCH FROM (p_start_time - v_day_start));
        IF v_delta_seconds >= 0 AND (v_delta_seconds::int % v_slot_seconds) = 0
           AND p_start_time + make_interval(mins => v_period.duration) <=
               (v_target_date::text || ' ' || v_period.close_time::text)::timestamptz THEN
          v_matched_duration := v_period.duration;
          v_matched_price := v_period.price;
          v_matched := true;
          EXIT;
        END IF;
      END IF;
    END LOOP;
  END IF;

  IF NOT v_matched THEN
    RAISE EXCEPTION 'الموعد المختار غير صالح حسب فترات العمل' USING ERRCODE = 'P0001';
  END IF;

  v_end_time := p_start_time + make_interval(mins => v_matched_duration);
  v_total_price := round(((v_matched_duration / 60.0) * v_matched_price)::numeric, 2);

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

-- 6. set_day_periods: يستلم field_id ويتحقق من ملكيته
DROP FUNCTION IF EXISTS public.set_day_periods(int, jsonb);

CREATE FUNCTION public.set_day_periods(
  p_field_id uuid,
  p_day_of_week int,
  p_periods jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_field record;
  v_period jsonb;
  v_count int := 0;
BEGIN
  v_tenant_id := public.get_my_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'غير مصرّح' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'هذه العملية متاحة للمالك فقط' USING ERRCODE = 'P0001';
  END IF;
  IF p_day_of_week < 0 OR p_day_of_week > 6 THEN
    RAISE EXCEPTION 'يوم غير صحيح' USING ERRCODE = 'P0001';
  END IF;

  -- التحقق أن الأرضية تتبع tenant المستخدم
  SELECT id, tenant_id INTO v_field
  FROM public.fields
  WHERE id = p_field_id AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الأرضية غير موجودة' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.working_periods
  WHERE field_id = p_field_id AND day_of_week = p_day_of_week;

  IF p_periods IS NULL OR jsonb_typeof(p_periods) <> 'array' THEN
    RETURN jsonb_build_object('inserted', 0);
  END IF;

  FOR v_period IN SELECT * FROM jsonb_array_elements(p_periods)
  LOOP
    INSERT INTO public.working_periods (
      tenant_id, field_id, day_of_week, open_time, close_time,
      slot_duration_minutes, hourly_price
    )
    VALUES (
      v_tenant_id,
      p_field_id,
      p_day_of_week,
      (v_period->>'open')::time,
      (v_period->>'close')::time,
      COALESCE((v_period->>'duration')::int, 60),
      COALESCE((v_period->>'price')::numeric, 0)
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.set_day_periods(uuid, int, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_day_periods(uuid, int, jsonb) TO authenticated;
;