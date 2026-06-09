-- إضافة علم trial_extended (من سجلّ الإجراءات) إلى حالة اشتراك المالك،
-- ليُميّز البانر التجربة الممدّدة إداريًّا عن التجربة العادية.
create or replace function public.get_my_subscription_status()
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare
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
  v_trial_extended     boolean;
begin
  if v_tenant_id is null then
    return jsonb_build_object('is_active', false, 'phase', 'none');
  end if;

  select id, name, trial_ends_at, subscription_ends_at, subscription_status,
         allowed_fields, allowed_staff, suspended
  into v_tenant
  from public.tenants where id = v_tenant_id;
  if not found then
    return jsonb_build_object('is_active', false, 'phase', 'none');
  end if;

  v_effective_end := coalesce(v_tenant.subscription_ends_at, v_tenant.trial_ends_at);

  v_hard_lock := case
    when v_tenant.subscription_ends_at is not null then v_tenant.subscription_ends_at + interval '3 days'
    when v_tenant.trial_ends_at is not null         then v_tenant.trial_ends_at
    else null
  end;

  v_is_active := v_hard_lock is not null and now() < v_hard_lock;
  if coalesce(v_tenant.suspended, false) then
    v_is_active := false;
  end if;
  v_is_grace  := v_is_active and v_effective_end is not null and now() >= v_effective_end;

  if v_hard_lock is null then
    v_days_remaining := 0;
  else
    v_days_remaining := greatest(0, ceil(extract(epoch from (v_hard_lock - now())) / 86400.0)::int);
  end if;

  if v_effective_end is null then
    v_days_until_expiry := 0;
  else
    v_days_until_expiry := greatest(0, ceil(extract(epoch from (v_effective_end - now())) / 86400.0)::int);
  end if;

  if coalesce(v_tenant.suspended, false) then
    v_phase := 'suspended';
  elsif not v_is_active then
    v_phase := 'expired';
  elsif v_tenant.subscription_ends_at is not null and now() <  v_tenant.subscription_ends_at then
    v_phase := 'active';
  elsif v_tenant.subscription_ends_at is not null and now() >= v_tenant.subscription_ends_at then
    v_phase := 'grace_active';
  elsif v_tenant.trial_ends_at         is not null and now() <  v_tenant.trial_ends_at then
    v_phase := 'trial';
  else
    v_phase := 'expired';
  end if;

  select id into v_pending_id
  from public.subscriptions
  where tenant_id = v_tenant_id and status = 'pending'
  order by created_at desc limit 1;

  select count(*)::int into v_current_fields
  from public.fields where tenant_id = v_tenant_id and is_active;

  select count(*)::int into v_current_staff
  from public.profiles where tenant_id = v_tenant_id and role = 'staff';

  select count(*)::int into v_pending_invites
  from public.staff_invitations
  where tenant_id = v_tenant_id and used_at is null and expires_at > now();

  v_trial_extended := exists(
    select 1 from public.admin_audit_log
    where tenant_id = v_tenant_id and action = 'extend_trial'
  );

  return jsonb_build_object(
    'tenant_id',            v_tenant.id,
    'trial_ends_at',        v_tenant.trial_ends_at,
    'subscription_ends_at', v_tenant.subscription_ends_at,
    'subscription_status',  v_tenant.subscription_status,
    'effective_end',        v_effective_end,
    'hard_lock_at',         v_hard_lock,
    'is_active',            v_is_active,
    'is_grace',             v_is_grace,
    'suspended',            coalesce(v_tenant.suspended, false),
    'trial_extended',       v_trial_extended,
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
end;
$function$;
