-- بوابات الدفع: طريقتان يستعملهما الناس في السعودية فعلًا —
--   (١) تحويل بنكي إلى أيبان (الراجحي، الرياض، الأهلي…)
--   (٢) محفظة رقمية إلى رقم جوال (STC Pay، برق، تيقمو، urpay…)
-- كلٌّ منهما مفتاحٌ مستقلّ: المالك يشغّل ما يقبله ويطفئ ما لا يقبله، والعميل
-- لا يرى إلا المشتغل. ومن لم يشغّل شيئًا بقيت صفحته كما كانت — بلا قسم دفع.
--
-- لماذا مفتاحٌ صريح لا مجرّد «امتلأ الحقل»: إيقافُ طريقةٍ مؤقّتًا (تعطّل حساب،
-- تغيّر رقم) لا يجوز أن يكلّف المالك محوَ بياناته ثم إعادة كتابتها.

alter table public.tenants
  add column if not exists payment_bank_enabled   boolean not null default false,
  add column if not exists payment_bank_name      text,
  add column if not exists payment_wallet_enabled boolean not null default false,
  add column if not exists payment_wallet_phone   text,
  add column if not exists payment_wallets        text[] not null default '{}';

-- رقم المحفظة جوّالٌ سعوديّ: العميل يكتبه في تطبيق محفظته، فصيغةٌ ناقصة خطأٌ
-- يقع عند التحويل لا عند الحفظ — كما في الأيبان تمامًا.
alter table public.tenants drop constraint if exists tenants_payment_wallet_phone_format;
alter table public.tenants add constraint tenants_payment_wallet_phone_format
  check (payment_wallet_phone is null or payment_wallet_phone ~ '^05[0-9]{8}$');

-- قائمة مغلقة: الواجهة تترجم المفتاح إلى اسمٍ وشعار، فمفتاحٌ مجهول = خانةٌ
-- فارغة عند العميل. إضافة محفظةٍ جديدة هجرةٌ سطرها واحد.
alter table public.tenants drop constraint if exists tenants_payment_wallets_known;
alter table public.tenants add constraint tenants_payment_wallets_known
  check (payment_wallets <@ array['stcpay','urpay','barq','tiqmo','alinmapay','d360']::text[]);

alter table public.tenants drop constraint if exists tenants_payment_bank_name_len;
alter table public.tenants add constraint tenants_payment_bank_name_len
  check (payment_bank_name is null or char_length(payment_bank_name) <= 60);

-- من وضع أيبانه قبل هذه الهجرة فقد قصد تشغيل التحويل — لا نُطفئ ما شغّله.
update public.tenants set payment_bank_enabled = true where payment_iban is not null;

comment on column public.tenants.payment_bank_enabled   is 'تشغيل التحويل البنكي في صفحة الحجز.';
comment on column public.tenants.payment_bank_name      is 'اسم البنك كما يُعرض للعميل (اختياري).';
comment on column public.tenants.payment_wallet_enabled is 'تشغيل الدفع بالمحفظة الرقمية في صفحة الحجز.';
comment on column public.tenants.payment_wallet_phone   is 'رقم جوال المحفظة (05XXXXXXXX).';
comment on column public.tenants.payment_wallets        is 'مفاتيح المحافظ التي يستقبل عليها هذا الرقم.';

-- ─── الدالة العامة: كائن payment كامل (نسخة 20260824180000 + بوابتان) ───
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
  v_bank      jsonb;
  v_wallet    jsonb;
BEGIN
  SELECT id, name, description, cover_image_url, logo_url, show_manage_banner,
         subscription_status, loyalty_enabled, payment_iban,
         payment_bank_enabled, payment_bank_name,
         payment_wallet_enabled, payment_wallet_phone, payment_wallets
    INTO v_tenant
  FROM public.tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_is_active := public.is_tenant_active(p_tenant_id);

  v_loyalty := COALESCE(v_tenant.loyalty_enabled, false) AND EXISTS (
    SELECT 1 FROM public.loyalty_programs p
     WHERE p.tenant_id = p_tenant_id AND p.is_active
  );

  -- بواباتٌ للملاعب النشطة فقط: صفحة الملعب الموقوف لا تعرض شيئًا أصلًا، فلا
  -- يُسرَّب حسابٌ بنكيّ ولا رقمُ محفظةٍ من حسابٍ متوقّف عبر نداء مباشر للدالة.
  IF v_is_active AND v_tenant.payment_bank_enabled AND v_tenant.payment_iban IS NOT NULL THEN
    v_bank := jsonb_build_object('iban', v_tenant.payment_iban, 'bank_name', v_tenant.payment_bank_name);
  END IF;

  IF v_is_active AND v_tenant.payment_wallet_enabled
     AND v_tenant.payment_wallet_phone IS NOT NULL
     AND COALESCE(array_length(v_tenant.payment_wallets, 1), 0) > 0 THEN
    v_wallet := jsonb_build_object(
      'phone',     v_tenant.payment_wallet_phone,
      'providers', to_jsonb(v_tenant.payment_wallets)
    );
  END IF;

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
    'payment',             jsonb_build_object('bank', v_bank, 'wallet', v_wallet),
    -- مفتاحٌ قديم يقرأه عميلٌ عالقٌ في كاش نسخةٍ سابقة — يبقى حتى تنقضي نسخته
    'payment_iban',        CASE WHEN v_bank IS NOT NULL THEN v_tenant.payment_iban END,
    'is_active',           v_is_active,
    'subscription_status', v_tenant.subscription_status,
    'fields',              v_fields
  );
END;
$function$;
