-- ════════════════════════════════════════════════════════════════
-- صفحة هبوط المنشأة + تفاصيل الأرضية: حقول محتوى غنية
-- يضيف description/cover للـ tenant و description/surface/amenities للـ field
-- ثم يحدّث get_public_tenant_info ليُرجع كل ذلك في payload واحد.
-- ════════════════════════════════════════════════════════════════

-- 1) Tenant: وصف + صورة غلاف
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS description     TEXT,
  ADD COLUMN IF NOT EXISTS cover_image_url TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_description_max_len') THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_description_max_len
      CHECK (description IS NULL OR length(description) <= 600);
  END IF;
END $$;

-- 2) Field: وصف + نوع الأرضية + مزايا
ALTER TABLE public.fields
  ADD COLUMN IF NOT EXISTS description  TEXT,
  ADD COLUMN IF NOT EXISTS surface_type TEXT,
  ADD COLUMN IF NOT EXISTS amenities    TEXT[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fields_description_max_len') THEN
    ALTER TABLE public.fields
      ADD CONSTRAINT fields_description_max_len
      CHECK (description IS NULL OR length(description) <= 600);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fields_surface_type_allowed') THEN
    ALTER TABLE public.fields
      ADD CONSTRAINT fields_surface_type_allowed
      CHECK (surface_type IS NULL OR surface_type IN
        ('natural_grass','artificial_grass','indoor','court'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fields_amenities_max_count') THEN
    ALTER TABLE public.fields
      ADD CONSTRAINT fields_amenities_max_count
      CHECK (array_length(amenities, 1) IS NULL OR array_length(amenities, 1) <= 12);
  END IF;
END $$;

-- 3) لا نُنشئ bucket جديد — نعيد استخدام field-images ببادئة `${tenant_id}/_tenant/...`.
--    السياسات الموجودة تطابق (storage.foldername(name))[1] = tenant_id::text
--    لذا المسار مسموح به للمالك/الموظف ومقروء عاماً (public booking).

-- 4) تحديث get_public_tenant_info ليُرجع الحقول الجديدة
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
  SELECT id, name, description, cover_image_url, subscription_status
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
    'image_urls',   COALESCE(f.image_urls, '{}'),
    'description',  f.description,
    'surface_type', f.surface_type,
    'amenities',    COALESCE(f.amenities, '{}')
  ) ORDER BY f.name), '[]'::jsonb) INTO v_fields
  FROM public.fields f
  WHERE f.tenant_id = p_tenant_id AND f.is_active = true;

  RETURN jsonb_build_object(
    'id',                  v_tenant.id,
    'name',                v_tenant.name,
    'description',         v_tenant.description,
    'cover_image_url',     v_tenant.cover_image_url,
    'is_active',           v_is_active,
    'subscription_status', v_tenant.subscription_status,
    'fields',              v_fields
  );
END;
$function$;
