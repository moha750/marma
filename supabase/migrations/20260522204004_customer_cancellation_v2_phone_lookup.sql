-- إعادة تصميم: البحث برقم الجوال بدل رابط محفوظ
-- نحذف RPCs السابقة (UUID + last4 phone) ونستبدلها بـ list + cancel-by-phone.

DROP FUNCTION IF EXISTS public.get_booking_for_customer(uuid, uuid);
DROP FUNCTION IF EXISTS public.cancel_booking_by_customer(uuid, uuid, text);

-- RPC: قائمة حجوزات العميل القادمة (pending/confirmed) لـ tenant معين
CREATE OR REPLACE FUNCTION public.list_customer_bookings(
  p_tenant_id uuid,
  p_phone text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text;
  v_tenant_name text;
  v_bookings jsonb;
BEGIN
  v_phone := btrim(p_phone);
  IF v_phone IS NULL OR v_phone = '' THEN
    RAISE EXCEPTION 'PHONE_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT name INTO v_tenant_name FROM public.tenants WHERE id = p_tenant_id;
  IF v_tenant_name IS NULL THEN
    RAISE EXCEPTION 'TENANT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(jsonb_agg(row_obj ORDER BY (row_obj->>'start_time')), '[]'::jsonb)
  INTO v_bookings
  FROM (
    SELECT jsonb_build_object(
      'id', b.id,
      'status', b.status,
      'start_time', b.start_time,
      'end_time', b.end_time,
      'total_price', b.total_price,
      'field_name', f.name,
      'field_city', f.city,
      'is_cancellable', (b.status IN ('pending','confirmed') AND b.start_time > now())
    ) AS row_obj
    FROM public.bookings b
    JOIN public.fields f ON f.id = b.field_id
    JOIN public.customers c ON c.id = b.customer_id
    WHERE b.tenant_id = p_tenant_id
      AND c.phone = v_phone
      AND b.status IN ('pending','confirmed')
      AND b.start_time > now()
  ) sub;

  RETURN jsonb_build_object(
    'tenant_name', v_tenant_name,
    'bookings', v_bookings
  );
END $$;

-- RPC: إلغاء حجز عبر مطابقة الجوال الكامل
CREATE OR REPLACE FUNCTION public.cancel_booking_by_phone(
  p_tenant_id uuid,
  p_booking_id uuid,
  p_phone text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_start timestamptz;
  v_phone_match boolean;
  v_clean_phone text;
BEGIN
  v_clean_phone := btrim(p_phone);
  IF v_clean_phone IS NULL OR v_clean_phone = '' THEN
    RAISE EXCEPTION 'PHONE_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT b.status, b.start_time, (c.phone = v_clean_phone)
    INTO v_status, v_start, v_phone_match
  FROM public.bookings b
  JOIN public.customers c ON c.id = b.customer_id
  WHERE b.id = p_booking_id AND b.tenant_id = p_tenant_id;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF NOT v_phone_match THEN
    RAISE EXCEPTION 'PHONE_MISMATCH' USING ERRCODE = '28000';
  END IF;
  IF v_status NOT IN ('pending','confirmed') THEN
    RAISE EXCEPTION 'NOT_CANCELLABLE_STATUS' USING ERRCODE = '22000';
  END IF;
  IF v_start <= now() THEN
    RAISE EXCEPTION 'BOOKING_ALREADY_STARTED' USING ERRCODE = '22000';
  END IF;

  UPDATE public.bookings
     SET status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = 'customer'
   WHERE id = p_booking_id;

  RETURN jsonb_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.list_customer_bookings(uuid, text)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_booking_by_phone(uuid, uuid, text) TO anon, authenticated;;