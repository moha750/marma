-- إصلاح أمني: إزالة phone_last4 من get_booking_for_customer لأنها كانت تفضح
-- التحقق المطلوب في cancel_booking_by_customer.

CREATE OR REPLACE FUNCTION public.get_booking_for_customer(
  p_tenant_id uuid,
  p_booking_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', b.id,
    'status', b.status,
    'start_time', b.start_time,
    'end_time', b.end_time,
    'total_price', b.total_price,
    'paid_amount', b.paid_amount,
    'field_name', f.name,
    'field_city', f.city,
    'tenant_name', t.name,
    'cancelled_at', b.cancelled_at,
    'cancelled_by', b.cancelled_by,
    'is_cancellable', (b.status IN ('pending','confirmed') AND b.start_time > now())
  ) INTO v_row
  FROM public.bookings b
  JOIN public.fields f ON f.id = b.field_id
  JOIN public.tenants t ON t.id = b.tenant_id
  WHERE b.id = p_booking_id AND b.tenant_id = p_tenant_id;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_row;
END $$;;