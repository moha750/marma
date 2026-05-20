-- إزالة فترة سماح التجربة المجانية
--
-- التغيير: التجربة المجانية تنتهي بقفل فوري بدون فترة سماح.
-- فترة السماح (3 أيام) تبقى للاشتراك المدفوع فقط — لإنقاذ العميل
-- من فشل بطاقة أو نسيان تجديد.
--
-- التبرير: التجربة بلا دفع لا تستفيد من سماح — يضعف ضغط التحويل
-- ويُربك المستخدم (3 أم 6 أيام؟).
--
-- إضافة حقل جديد: days_until_expiry = أيام حتى نهاية التجربة/الاشتراك
-- (مقابل days_remaining = أيام حتى القفل الكامل بعد فترة السماح للمدفوع).

CREATE OR REPLACE FUNCTION public.get_my_subscription_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id          uuid := public.get_my_tenant_id();
  v_tenant             record;
  v_is_active          boolean;
  v_effective_end      timestamptz;
  v_hard_lock          timestamptz;
  v_is_grace           boolean;
  v_days_remaining     int;
  v_days_until_expiry  int;
  v_pending_id         uuid;
  v_phase              text;
  v_current_fields     int;
  v_current_staff      int;
  v_pending_invites    int;
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

  -- المدفوع له فترة سماح 3 أيام؛ التجربة المجانية بدون سماح (قفل فوري)
  v_hard_lock := CASE
    WHEN v_tenant.subscription_ends_at IS NOT NULL THEN v_tenant.subscription_ends_at + interval '3 days'
    WHEN v_tenant.trial_ends_at IS NOT NULL         THEN v_tenant.trial_ends_at
    ELSE NULL
  END;

  v_is_active := v_hard_lock IS NOT NULL AND now() < v_hard_lock;
  v_is_grace  := v_is_active AND v_effective_end IS NOT NULL AND now() >= v_effective_end;

  IF v_hard_lock IS NULL THEN
    v_days_remaining := 0;
  ELSE
    v_days_remaining := GREATEST(0, ceil(EXTRACT(EPOCH FROM (v_hard_lock - now())) / 86400.0)::int);
  END IF;

  IF v_effective_end IS NULL THEN
    v_days_until_expiry := 0;
  ELSE
    v_days_until_expiry := GREATEST(0, ceil(EXTRACT(EPOCH FROM (v_effective_end - now())) / 86400.0)::int);
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
    v_phase := 'expired';
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
    'days_until_expiry',    v_days_until_expiry,
    'phase',                v_phase,
    'pending_request_id',   v_pending_id,
    'allowed_fields',       v_tenant.allowed_fields,
    'allowed_staff',        v_tenant.allowed_staff,
    'current_fields',       v_current_fields,
    'current_staff',        v_current_staff,
    'pending_invites',      v_pending_invites
  );
END;
$function$;
