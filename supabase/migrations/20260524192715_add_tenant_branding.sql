ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS logo_url        TEXT,
  ADD COLUMN IF NOT EXISTS cover_image_url TEXT,
  ADD COLUMN IF NOT EXISTS about           TEXT;

ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_about_length;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_about_length
  CHECK (about IS NULL OR char_length(about) <= 200)
  NOT VALID;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tenant-branding',
  'tenant-branding',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "tenant_branding_public_read" ON storage.objects;
CREATE POLICY "tenant_branding_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'tenant-branding');

DROP POLICY IF EXISTS "tenant_branding_tenant_insert" ON storage.objects;
CREATE POLICY "tenant_branding_tenant_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'tenant-branding'
    AND (storage.foldername(name))[1] = (
      SELECT p.tenant_id::text FROM public.profiles p WHERE p.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "tenant_branding_tenant_update" ON storage.objects;
CREATE POLICY "tenant_branding_tenant_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'tenant-branding'
    AND (storage.foldername(name))[1] = (
      SELECT p.tenant_id::text FROM public.profiles p WHERE p.id = auth.uid()
    )
  )
  WITH CHECK (
    bucket_id = 'tenant-branding'
    AND (storage.foldername(name))[1] = (
      SELECT p.tenant_id::text FROM public.profiles p WHERE p.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "tenant_branding_tenant_delete" ON storage.objects;
CREATE POLICY "tenant_branding_tenant_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'tenant-branding'
    AND (storage.foldername(name))[1] = (
      SELECT p.tenant_id::text FROM public.profiles p WHERE p.id = auth.uid()
    )
  );

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
  SELECT id, name, subscription_status,
         logo_url, cover_image_url, about
  INTO v_tenant
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
    'logo_url',            v_tenant.logo_url,
    'cover_image_url',     v_tenant.cover_image_url,
    'about',               v_tenant.about,
    'fields',              v_fields
  );
END;
$function$;;