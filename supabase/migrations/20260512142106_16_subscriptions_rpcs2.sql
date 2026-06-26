-- ============================================================
-- 16_subscriptions_rpcs2: subscription RPCs (owner + super-admin)
-- ============================================================

-- list_plans: any authenticated user can read active plans
CREATE OR REPLACE FUNCTION public.list_plans()
RETURNS TABLE (id uuid, name text, price numeric, duration_days int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT id, name, price, duration_days
  FROM public.plans
  WHERE is_active = true
  ORDER BY price
$$;

-- request_subscription: owner-only, creates a pending request
CREATE OR REPLACE FUNCTION public.request_subscription(
  p_plan_id uuid,
  p_reference text,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid := public.get_my_tenant_id();
  v_user_id uuid := auth.uid();
  v_plan record;
  v_clean_ref text := btrim(coalesce(p_reference, ''));
  v_id uuid;
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

  SELECT id, name, price, duration_days, is_active INTO v_plan
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

  INSERT INTO public.subscriptions (
    tenant_id, plan_id, status, amount, payment_reference, note, created_by
  ) VALUES (
    v_tenant_id, p_plan_id, 'pending', v_plan.price, v_clean_ref,
    NULLIF(btrim(coalesce(p_note, '')), ''), v_user_id
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- approve_subscription: super-admin only
CREATE OR REPLACE FUNCTION public.approve_subscription(p_subscription_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_sub record;
  v_plan record;
  v_tenant record;
  v_period_start timestamptz;
  v_period_end timestamptz;
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

  -- period_start = greatest(now, current subscription_ends_at, trial_ends_at)
  v_period_start := GREATEST(
    now(),
    COALESCE(v_tenant.subscription_ends_at, '-infinity'::timestamptz),
    COALESCE(v_tenant.trial_ends_at, '-infinity'::timestamptz)
  );
  v_period_end := v_period_start + make_interval(days => v_plan.duration_days);

  UPDATE public.subscriptions
  SET status        = 'approved',
      period_start  = v_period_start,
      period_end    = v_period_end,
      reviewed_by   = auth.uid(),
      reviewed_at   = now()
  WHERE id = p_subscription_id;

  UPDATE public.tenants
  SET subscription_ends_at = v_period_end,
      subscription_status  = 'active'
  WHERE id = v_sub.tenant_id;

  RETURN jsonb_build_object(
    'subscription_id', p_subscription_id,
    'period_start', v_period_start,
    'period_end',   v_period_end
  );
END;
$$;

-- reject_subscription: super-admin only
CREATE OR REPLACE FUNCTION public.reject_subscription(
  p_subscription_id uuid,
  p_reject_reason text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_sub record;
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

  UPDATE public.subscriptions
  SET status        = 'rejected',
      reject_reason = NULLIF(btrim(coalesce(p_reject_reason, '')), ''),
      reviewed_by   = auth.uid(),
      reviewed_at   = now()
  WHERE id = p_subscription_id;
END;
$$;

-- get_my_subscription_status: status snapshot used by client (banner + page)
CREATE OR REPLACE FUNCTION public.get_my_subscription_status()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid := public.get_my_tenant_id();
  v_tenant record;
  v_is_active boolean;
  v_effective_end timestamptz;   -- نهاية مدة الخدمة الفعلية (قبل السماح)
  v_hard_lock timestamptz;        -- نهاية فترة السماح (الإغلاق الكامل)
  v_is_grace boolean;
  v_days_remaining int;
  v_pending_id uuid;
  v_phase text;                   -- 'trial' | 'active' | 'grace_trial' | 'grace_active' | 'expired' | 'none'
BEGIN
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('is_active', false, 'phase', 'none');
  END IF;

  SELECT id, name, trial_ends_at, subscription_ends_at, subscription_status
  INTO v_tenant
  FROM public.tenants WHERE id = v_tenant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('is_active', false, 'phase', 'none');
  END IF;

  -- نختار آخر "نهاية فعلية": إذا فيه اشتراك مدفوع نستخدم subscription_ends_at، وإلا trial_ends_at
  v_effective_end := COALESCE(v_tenant.subscription_ends_at, v_tenant.trial_ends_at);
  v_hard_lock := v_effective_end + interval '3 days';

  v_is_active := v_hard_lock IS NOT NULL AND now() < v_hard_lock;
  v_is_grace := v_is_active AND v_effective_end IS NOT NULL AND now() >= v_effective_end;

  -- أيام متبقية حتى الإغلاق الكامل (hard lock)
  IF v_hard_lock IS NULL THEN
    v_days_remaining := 0;
  ELSE
    v_days_remaining := GREATEST(0, ceil(EXTRACT(EPOCH FROM (v_hard_lock - now())) / 86400.0)::int);
  END IF;

  -- تحديد الطور للواجهة
  IF NOT v_is_active THEN
    v_phase := 'expired';
  ELSIF v_tenant.subscription_ends_at IS NOT NULL AND now() < v_tenant.subscription_ends_at THEN
    v_phase := 'active';
  ELSIF v_tenant.subscription_ends_at IS NOT NULL AND now() >= v_tenant.subscription_ends_at THEN
    v_phase := 'grace_active';
  ELSIF v_tenant.trial_ends_at IS NOT NULL AND now() < v_tenant.trial_ends_at THEN
    v_phase := 'trial';
  ELSE
    v_phase := 'grace_trial';
  END IF;

  SELECT id INTO v_pending_id
  FROM public.subscriptions
  WHERE tenant_id = v_tenant_id AND status = 'pending'
  ORDER BY created_at DESC LIMIT 1;

  RETURN jsonb_build_object(
    'tenant_id', v_tenant.id,
    'trial_ends_at', v_tenant.trial_ends_at,
    'subscription_ends_at', v_tenant.subscription_ends_at,
    'subscription_status', v_tenant.subscription_status,
    'effective_end', v_effective_end,
    'hard_lock_at', v_hard_lock,
    'is_active', v_is_active,
    'is_grace', v_is_grace,
    'days_remaining', v_days_remaining,
    'phase', v_phase,
    'pending_request_id', v_pending_id
  );
END;
$$;

-- list_my_subscriptions: history for the owner
CREATE OR REPLACE FUNCTION public.list_my_subscriptions()
RETURNS TABLE (
  id uuid, status text, amount numeric, payment_reference text, note text,
  period_start timestamptz, period_end timestamptz,
  reviewed_at timestamptz, reject_reason text,
  created_at timestamptz, plan_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT s.id, s.status, s.amount, s.payment_reference, s.note,
         s.period_start, s.period_end,
         s.reviewed_at, s.reject_reason,
         s.created_at, p.name AS plan_name
  FROM public.subscriptions s
  JOIN public.plans p ON p.id = s.plan_id
  WHERE s.tenant_id = public.get_my_tenant_id()
  ORDER BY s.created_at DESC
$$;

-- admin_list_pending_subscriptions: super-admin pending queue
CREATE OR REPLACE FUNCTION public.admin_list_pending_subscriptions()
RETURNS TABLE (
  id uuid, tenant_id uuid, tenant_name text, plan_name text,
  amount numeric, payment_reference text, note text, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'NOT_SUPER_ADMIN' USING ERRCODE = 'P0001';
  END IF;
  RETURN QUERY
  SELECT s.id, s.tenant_id, t.name AS tenant_name, p.name AS plan_name,
         s.amount, s.payment_reference, s.note, s.created_at
  FROM public.subscriptions s
  JOIN public.tenants t ON t.id = s.tenant_id
  JOIN public.plans p   ON p.id = s.plan_id
  WHERE s.status = 'pending'
  ORDER BY s.created_at ASC;
END;
$$;

-- admin_list_tenants: super-admin overview
CREATE OR REPLACE FUNCTION public.admin_list_tenants()
RETURNS TABLE (
  id uuid, name text, city text, phone text,
  trial_ends_at timestamptz, subscription_ends_at timestamptz,
  subscription_status text, is_active boolean, created_at timestamptz,
  last_subscription_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'NOT_SUPER_ADMIN' USING ERRCODE = 'P0001';
  END IF;
  RETURN QUERY
  SELECT t.id, t.name, t.city, t.phone,
         t.trial_ends_at, t.subscription_ends_at,
         t.subscription_status, public.is_tenant_active(t.id) AS is_active,
         t.created_at,
         (SELECT MAX(s.reviewed_at) FROM public.subscriptions s
          WHERE s.tenant_id = t.id AND s.status = 'approved') AS last_subscription_at
  FROM public.tenants t
  ORDER BY t.created_at DESC;
END;
$$;
;