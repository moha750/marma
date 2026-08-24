-- طريقة دفع: أيبان المالك. اختياريّ — من وضعه ظهر لعميله عند الحجز ليحوّل
-- المبلغ، ومن تركه فارغًا بقيت صفحته كما هي بلا أثر. لا حقلَ ثالثًا يُلزم به.
--
-- القيد على الصيغة السعودية (SA + 22 رقمًا) لا على مجرّد النصّ: الأيبان المعروض
-- للعميل يُنسخ ويُلصق في تطبيق بنكه، فرقمٌ ناقصٌ خطأٌ يقع عند التحويل لا عند
-- الحفظ. والتطبيع (حذف الفراغات ورفع الحروف) في الواجهة قبل الإرسال.

alter table public.tenants add column if not exists payment_iban text;

alter table public.tenants drop constraint if exists tenants_payment_iban_format;
alter table public.tenants add constraint tenants_payment_iban_format
  check (payment_iban is null or payment_iban ~ '^SA[0-9]{22}$');

comment on column public.tenants.payment_iban is
  'أيبان التحويل البنكي — يظهر للعميل في صفحة الحجز العامة عند وجود مبلغ. NULL = المالك لم يفعّل التحويل.';

-- ─── الدالة العامة: أضف payment_iban (نسخة 20260809120000 + سطران) ───
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
  v_loyalty   boolean;
BEGIN
  SELECT id, name, description, cover_image_url, logo_url, show_manage_banner,
         subscription_status, loyalty_enabled, payment_iban
    INTO v_tenant
  FROM public.tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_is_active := public.is_tenant_active(p_tenant_id);

  v_loyalty := COALESCE(v_tenant.loyalty_enabled, false) AND EXISTS (
    SELECT 1 FROM public.loyalty_programs p
     WHERE p.tenant_id = p_tenant_id AND p.is_active
  );

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
    'loyalty_active',      v_loyalty,
    -- الأيبان للملاعب النشطة فقط: صفحة الملعب المعطّل لا تعرض شيئًا أصلًا،
    -- فلا يُسرَّب حسابٌ بنكيّ من حساب متوقّف عبر نداء مباشر للدالة.
    'payment_iban',        CASE WHEN v_is_active THEN v_tenant.payment_iban END,
    'is_active',           v_is_active,
    'subscription_status', v_tenant.subscription_status,
    'fields',              v_fields
  );
END;
$function$;
