-- إضافة إحداثيات (latitude/longitude) للأرضيات
-- تُستخدم في embed الخريطة في صفحة الحجز بصيغة ?q=lat,lng&output=embed
-- (لا تتطلب مفتاح API، تعرض الدبوس بدقة، ولا تتأثر بروابط maps.app.goo.gl المختصرة).
-- يبقى location_url مخزّناً لاستخدامه في زر "افتح في الخرائط" وحقل LOCATION في ICS.

ALTER TABLE public.fields
  ADD COLUMN IF NOT EXISTS latitude  NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(9,6);

-- ضمان أن أي صف فيه location_url لا بد أن يحوي إحداثيات.
-- NOT VALID: لا يُطبَّق على الصفوف القديمة (تبقى صالحة بـ location_url بلا إحداثيات حتى يُعاد حفظها).
ALTER TABLE public.fields
  ADD CONSTRAINT fields_location_coords_paired
  CHECK (location_url IS NULL OR (latitude IS NOT NULL AND longitude IS NOT NULL))
  NOT VALID;

-- إعادة تعريف get_public_tenant_info لتضمين latitude/longitude في الـ payload العام
CREATE OR REPLACE FUNCTION public.get_public_tenant_info(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant    record;
  v_fields    jsonb;
  v_is_active boolean;
BEGIN
  SELECT id, name, subscription_status INTO v_tenant
  FROM public.tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_is_active := public.is_tenant_active(p_tenant_id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',           f.id,
    'name',         f.name,
    'city',         f.city,
    'phone',        f.phone,
    'location_url', f.location_url,
    'latitude',     f.latitude,
    'longitude',    f.longitude
  ) ORDER BY f.name), '[]'::jsonb) INTO v_fields
  FROM public.fields f
  WHERE f.tenant_id = p_tenant_id AND f.is_active = true;

  RETURN jsonb_build_object(
    'id',                  v_tenant.id,
    'name',                v_tenant.name,
    'is_active',           v_is_active,
    'subscription_status', v_tenant.subscription_status,
    'fields',              v_fields
  );
END;
$function$;
