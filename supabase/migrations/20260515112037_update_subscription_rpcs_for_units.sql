
-- request_subscription: التوقيع الجديد يحمل عدد الأرضيات والموظفين،
-- والمبلغ يُحسب سيرفر-سايد لمنع التلاعب.
DROP FUNCTION IF EXISTS public.request_subscription(uuid, text, text);

CREATE OR REPLACE FUNCTION public.request_subscription(
  p_plan_id   uuid,
  p_fields    int,
  p_staff     int,
  p_reference text,
  p_note      text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid := public.get_my_tenant_id();
  v_user_id   uuid := auth.uid();
  v_plan      record;
  v_clean_ref text := btrim(coalesce(p_reference, ''));
  v_id        uuid;
  v_amount    numeric;
  -- ثوابت التسعير — مطابقة لـ src/features/subscriptions/pricing.js
  v_base_price      constant numeric := 200;
  v_unit_price      constant numeric := 50;
  v_included_fields constant int     := 1;
  v_included_staff  constant int     := 1;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'NOT_OWNER' USING ERRCODE = 'P0001';
  END IF;
  IF v_clean_ref = '' THEN
    RAISE EXCEPTION 'PAYMENT_REFERENCE_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF p_fields IS NULL OR p_fields < 1 OR p_staff IS NULL OR p_staff < 1 THEN
    RAISE EXCEPTION 'INVALID_UNIT_COUNT' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, name, duration_days, is_active INTO v_plan
  FROM public.plans WHERE id = p_plan_id;
  IF NOT FOUND OR NOT v_plan.is_active THEN
    RAISE EXCEPTION 'PLAN_NOT_AVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE tenant_id = v_tenant_id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_PENDING_EXISTS' USING ERRCODE = 'P0001';
  END IF;

  v_amount := v_base_price
            + GREATEST(0, p_fields - v_included_fields) * v_unit_price
            + GREATEST(0, p_staff  - v_included_staff)  * v_unit_price;

  INSERT INTO public.subscriptions (
    tenant_id, plan_id, status, amount, payment_reference, note,
    requested_fields, requested_staff, created_by
  ) VALUES (
    v_tenant_id, p_plan_id, 'pending', v_amount, v_clean_ref,
    NULLIF(btrim(coalesce(p_note, '')), ''),
    p_fields, p_staff, v_user_id
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


-- approve_subscription: عند الموافقة يحدّث allowed_fields/staff من القيم المطلوبة
CREATE OR REPLACE FUNCTION public.approve_subscription(p_subscription_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub          record;
  v_plan         record;
  v_tenant       record;
  v_period_start timestamptz;
  v_period_end   timestamptz;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'NOT_SUPER_ADMIN' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_sub FROM public.subscriptions WHERE id = p_subscription_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_sub.status <> 'pending' THEN
    RAISE EXCEPTION 'SUBSCRIPTION_ALREADY_REVIEWED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_plan FROM public.plans WHERE id = v_sub.plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PLAN_NOT_AVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = v_sub.tenant_id FOR UPDATE;

  v_period_start := GREATEST(
    now(),
    COALESCE(v_tenant.subscription_ends_at, '-infinity'::timestamptz),
    COALESCE(v_tenant.trial_ends_at,        '-infinity'::timestamptz)
  );
  v_period_end := v_period_start + make_interval(days => v_plan.duration_days);

  UPDATE public.subscriptions
  SET status       = 'approved',
      period_start = v_period_start,
      period_end   = v_period_end,
      reviewed_by  = auth.uid(),
      reviewed_at  = now()
  WHERE id = p_subscription_id;

  UPDATE public.tenants
  SET subscription_ends_at = v_period_end,
      subscription_status  = 'active',
      allowed_fields = GREATEST(
        allowed_fields,
        COALESCE(v_sub.requested_fields, allowed_fields)
      ),
      allowed_staff  = GREATEST(
        allowed_staff,
        COALESCE(v_sub.requested_staff, allowed_staff)
      )
  WHERE id = v_sub.tenant_id;

  RETURN jsonb_build_object(
    'subscription_id', p_subscription_id,
    'period_start',    v_period_start,
    'period_end',      v_period_end,
    'allowed_fields',  COALESCE(v_sub.requested_fields, v_tenant.allowed_fields),
    'allowed_staff',   COALESCE(v_sub.requested_staff,  v_tenant.allowed_staff)
  );
END;
$$;


-- get_my_subscription_status: يضيف allowed/current counts للعرض في الواجهة
CREATE OR REPLACE FUNCTION public.get_my_subscription_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id      uuid := public.get_my_tenant_id();
  v_tenant         record;
  v_is_active      boolean;
  v_effective_end  timestamptz;
  v_hard_lock      timestamptz;
  v_is_grace       boolean;
  v_days_remaining int;
  v_pending_id     uuid;
  v_phase          text;
  v_current_fields int;
  v_current_staff  int;
  v_pending_invites int;
BEGIN
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('is_active', false, 'phase', 'none');
  END IF;

  SELECT id, name, trial_ends_at, subscription_ends_at, subscription_status,
         allowed_fields, allowed_staff
  INTO v_tenant
  FROM public.tenants WHERE id = v_tenant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('is_active', false, 'phase', 'none');
  END IF;

  v_effective_end := COALESCE(v_tenant.subscription_ends_at, v_tenant.trial_ends_at);
  v_hard_lock     := v_effective_end + interval '3 days';

  v_is_active := v_hard_lock IS NOT NULL AND now() < v_hard_lock;
  v_is_grace  := v_is_active AND v_effective_end IS NOT NULL AND now() >= v_effective_end;

  IF v_hard_lock IS NULL THEN
    v_days_remaining := 0;
  ELSE
    v_days_remaining := GREATEST(0, ceil(EXTRACT(EPOCH FROM (v_hard_lock - now())) / 86400.0)::int);
  END IF;

  IF NOT v_is_active THEN
    v_phase := 'expired';
  ELSIF v_tenant.subscription_ends_at IS NOT NULL AND now() <  v_tenant.subscription_ends_at THEN
    v_phase := 'active';
  ELSIF v_tenant.subscription_ends_at IS NOT NULL AND now() >= v_tenant.subscription_ends_at THEN
    v_phase := 'grace_active';
  ELSIF v_tenant.trial_ends_at         IS NOT NULL AND now() <  v_tenant.trial_ends_at THEN
    v_phase := 'trial';
  ELSE
    v_phase := 'grace_trial';
  END IF;

  SELECT id INTO v_pending_id
  FROM public.subscriptions
  WHERE tenant_id = v_tenant_id AND status = 'pending'
  ORDER BY created_at DESC LIMIT 1;

  SELECT count(*)::int INTO v_current_fields
  FROM public.fields WHERE tenant_id = v_tenant_id AND is_active;

  SELECT count(*)::int INTO v_current_staff
  FROM public.profiles WHERE tenant_id = v_tenant_id AND role = 'staff';

  SELECT count(*)::int INTO v_pending_invites
  FROM public.staff_invitations
  WHERE tenant_id = v_tenant_id AND used_at IS NULL AND expires_at > now();

  RETURN jsonb_build_object(
    'tenant_id',            v_tenant.id,
    'trial_ends_at',        v_tenant.trial_ends_at,
    'subscription_ends_at', v_tenant.subscription_ends_at,
    'subscription_status',  v_tenant.subscription_status,
    'effective_end',        v_effective_end,
    'hard_lock_at',         v_hard_lock,
    'is_active',            v_is_active,
    'is_grace',             v_is_grace,
    'days_remaining',       v_days_remaining,
    'phase',                v_phase,
    'pending_request_id',   v_pending_id,
    'allowed_fields',       v_tenant.allowed_fields,
    'allowed_staff',        v_tenant.allowed_staff,
    'current_fields',       v_current_fields,
    'current_staff',        v_current_staff,
    'pending_invites',      v_pending_invites
  );
END;
$$;


-- admin_list_pending_subscriptions: إضافة عمودَي requested_fields/staff للعرض
DROP FUNCTION IF EXISTS public.admin_list_pending_subscriptions();

CREATE OR REPLACE FUNCTION public.admin_list_pending_subscriptions()
RETURNS TABLE(
  id uuid, tenant_id uuid, tenant_name text, plan_name text,
  amount numeric, payment_reference text, note text,
  requested_fields int, requested_staff int,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'NOT_SUPER_ADMIN' USING ERRCODE = 'P0001';
  END IF;
  RETURN QUERY
  SELECT s.id, s.tenant_id, t.name, p.name,
         s.amount, s.payment_reference, s.note,
         s.requested_fields, s.requested_staff,
         s.created_at
  FROM public.subscriptions s
  JOIN public.tenants t ON t.id = s.tenant_id
  JOIN public.plans   p ON p.id = s.plan_id
  WHERE s.status = 'pending'
  ORDER BY s.created_at ASC;
END;
$$;


-- list_my_subscriptions: نضيف requested_fields/staff لسجل المستخدم
DROP FUNCTION IF EXISTS public.list_my_subscriptions();

CREATE OR REPLACE FUNCTION public.list_my_subscriptions()
RETURNS TABLE(
  id uuid, status text, amount numeric,
  payment_reference text, note text,
  period_start timestamptz, period_end timestamptz,
  reviewed_at timestamptz, reject_reason text,
  created_at timestamptz, plan_name text,
  requested_fields int, requested_staff int
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid := public.get_my_tenant_id();
BEGIN
  IF v_tenant_id IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT s.id, s.status, s.amount,
         s.payment_reference, s.note,
         s.period_start, s.period_end,
         s.reviewed_at, s.reject_reason,
         s.created_at, p.name,
         s.requested_fields, s.requested_staff
  FROM public.subscriptions s
  JOIN public.plans p ON p.id = s.plan_id
  WHERE s.tenant_id = v_tenant_id
  ORDER BY s.created_at DESC;
END;
$$;
;