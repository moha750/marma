-- 1. إضافة حالة pending إلى الحجوزات
ALTER TABLE public.bookings DROP CONSTRAINT bookings_status_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled'));

-- 2. توسيع قيد منع التعارض ليشمل pending (الحجز المعلق يحجز الوقت)
ALTER TABLE public.bookings DROP CONSTRAINT no_overlapping_bookings;
ALTER TABLE public.bookings ADD CONSTRAINT no_overlapping_bookings
EXCLUDE USING gist (
  field_id WITH =,
  tstzrange(start_time, end_time, '[)') WITH &&
) WHERE (status IN ('pending', 'confirmed', 'completed'));

-- 3. عمود اسم العميل كما أدخله في الحجز العام (إن اختلف عن المسجل)
ALTER TABLE public.bookings ADD COLUMN customer_input_name text;

-- 4. RPC: معلومات الملعب للعرض العام
CREATE OR REPLACE FUNCTION public.get_public_tenant_info(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_tenant record;
  v_fields jsonb;
BEGIN
  SELECT id, name, city INTO v_tenant
  FROM public.tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', f.id,
    'name', f.name,
    'hourly_price', f.hourly_price
  ) ORDER BY f.name), '[]'::jsonb) INTO v_fields
  FROM public.fields f
  WHERE f.tenant_id = p_tenant_id AND f.is_active = true;

  RETURN jsonb_build_object(
    'id', v_tenant.id,
    'name', v_tenant.name,
    'city', v_tenant.city,
    'fields', v_fields
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_tenant_info(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tenant_info(uuid) TO anon, authenticated;

-- 5. RPC: المواعيد المحجوزة لأرضية في تاريخ معين
CREATE OR REPLACE FUNCTION public.get_field_busy_slots(
  p_tenant_id uuid,
  p_field_id uuid,
  p_date date
)
RETURNS TABLE (start_time timestamptz, end_time timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  -- التحقق أن الأرضية تتبع tenant المحدد
  IF NOT EXISTS (
    SELECT 1 FROM public.fields
    WHERE id = p_field_id AND tenant_id = p_tenant_id AND is_active = true
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT b.start_time, b.end_time
  FROM public.bookings b
  WHERE b.field_id = p_field_id
    AND b.status IN ('pending', 'confirmed', 'completed')
    AND b.start_time >= p_date::timestamptz
    AND b.start_time < (p_date + 2)::timestamptz
  ORDER BY b.start_time;
END;
$$;

REVOKE ALL ON FUNCTION public.get_field_busy_slots(uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_field_busy_slots(uuid, uuid, date) TO anon, authenticated;

-- 6. RPC: إنشاء حجز معلّق من العميل العام
CREATE OR REPLACE FUNCTION public.create_pending_booking(
  p_tenant_id uuid,
  p_field_id uuid,
  p_start_time timestamptz,
  p_end_time timestamptz,
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
  v_hours numeric;
  v_booking_id uuid;
  v_clean_name text;
  v_clean_phone text;
BEGIN
  -- تنظيف المدخلات
  v_clean_name := btrim(p_customer_name);
  v_clean_phone := btrim(p_customer_phone);

  IF v_clean_name IS NULL OR v_clean_name = '' THEN
    RAISE EXCEPTION 'اسم العميل مطلوب' USING ERRCODE = 'P0001';
  END IF;
  IF v_clean_phone IS NULL OR v_clean_phone = '' THEN
    RAISE EXCEPTION 'رقم الجوال مطلوب' USING ERRCODE = 'P0001';
  END IF;

  -- التحقق من الأرضية (موجودة + نشطة + تتبع tenant)
  SELECT id, tenant_id, name, hourly_price, is_active
  INTO v_field
  FROM public.fields
  WHERE id = p_field_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الأرضية غير موجودة' USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_field.is_active THEN
    RAISE EXCEPTION 'هذه الأرضية غير متاحة للحجز حالياً' USING ERRCODE = 'P0001';
  END IF;

  -- التحقق الزمني
  IF p_end_time <= p_start_time THEN
    RAISE EXCEPTION 'وقت النهاية يجب أن يكون بعد البداية' USING ERRCODE = 'P0001';
  END IF;
  IF p_start_time < now() + interval '1 hour' THEN
    RAISE EXCEPTION 'يجب الحجز قبل ساعة على الأقل من الموعد' USING ERRCODE = 'P0001';
  END IF;

  -- حساب السعر
  v_hours := EXTRACT(EPOCH FROM (p_end_time - p_start_time)) / 3600.0;
  v_total_price := round((v_hours * v_field.hourly_price)::numeric, 2);

  -- البحث عن عميل بنفس الجوال
  SELECT id, full_name INTO v_customer
  FROM public.customers
  WHERE tenant_id = p_tenant_id AND phone = v_clean_phone;

  IF FOUND THEN
    v_customer_id := v_customer.id;
    -- إذا الاسم مختلف، نخزن الاسم الجديد كاسم مدخل ليراجعه الموظف
    IF btrim(v_customer.full_name) <> v_clean_name THEN
      v_customer_input_name := v_clean_name;
    END IF;
  ELSE
    -- إنشاء عميل جديد
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
      p_tenant_id, p_field_id, v_customer_id, p_start_time, p_end_time,
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
    'message', 'تم استلام طلب الحجز بنجاح'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_pending_booking(uuid, uuid, timestamptz, timestamptz, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_pending_booking(uuid, uuid, timestamptz, timestamptz, text, text, text) TO anon, authenticated;
;