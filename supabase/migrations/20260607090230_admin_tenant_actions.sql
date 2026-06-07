-- لوحة المشرف: تفاصيل المستأجر + إجراءات إدارية (كلها محميّة بـ is_super_admin)

-- 1) تعطيل قابل للعكس عبر علم suspended (بدل العبث بالتواريخ)
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS suspended boolean NOT NULL DEFAULT false;

-- 2) بوابة النشاط تحترم suspended (إضافة آمنة — الافتراضي false فلا تتغيّر السلوكيات القائمة)
CREATE OR REPLACE FUNCTION public.is_tenant_active(p_tenant_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.tenants
    WHERE id = p_tenant_id
      AND NOT COALESCE(suspended, false)
      AND now() < CASE
        WHEN subscription_ends_at IS NOT NULL THEN subscription_ends_at + interval '3 days'
        WHEN trial_ends_at        IS NOT NULL THEN trial_ends_at
        ELSE 'epoch'::timestamptz
      END
  )
$function$;

-- 3) تفاصيل المستأجر (قراءة): المالك + العدّادات + سجلّ الاشتراكات
CREATE OR REPLACE FUNCTION public.admin_tenant_detail(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant record;
  v_owner_name text; v_owner_email text;
  v_fields int; v_staff int; v_bookings int; v_subs jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'NOT_SUPER_ADMIN' USING ERRCODE = 'P0001'; END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الملعب غير موجود' USING ERRCODE = 'P0001'; END IF;

  SELECT pr.full_name, au.email INTO v_owner_name, v_owner_email
  FROM public.profiles pr JOIN auth.users au ON au.id = pr.id
  WHERE pr.tenant_id = p_tenant_id AND pr.role = 'owner'
  LIMIT 1;

  SELECT count(*) INTO v_fields   FROM public.fields   WHERE tenant_id = p_tenant_id;
  SELECT count(*) INTO v_staff    FROM public.profiles WHERE tenant_id = p_tenant_id AND role = 'staff';
  SELECT count(*) INTO v_bookings FROM public.bookings WHERE tenant_id = p_tenant_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.created_at DESC), '[]'::jsonb) INTO v_subs
  FROM (
    SELECT id, status, amount, requested_fields, requested_staff, payment_reference,
           note, period_start, period_end, created_at, reviewed_at, reject_reason
    FROM public.subscriptions WHERE tenant_id = p_tenant_id
  ) s;

  RETURN jsonb_build_object(
    'tenant', jsonb_build_object(
      'id', v_tenant.id, 'name', v_tenant.name, 'created_at', v_tenant.created_at,
      'trial_ends_at', v_tenant.trial_ends_at, 'subscription_ends_at', v_tenant.subscription_ends_at,
      'subscription_status', v_tenant.subscription_status,
      'allowed_fields', v_tenant.allowed_fields, 'allowed_staff', v_tenant.allowed_staff,
      'suspended', v_tenant.suspended
    ),
    'is_active', public.is_tenant_active(p_tenant_id),
    'owner', jsonb_build_object('full_name', v_owner_name, 'email', v_owner_email),
    'counts', jsonb_build_object('fields', v_fields, 'staff', v_staff, 'bookings', v_bookings),
    'subscriptions', v_subs
  );
END;
$function$;

-- 4) تفعيل/تعطيل (suspended)
CREATE OR REPLACE FUNCTION public.admin_set_tenant_active(p_tenant_id uuid, p_active boolean)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'NOT_SUPER_ADMIN' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.tenants SET suspended = NOT p_active WHERE id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الملعب غير موجود' USING ERRCODE = 'P0001'; END IF;
END;
$function$;

-- 5) تمديد/بدء التجربة
CREATE OR REPLACE FUNCTION public.admin_extend_trial(p_tenant_id uuid, p_days integer)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'NOT_SUPER_ADMIN' USING ERRCODE = 'P0001'; END IF;
  IF p_days IS NULL OR p_days <= 0 THEN RAISE EXCEPTION 'عدد الأيام غير صالح' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.tenants
  SET trial_ends_at = GREATEST(COALESCE(trial_ends_at, now()), now()) + make_interval(days => p_days)
  WHERE id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الملعب غير موجود' USING ERRCODE = 'P0001'; END IF;
END;
$function$;

-- 6) منح/تمديد اشتراك يدوي + ضبط الحدود
CREATE OR REPLACE FUNCTION public.admin_grant_subscription(p_tenant_id uuid, p_days integer, p_fields integer, p_staff integer)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_tenant record; v_end timestamptz;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'NOT_SUPER_ADMIN' USING ERRCODE = 'P0001'; END IF;
  IF p_days IS NULL OR p_days <= 0 THEN RAISE EXCEPTION 'عدد الأيام غير صالح' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الملعب غير موجود' USING ERRCODE = 'P0001'; END IF;
  v_end := GREATEST(
    now(),
    COALESCE(v_tenant.subscription_ends_at, '-infinity'::timestamptz),
    COALESCE(v_tenant.trial_ends_at,        '-infinity'::timestamptz)
  ) + make_interval(days => p_days);
  UPDATE public.tenants
  SET subscription_ends_at = v_end,
      subscription_status  = 'active',
      suspended = false,
      allowed_fields = COALESCE(p_fields, allowed_fields),
      allowed_staff  = COALESCE(p_staff, allowed_staff)
  WHERE id = p_tenant_id;
END;
$function$;

-- 7) ضبط الحدود فقط
CREATE OR REPLACE FUNCTION public.admin_set_limits(p_tenant_id uuid, p_fields integer, p_staff integer)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'NOT_SUPER_ADMIN' USING ERRCODE = 'P0001'; END IF;
  IF p_fields IS NULL OR p_fields < 0 OR p_staff IS NULL OR p_staff < 0 THEN
    RAISE EXCEPTION 'قيمة غير صالحة' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.tenants SET allowed_fields = p_fields, allowed_staff = p_staff WHERE id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الملعب غير موجود' USING ERRCODE = 'P0001'; END IF;
END;
$function$;
