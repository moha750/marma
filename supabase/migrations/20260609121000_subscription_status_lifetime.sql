-- بوابة المالك + تفاصيل الملعب تدعمان الوصول الدائم (lifetime)
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
  v_lifetime           boolean;
begin
  if v_tenant_id is null then
    return jsonb_build_object('is_active', false, 'phase', 'none');
  end if;

  select id, name, trial_ends_at, subscription_ends_at, subscription_status,
         allowed_fields, allowed_staff, suspended, coalesce(lifetime, false) as lifetime
  into v_tenant
  from public.tenants where id = v_tenant_id;
  if not found then
    return jsonb_build_object('is_active', false, 'phase', 'none');
  end if;

  v_lifetime := v_tenant.lifetime;
  v_effective_end := coalesce(v_tenant.subscription_ends_at, v_tenant.trial_ends_at);

  v_hard_lock := case
    when v_tenant.subscription_ends_at is not null then v_tenant.subscription_ends_at + interval '3 days'
    when v_tenant.trial_ends_at is not null         then v_tenant.trial_ends_at
    else null
  end;

  -- النشاط: التعطيل يقطع، ثم الدائم يفتح، ثم منطق التواريخ
  if coalesce(v_tenant.suspended, false) then
    v_is_active := false;
  elsif v_lifetime then
    v_is_active := true;
  else
    v_is_active := v_hard_lock is not null and now() < v_hard_lock;
  end if;

  v_is_grace := v_is_active and not v_lifetime and v_effective_end is not null and now() >= v_effective_end;

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
  elsif v_lifetime then
    v_phase := 'lifetime';
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
    'effective_end',        case when v_lifetime then null else v_effective_end end,
    'hard_lock_at',         case when v_lifetime then null else v_hard_lock end,
    'is_active',            v_is_active,
    'is_grace',             v_is_grace,
    'suspended',            coalesce(v_tenant.suspended, false),
    'lifetime',             v_lifetime,
    'trial_extended',       v_trial_extended,
    'days_remaining',       v_days_remaining,
    'days_until_expiry',    v_days_until_expiry,
    'phase',                v_phase,
    'pending_request_id',   v_pending_id,
    'allowed_fields',       case when v_lifetime then null else v_tenant.allowed_fields end,
    'allowed_staff',        case when v_lifetime then null else v_tenant.allowed_staff end,
    'current_fields',       v_current_fields,
    'current_staff',        v_current_staff,
    'pending_invites',      v_pending_invites
  );
end;
$function$;

-- تضمين lifetime في تفاصيل الملعب (للوحة المشرف)
create or replace function public.admin_tenant_detail(p_tenant_id uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_tenant record;
  v_owner_name text; v_owner_email text;
  v_fields int; v_staff int; v_bookings int; v_subs jsonb; v_audit jsonb;
begin
  if not public.is_super_admin() then raise exception 'NOT_SUPER_ADMIN' using errcode = 'P0001'; end if;

  select * into v_tenant from public.tenants where id = p_tenant_id;
  if not found then raise exception 'الملعب غير موجود' using errcode = 'P0001'; end if;

  select pr.full_name, au.email into v_owner_name, v_owner_email
  from public.profiles pr join auth.users au on au.id = pr.id
  where pr.tenant_id = p_tenant_id and pr.role = 'owner'
  limit 1;

  select count(*) into v_fields   from public.fields   where tenant_id = p_tenant_id;
  select count(*) into v_staff    from public.profiles where tenant_id = p_tenant_id and role = 'staff';
  select count(*) into v_bookings from public.bookings where tenant_id = p_tenant_id;

  select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at desc), '[]'::jsonb) into v_subs
  from (
    select id, status, amount, requested_fields, requested_staff, payment_reference,
           note, period_start, period_end, created_at, reviewed_at, reject_reason
    from public.subscriptions where tenant_id = p_tenant_id
  ) s;

  select coalesce(jsonb_agg(x order by ord desc), '[]'::jsonb) into v_audit
  from (
    select jsonb_build_object(
      'id', a.id, 'action', a.action, 'details', a.details, 'created_at', a.created_at,
      'actor', coalesce(u.raw_user_meta_data->>'display_name', u.raw_user_meta_data->>'full_name', u.email)
    ) as x, a.created_at as ord
    from public.admin_audit_log a
    left join auth.users u on u.id = a.actor_id
    where a.tenant_id = p_tenant_id
    order by a.created_at desc
    limit 100
  ) s;

  return jsonb_build_object(
    'tenant', jsonb_build_object(
      'id', v_tenant.id, 'name', v_tenant.name, 'created_at', v_tenant.created_at,
      'trial_ends_at', v_tenant.trial_ends_at, 'subscription_ends_at', v_tenant.subscription_ends_at,
      'subscription_status', v_tenant.subscription_status,
      'allowed_fields', v_tenant.allowed_fields, 'allowed_staff', v_tenant.allowed_staff,
      'suspended', v_tenant.suspended, 'lifetime', coalesce(v_tenant.lifetime, false)
    ),
    'is_active', public.is_tenant_active(p_tenant_id),
    'owner', jsonb_build_object('full_name', v_owner_name, 'email', v_owner_email),
    'counts', jsonb_build_object('fields', v_fields, 'staff', v_staff, 'bookings', v_bookings),
    'subscriptions', v_subs,
    'audit', v_audit
  );
end;
$function$;
