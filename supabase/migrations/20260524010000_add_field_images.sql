-- معرض صور للأرضية: مصفوفة URLs (الأولى = الغلاف) + bucket في Storage مع سياسات RLS.
-- النمط: bucket عام (قراءة مفتوحة لصفحة الحجز المجهولة)، كتابة/حذف مقيّدة بمالكي/موظفي
-- tenant عبر مطابقة بادئة المسار `${tenant_id}/...` مع profiles.tenant_id.

ALTER TABLE public.fields
  ADD COLUMN IF NOT EXISTS image_urls TEXT[] NOT NULL DEFAULT '{}';

-- حدّ أقصى 8 صور لكل أرضية (يحمي من إفراط في الـ payload العام)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fields_image_urls_max_count'
  ) THEN
    ALTER TABLE public.fields
      ADD CONSTRAINT fields_image_urls_max_count
      CHECK (array_length(image_urls, 1) IS NULL OR array_length(image_urls, 1) <= 8);
  END IF;
END $$;

-- إنشاء bucket إن لم يكن موجوداً (public, حد 5MB, MIME types محددة)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'field-images',
  'field-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- SELECT: قراءة عامة (anonymous public booking page)
DROP POLICY IF EXISTS "field_images_public_read" ON storage.objects;
CREATE POLICY "field_images_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'field-images');

-- INSERT: لمستخدم authenticated إذا كانت بادئة المسار = tenant_id الخاص به في profiles
DROP POLICY IF EXISTS "field_images_tenant_insert" ON storage.objects;
CREATE POLICY "field_images_tenant_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'field-images'
    AND (storage.foldername(name))[1] = (
      SELECT p.tenant_id::text FROM public.profiles p WHERE p.id = auth.uid()
    )
  );

-- UPDATE: نفس الشرط (upsert=true يولّد UPDATE عند الاستبدال)
DROP POLICY IF EXISTS "field_images_tenant_update" ON storage.objects;
CREATE POLICY "field_images_tenant_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'field-images'
    AND (storage.foldername(name))[1] = (
      SELECT p.tenant_id::text FROM public.profiles p WHERE p.id = auth.uid()
    )
  )
  WITH CHECK (
    bucket_id = 'field-images'
    AND (storage.foldername(name))[1] = (
      SELECT p.tenant_id::text FROM public.profiles p WHERE p.id = auth.uid()
    )
  );

-- DELETE: نفس الشرط
DROP POLICY IF EXISTS "field_images_tenant_delete" ON storage.objects;
CREATE POLICY "field_images_tenant_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'field-images'
    AND (storage.foldername(name))[1] = (
      SELECT p.tenant_id::text FROM public.profiles p WHERE p.id = auth.uid()
    )
  );

-- تحديث get_public_tenant_info لتضمين image_urls (مصفوفة) في الـ payload العام
-- (هذا هو المسار الوحيد الذي تقرأ منه صفحة الحجز المجهولة بيانات الأرضيات).
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
    'image_urls',   COALESCE(f.image_urls, '{}')
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
