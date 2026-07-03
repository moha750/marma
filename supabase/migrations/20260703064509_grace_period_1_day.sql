-- خفض فترة سماح الاشتراك المدفوع من 3 أيام إلى يوم واحد، بتناسق عبر كل الدوال.
-- (مدة التجربة المجانية في handle_new_user تبقى 3 أيام — ليست سماحًا.)

-- 1) البوّاب الفعلي
create or replace function public.is_tenant_active(p_tenant_id uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select exists (
    select 1 from public.tenants
    where id = p_tenant_id
      and not coalesce(suspended, false)
      and (
        coalesce(lifetime, false)
        or now() < case
          when subscription_ends_at is not null then subscription_ends_at + interval '1 day'
          when trial_ends_at        is not null then trial_ends_at
          else 'epoch'::timestamptz
        end
      )
  )
$function$;

-- 2) حالة الاشتراك (العرض): hard_lock للمدفوع = +1 يوم
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
    when v_tenant.subscription_ends_at is not null then v_tenant.subscription_ends_at + interval '1 day'
    when v_tenant.trial_ends_at is not null         then v_tenant.trial_ends_at
    else null
  end;

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

-- 3) الملخّص الأسبوعي: فلتر "ضمن السماح" = +1 يوم
create or replace function public.send_weekly_summaries()
 returns void language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_project_url text; v_secret text; v_tenant record;
  v_total_bookings int; v_total_revenue numeric; v_busiest_day text; v_busiest_count int;
begin
  v_project_url := public._get_vault_secret('PROJECT_URL');
  v_secret := public._get_vault_secret('INTERNAL_HOOK_SECRET');
  if v_project_url is null or v_secret is null then
    raise warning 'send_weekly_summaries: missing vault secrets'; return;
  end if;

  for v_tenant in
    select id from public.tenants
    where (subscription_ends_at is null and trial_ends_at > now())
       or (subscription_ends_at is not null and subscription_ends_at + interval '1 day' > now())
  loop
    select count(*)::int, coalesce(sum(total_price), 0)
    into v_total_bookings, v_total_revenue
    from public.bookings
    where tenant_id = v_tenant.id and start_time >= now() and start_time < now() + interval '7 days'
      and status in ('confirmed', 'pending');
    if v_total_bookings = 0 then continue; end if;

    select
      case extract(dow from start_time)::int
        when 0 then 'الأحد' when 1 then 'الاثنين' when 2 then 'الثلاثاء' when 3 then 'الأربعاء'
        when 4 then 'الخميس' when 5 then 'الجمعة' when 6 then 'السبت' end,
      count(*)::int
    into v_busiest_day, v_busiest_count
    from public.bookings
    where tenant_id = v_tenant.id and start_time >= now() and start_time < now() + interval '7 days'
      and status in ('confirmed', 'pending')
    group by extract(dow from start_time) order by count(*) desc limit 1;

    begin
      perform net.http_post(
        url := v_project_url || '/functions/v1/send-weekly-summary',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
        body := jsonb_build_object('tenant_id', v_tenant.id::text, 'total_bookings', v_total_bookings,
          'total_revenue', v_total_revenue, 'busiest_day', v_busiest_day, 'busiest_count', v_busiest_count)
      );
    exception when others then
      raise warning 'send-weekly-summary call failed for tenant %: %', v_tenant.id, sqlerrm;
    end;
  end loop;
end;
$function$;

-- 4) الملخّص الشهري: فلتر "ضمن السماح" = +1 يوم
create or replace function public.send_monthly_summaries()
 returns void language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_project_url text; v_secret text; v_tenant record;
  v_last_start timestamptz; v_last_end timestamptz; v_prev_start timestamptz; v_prev_end timestamptz;
  v_last_bookings int; v_last_revenue numeric; v_prev_revenue numeric; v_growth_pct numeric;
  v_last_month_name text; v_prev_month_name text;
