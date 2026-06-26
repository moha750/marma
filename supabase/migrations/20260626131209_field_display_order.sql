-- ترتيب يدوي للأرضيات (display_order)
-- قبل هذا التحديث كانت الأرضيات تُرتَّب أبجدياً حسب الاسم في كل من لوحة التحكم
-- وصفحة الحجز العامة. هذا التحديث يضيف عمود display_order ليتحكم المالك بالترتيب،
-- مع الإبقاء على الاسم كـ tie-breaker.

-- ─── 1) العمود + الفهرس ────────────────────────────────────
ALTER TABLE public.fields
  ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0;

-- القيد fields_location_coords_paired مُعرّف NOT VALID ويوجد صف قديم مخالف له
-- (location_url موجود بدون إحداثيات). أي UPDATE على ذلك الصف يُعيد فحص القيد فيفشل.
-- لذا نُسقطه مؤقتاً أثناء التعبئة ثم نعيده بنفس التعريف (NOT VALID) للحفاظ على الحالة.
ALTER TABLE public.fields DROP CONSTRAINT IF EXISTS fields_location_coords_paired;

-- تعبئة القيم الحالية: لكل tenant، رتّب أبجدياً حسب الاسم وأعطِ ترتيباً متتابعاً.
WITH ordered AS (
  SELECT id,
         (row_number() OVER (PARTITION BY tenant_id ORDER BY name) - 1) AS rn
  FROM public.fields
)
UPDATE public.fields f
SET display_order = ordered.rn
FROM ordered
WHERE f.id = ordered.id;

ALTER TABLE public.fields
  ADD CONSTRAINT fields_location_coords_paired
  CHECK ((location_url IS NULL) OR (latitude IS NOT NULL AND longitude IS NOT NULL)) NOT VALID;

CREATE INDEX IF NOT EXISTS fields_tenant_display_order_idx
  ON public.fields (tenant_id, display_order);

-- ─── 2) ترتيب صفحة الحجز العامة حسب display_order ──────────
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
  ) ORDER BY f.display_order, f.name), '[]'::jsonb) INTO v_fields
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

-- ─── 3) RPC لحفظ الترتيب الجديد (للمالك فقط) ───────────────
-- تستقبل مصفوفة معرّفات بالترتيب المطلوب وتضبط display_order = موضع كل معرّف.
-- مقيّدة بـ tenant المستخدم؛ المعرّفات الخارجة عن نطاقه تُتجاهَل.
CREATE OR REPLACE FUNCTION public.reorder_fields(p_field_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
BEGIN
  v_tenant_id := public.get_my_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'غير مصرّح' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'هذه العملية متاحة للمالك فقط' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.is_my_tenant_active() THEN
    RAISE EXCEPTION 'TENANT_INACTIVE' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.fields f
  SET display_order = pos.ord
  FROM (
    SELECT id, (ordinality - 1)::int AS ord
    FROM unnest(p_field_ids) WITH ORDINALITY AS t(id, ordinality)
  ) pos
  WHERE f.id = pos.id AND f.tenant_id = v_tenant_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.reorder_fields(uuid[]) TO authenticated;
