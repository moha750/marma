-- بانر «هل لديك حجز سابق؟» في صفحة الحجز العامة — يتحكم المالك بإظهاره من الإعدادات.
-- الافتراضي true حفاظًا على السلوك الحالي لكل الملاعب القائمة.

alter table public.tenants add column if not exists show_manage_banner boolean not null default true;

-- ─── الدالة العامة: أضف show_manage_banner (نسخة 20260705002906_tenant_logo + سطران) ───
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
  SELECT id, name, description, cover_image_url, logo_url, show_manage_banner, subscription_status
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
    'logo_url',            v_tenant.logo_url,
    'show_manage_banner',  COALESCE(v_tenant.show_manage_banner, true),
    'is_active',           v_is_active,
    'subscription_status', v_tenant.subscription_status,
    'fields',              v_fields
  );
END;
$function$;
