-- تراجع عن إضافة هوية المالك (logo/cover/about) في صفحة الحجز.
-- ملاحظة: bucket tenant-branding و ملفاته يبقيان (Supabase لا تسمح بحذفهما من SQL).
-- لحذفهما يدوياً: Dashboard → Storage → tenant-branding → Delete bucket.

DROP POLICY IF EXISTS "tenant_branding_public_read"   ON storage.objects;
DROP POLICY IF EXISTS "tenant_branding_tenant_insert" ON storage.objects;
DROP POLICY IF EXISTS "tenant_branding_tenant_update" ON storage.objects;
DROP POLICY IF EXISTS "tenant_branding_tenant_delete" ON storage.objects;

ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_about_length;
ALTER TABLE public.tenants
  DROP COLUMN IF EXISTS logo_url,
  DROP COLUMN IF EXISTS cover_image_url,
  DROP COLUMN IF EXISTS about;

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
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_is_active := public.is_tenant_active(p_tenant_id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',           f.id,
    'name',         f.name,
    'city',         f.city,
    'phone',        f.phone,
    'location_url', f.location_url,
    'latitude',     f.latitude,
    'longitude',    f.longitude,
    'image_url',    f.image_url
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
$function$;;