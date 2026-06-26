-- نقل city + phone من tenants إلى fields
-- المبرر: الـ tenant يمثّل النشاط التجاري/المالك، بينما كل field له موقعه ورقمه الخاصين
-- المالك قد يمتلك ملاعب في مدن مختلفة، فلا معنى لحقل city/phone مفرد على الـ tenant.

-- 1) إضافة الأعمدة الجديدة على fields
ALTER TABLE public.fields
  ADD COLUMN IF NOT EXISTS city  TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT;

-- 2) Backfill: ننقل city/phone من كل tenant إلى أول field له (الأقدم)
WITH first_field AS (
  SELECT DISTINCT ON (tenant_id) id, tenant_id
  FROM public.fields
  ORDER BY tenant_id, created_at, id
)
UPDATE public.fields f
SET city  = COALESCE(f.city,  t.city),
    phone = COALESCE(f.phone, t.phone)
FROM first_field ff
JOIN public.tenants t ON t.id = ff.tenant_id
WHERE f.id = ff.id;

-- 3) إزالة الأعمدة من tenants
ALTER TABLE public.tenants
  DROP COLUMN IF EXISTS city,
  DROP COLUMN IF EXISTS phone;

-- 4) handle_new_user: لا يستخدم city/phone بعد الآن
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_invite_code text;
  v_invitation  record;
  v_tenant_id   uuid;
  v_full_name   text;
  v_tenant_name text;
BEGIN
  v_invite_code := NEW.raw_user_meta_data->>'invite_code';
  v_full_name   := NEW.raw_user_meta_data->>'full_name';
  v_tenant_name := NEW.raw_user_meta_data->>'tenant_name';

  -- إذا لم يُرسل invite_code ولا tenant_name (مثل إنشاء من Supabase Dashboard)،
  -- نسمح بإنشاء auth user فقط بدون tenant/profile.
  IF (v_invite_code IS NULL OR v_invite_code = '')
     AND (v_tenant_name IS NULL OR v_tenant_name = '') THEN
    RETURN NEW;
  END IF;

  -- المسار 1: تسجيل بدعوة موظف
  IF v_invite_code IS NOT NULL AND v_invite_code <> '' THEN
    SELECT id, tenant_id, email, full_name, used_at, expires_at
    INTO v_invitation
    FROM public.staff_invitations
    WHERE code = v_invite_code
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'INVITE_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
    IF v_invitation.used_at IS NOT NULL THEN
      RAISE EXCEPTION 'INVITE_ALREADY_USED' USING ERRCODE = 'P0001';
    END IF;
    IF v_invitation.expires_at <= now() THEN
      RAISE EXCEPTION 'INVITE_EXPIRED' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.profiles (id, tenant_id, full_name, role)
    VALUES (NEW.id, v_invitation.tenant_id, v_invitation.full_name, 'staff');

    UPDATE public.staff_invitations SET used_at = now() WHERE id = v_invitation.id;

    RETURN NEW;
  END IF;

  -- المسار 2: مالك جديد (tenant_name مطلوب)
  IF v_full_name IS NULL OR v_full_name = '' THEN
    RAISE EXCEPTION 'FULL_NAME_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.tenants (name, trial_ends_at, subscription_status)
  VALUES (
    v_tenant_name,
    now() + interval '3 days',
    'trial'
  )
  RETURNING id INTO v_tenant_id;

  INSERT INTO public.profiles (id, tenant_id, full_name, role)
  VALUES (NEW.id, v_tenant_id, v_full_name, 'owner');

  RETURN NEW;
END;
$function$;

-- 5) get_public_tenant_info: city/phone تعود مع كل أرضية، لا tenant
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
    'id',    f.id,
    'name',  f.name,
    'city',  f.city,
    'phone', f.phone
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

-- 6) admin_list_tenants: حذف city/phone، إضافة cities aggregation من fields
DROP FUNCTION IF EXISTS public.admin_list_tenants();

CREATE OR REPLACE FUNCTION public.admin_list_tenants()
RETURNS TABLE(
  id uuid,
  name text,
  cities text,
  trial_ends_at timestamp with time zone,
  subscription_ends_at timestamp with time zone,
  subscription_status text,
  is_active boolean,
  created_at timestamp with time zone,
  last_subscription_at timestamp with time zone
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'NOT_SUPER_ADMIN' USING ERRCODE = 'P0001';
  END IF;
  RETURN QUERY
  SELECT
    t.id,
    t.name,
    (SELECT string_agg(DISTINCT f.city, ' · ' ORDER BY f.city)
       FROM public.fields f
       WHERE f.tenant_id = t.id AND f.city IS NOT NULL AND f.city <> '') AS cities,
    t.trial_ends_at,
    t.subscription_ends_at,
    t.subscription_status,
    public.is_tenant_active(t.id) AS is_active,
    t.created_at,
    (SELECT MAX(s.reviewed_at) FROM public.subscriptions s
     WHERE s.tenant_id = t.id AND s.status = 'approved') AS last_subscription_at
  FROM public.tenants t
  ORDER BY t.created_at DESC;
END;
$function$;
