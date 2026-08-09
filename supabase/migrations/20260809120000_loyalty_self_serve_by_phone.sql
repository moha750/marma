-- بطاقة الولاء بلا وسيط: العميل يجلبها برقم جواله من صفحة الحجز.
--
-- قبل اليوم كان الطريق الوحيد أن يفتح المالكُ واتساب ويُرسل الرابط بيده — فمن
-- أُصدرت بطاقته ولم يُرسَل له شيء، لديه بطاقةٌ لا يعلم بوجودها.
--
-- لماذا رقم الجوال وحده؟ لأنه سقف هذا المنتج القائم أصلاً: نفس الرقم يكشف
-- حجوزات العميل ويُلغيها (list_customer_bookings / cancel_booking_by_phone).
-- فالإضافة متّسقة مع قرارٍ سابق لا انحدارٌ عنه. ومن عرف رقم جوال عميل وصل
-- إلى بطاقته — وهذا ثمنٌ مقبولٌ عن قصد، لا سهوٌ.

-- ─── ١) الدالة العامة: أضف loyalty_active ────────────────────────────────
-- الشرط شرطان معاً: الباقة تسمح (tenants.loyalty_enabled) والبرنامج مُفعَّل.
-- وهذا المفتاح **لا يتبع** show_manage_banner: ذاك يخفي باب إلغاء الحجوزات
-- ليمنع العميل من العبث بتقويم المالك، وهذا يفتح باب توزيعٍ يريده المالك.
-- غرضان متعاكسان، فمفتاحان لا واحد.
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
         subscription_status, loyalty_enabled
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
    'is_active',           v_is_active,
    'subscription_status', v_tenant.subscription_status,
    'fields',              v_fields
  );
END;
$function$;

-- ─── ٢) بطاقة العميل برقم جواله ──────────────────────────────────────────
-- تُرجع القدر الذي يرسم الشريط ويفتح الباب: التسلسلي والتقدّم وهوية البطاقة.
-- وتُسقط redeem_pin ورمز المكافأة عمداً — لا يحتاجهما هذا السطح، وأصغرُ
-- حمولةٍ تكفي هي القاعدة. (وليست حاجزاً أمنياً: التسلسلي نفسه مفتاح كل شيء،
-- ومن بلغه بلغ البطاقة كاملةً في المحفظة. الحاجز هو قرار «الجوال يكفي»
-- المذكور أعلاه، لا هذه الحمولة.)
CREATE OR REPLACE FUNCTION public.loyalty_card_by_phone(
  p_tenant_id uuid,
  p_phone     text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_phone   text;
  v_card    record;
  v_prog    record;
  v_rewards integer;
BEGIN
  v_phone := btrim(COALESCE(p_phone, ''));
  IF v_phone = '' THEN
    RAISE EXCEPTION 'PHONE_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_prog FROM public.loyalty_programs
   WHERE tenant_id = p_tenant_id AND is_active;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- من ألغى اشتراكه لا بطاقة له هنا — لا نُعيده إلى برنامجٍ خرج منه
  SELECT c.* INTO v_card
    FROM public.loyalty_cards c
    JOIN public.customers cu ON cu.id = c.customer_id
   WHERE c.tenant_id = p_tenant_id
     AND cu.phone = v_phone
     AND cu.loyalty_opt_out_at IS NULL
     AND c.status = 'active';
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT count(*) INTO v_rewards FROM public.loyalty_rewards
   WHERE card_id = v_card.id AND status = 'available';

  RETURN jsonb_build_object(
    'serial',            v_card.serial,
    'balance',           v_card.balance,
    'threshold',         v_prog.reward_threshold,
    'rewards_available', v_rewards,
    'program', jsonb_build_object(
      'name',        v_prog.name,
      'reward',      v_prog.reward_label,
      'template',    v_prog.template,
      'brand_bg',    v_prog.brand_bg,
      'brand_fg',    v_prog.brand_fg,
      'brand_label', v_prog.brand_label,
      'logo_url',    v_prog.logo_url
    )
  );
END $$;

revoke all on function public.loyalty_card_by_phone(uuid, text) from public;
grant execute on function public.loyalty_card_by_phone(uuid, text) to anon, authenticated;