begin
  v_project_url := public._get_vault_secret('PROJECT_URL');
  v_secret := public._get_vault_secret('INTERNAL_HOOK_SECRET');
  if v_project_url is null or v_secret is null then
    raise warning 'send_monthly_summaries: missing vault secrets'; return;
  end if;

  v_last_start := date_trunc('month', now() - interval '1 month');
  v_last_end   := date_trunc('month', now());
  v_prev_start := date_trunc('month', now() - interval '2 months');
  v_prev_end   := v_last_start;

  v_last_month_name := case extract(month from v_last_start)::int
    when 1 then 'يناير' when 2 then 'فبراير' when 3 then 'مارس' when 4 then 'أبريل' when 5 then 'مايو'
    when 6 then 'يونيو' when 7 then 'يوليو' when 8 then 'أغسطس' when 9 then 'سبتمبر' when 10 then 'أكتوبر'
    when 11 then 'نوفمبر' when 12 then 'ديسمبر' end;
  v_prev_month_name := case extract(month from v_prev_start)::int
    when 1 then 'يناير' when 2 then 'فبراير' when 3 then 'مارس' when 4 then 'أبريل' when 5 then 'مايو'
    when 6 then 'يونيو' when 7 then 'يوليو' when 8 then 'أغسطس' when 9 then 'سبتمبر' when 10 then 'أكتوبر'
    when 11 then 'نوفمبر' when 12 then 'ديسمبر' end;

  for v_tenant in
    select id from public.tenants
    where (subscription_ends_at is null and trial_ends_at > now())
       or (subscription_ends_at is not null and subscription_ends_at + interval '1 day' > now())
  loop
    select count(*)::int, coalesce(sum(total_price), 0) into v_last_bookings, v_last_revenue
    from public.bookings
    where tenant_id = v_tenant.id and start_time >= v_last_start and start_time < v_last_end
      and status not in ('cancelled');
    if v_last_bookings = 0 then continue; end if;

    select coalesce(sum(total_price), 0) into v_prev_revenue
    from public.bookings
    where tenant_id = v_tenant.id and start_time >= v_prev_start and start_time < v_prev_end
      and status not in ('cancelled');
    if v_prev_revenue > 0 then
      v_growth_pct := round(((v_last_revenue - v_prev_revenue) / v_prev_revenue) * 100);
    else v_growth_pct := null; end if;

    begin
      perform net.http_post(
        url := v_project_url || '/functions/v1/send-monthly-summary',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
        body := jsonb_build_object('tenant_id', v_tenant.id::text, 'month_name', v_last_month_name,
          'prev_month_name', v_prev_month_name, 'total_bookings', v_last_bookings,
          'total_revenue', v_last_revenue, 'growth_pct', v_growth_pct)
      );
    exception when others then
      raise warning 'send-monthly-summary call failed for tenant %: %', v_tenant.id, sqlerrm;
    end;
  end loop;
end;
$function$;

-- 5) تحذيرات الاشتراك: فلتر +1 يوم، hard_lock +1 يوم، وإبقاء تذكير grace_final فقط
create or replace function public.send_subscription_warnings()
 returns void language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_project_url text; v_secret text; v_tenant record; v_hard_lock timestamptz;
begin
  v_project_url := public._get_vault_secret('PROJECT_URL');
  v_secret := public._get_vault_secret('INTERNAL_HOOK_SECRET');
  if v_project_url is null or v_secret is null then
    raise warning 'send_subscription_warnings: missing vault secrets'; return;
  end if;

  for v_tenant in
    select id, trial_ends_at, subscription_ends_at
    from public.tenants
    where
      (subscription_ends_at is null and trial_ends_at > now() and trial_ends_at < now() + interval '4 days')
      or (subscription_ends_at is not null
          and subscription_ends_at + interval '1 day' > now()
          and subscription_ends_at < now() + interval '4 days')
  loop
    if v_tenant.subscription_ends_at is null and v_tenant.trial_ends_at is not null then
      perform public._maybe_send_subscription_warning(
        v_tenant.id, 'trial_3d', v_tenant.trial_ends_at,
        interval '71 hours', interval '73 hours', v_project_url, v_secret);
      perform public._maybe_send_subscription_warning(
        v_tenant.id, 'trial_1d', v_tenant.trial_ends_at,
        interval '23 hours', interval '25 hours', v_project_url, v_secret);
      perform public._maybe_send_subscription_warning(
        v_tenant.id, 'trial_final', v_tenant.trial_ends_at,
        interval '1 hour', interval '3 hours', v_project_url, v_secret);
    end if;

    if v_tenant.subscription_ends_at is not null then
      perform public._maybe_send_subscription_warning(
        v_tenant.id, 'sub_3d', v_tenant.subscription_ends_at,
        interval '71 hours', interval '73 hours', v_project_url, v_secret);
      perform public._maybe_send_subscription_warning(
        v_tenant.id, 'sub_1d', v_tenant.subscription_ends_at,
        interval '23 hours', interval '25 hours', v_project_url, v_secret);
      perform public._maybe_send_subscription_warning(
        v_tenant.id, 'sub_final', v_tenant.subscription_ends_at,
        interval '1 hour', interval '3 hours', v_project_url, v_secret);

      -- سماح يوم واحد: تذكير أخير فقط قبل القفل النهائي
      v_hard_lock := v_tenant.subscription_ends_at + interval '1 day';
      perform public._maybe_send_subscription_warning(
        v_tenant.id, 'grace_final', v_hard_lock,
        interval '1 hour', interval '3 hours', v_project_url, v_secret);
    end if;
  end loop;
end;
$function$;
