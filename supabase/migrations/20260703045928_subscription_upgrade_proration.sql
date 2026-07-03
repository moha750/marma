-- نموذج فوترة جديد: ترقية فورية تفاضلية (proration) + تجديد شهري بتاريخ ثابت.
-- kind='upgrade' → يضيف وحدات فورًا بسعر (الوحدات المضافة × سعر الوحدة × الأيام المتبقّية ÷ مدة الدورة)، بلا تمديد.
-- kind='renew'/'new' → شهر كامل بالوحدات المختارة، يمدّد المدة (السلوك السابق).

alter table public.subscriptions add column if not exists kind text not null default 'renew';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_kind_check') then
    alter table public.subscriptions
      add constraint subscriptions_kind_check check (kind in ('new','renew','upgrade'));
  end if;
end $$;

-- ── request_subscription: يحسب المبلغ حسب النوع (الخادم مرجع) ──
drop function if exists public.request_subscription(uuid, integer, integer, text, text, text);
create function public.request_subscription(
  p_plan_id uuid, p_fields integer, p_staff integer,
  p_reference text default null, p_note text default null, p_receipt_path text default null,
  p_kind text default 'renew'
) returns uuid
 language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_tenant    record;
  v_user_id   uuid := auth.uid();
  v_plan      record;
  v_clean_ref     text := btrim(coalesce(p_reference, ''));
  v_clean_receipt text := btrim(coalesce(p_receipt_path, ''));
  v_kind      text := lower(coalesce(p_kind, 'renew'));
  v_id        uuid;
  v_amount    numeric;
  v_added_fields   int;
  v_added_staff    int;
  v_remaining_days int;
  v_base_price      constant numeric := 200;
  v_unit_price      constant numeric := 50;
  v_included_fields constant int     := 1;
  v_included_staff  constant int     := 1;
begin
  if v_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.is_owner() then raise exception 'NOT_OWNER' using errcode = 'P0001'; end if;
  if v_kind not in ('new', 'renew', 'upgrade') then v_kind := 'renew'; end if;
  if v_clean_receipt = '' and v_clean_ref = '' then
    raise exception 'PAYMENT_PROOF_REQUIRED' using errcode = 'P0001';
  end if;
  if p_fields is null or p_fields < 1 or p_staff is null or p_staff < 1 then
    raise exception 'INVALID_UNIT_COUNT' using errcode = 'P0001';
  end if;

  select t.* into v_tenant from public.tenants t where t.id = public.get_my_tenant_id() for update;
  if not found then raise exception 'TENANT_NOT_FOUND' using errcode = 'P0001'; end if;

  if v_clean_receipt <> '' and v_clean_receipt not like (v_tenant.id::text || '/%') then
    raise exception 'INVALID_RECEIPT_PATH' using errcode = 'P0001';
  end if;

  select id, name, duration_days, is_active into v_plan from public.plans where id = p_plan_id;
  if not found or not v_plan.is_active then
    raise exception 'PLAN_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.subscriptions where tenant_id = v_tenant.id and status = 'pending') then
    raise exception 'SUBSCRIPTION_PENDING_EXISTS' using errcode = 'P0001';
  end if;

  if v_kind = 'upgrade' then
    -- الترقية الفورية تتطلّب اشتراكاً مدفوعاً نشطاً بتاريخ انتهاء مستقبلي
    if not public.is_tenant_active(v_tenant.id)
       or v_tenant.subscription_ends_at is null
       or v_tenant.subscription_ends_at <= now() then
      raise exception 'UPGRADE_NOT_ALLOWED' using errcode = 'P0001';
    end if;
    v_added_fields := p_fields - coalesce(v_tenant.allowed_fields, v_included_fields);
    v_added_staff  := p_staff  - coalesce(v_tenant.allowed_staff,  v_included_staff);
    if v_added_fields < 0 or v_added_staff < 0 then
      raise exception 'INVALID_UNIT_COUNT' using errcode = 'P0001';   -- لا تخفيض في الترقية
    end if;
    if (v_added_fields + v_added_staff) <= 0 then
      raise exception 'NO_UNITS_ADDED' using errcode = 'P0001';
    end if;
    v_remaining_days := greatest(0, ceil(extract(epoch from (v_tenant.subscription_ends_at - now())) / 86400.0)::int);
    v_amount := round((v_added_fields + v_added_staff) * v_unit_price * v_remaining_days::numeric / v_plan.duration_days);
  else
    -- تجديد/جديد: شهر كامل بالوحدات المختارة
    v_amount := v_base_price
              + greatest(0, p_fields - v_included_fields) * v_unit_price
              + greatest(0, p_staff  - v_included_staff)  * v_unit_price;
  end if;

  insert into public.subscriptions (
    tenant_id, plan_id, status, amount, payment_reference, receipt_path, note,
    requested_fields, requested_staff, created_by, kind
  ) values (
    v_tenant.id, p_plan_id, 'pending', v_amount,
    nullif(v_clean_ref, ''), nullif(v_clean_receipt, ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    p_fields, p_staff, v_user_id, v_kind
  ) returning id into v_id;

  return v_id;
end;
$function$;

-- ── approve_subscription: الترقية ترفع الحدود بلا تمديد؛ التجديد يمدّد ──
create or replace function public.approve_subscription(p_subscription_id uuid)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_sub record; v_plan record; v_tenant record;
  v_period_start timestamptz; v_period_end timestamptz;
begin
  if not public.is_super_admin() then raise exception 'NOT_SUPER_ADMIN' using errcode = 'P0001'; end if;
  select * into v_sub from public.subscriptions where id = p_subscription_id for update;
  if not found then raise exception 'SUBSCRIPTION_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_sub.status <> 'pending' then raise exception 'SUBSCRIPTION_ALREADY_REVIEWED' using errcode = 'P0001'; end if;
  select * into v_plan from public.plans where id = v_sub.plan_id;
  if not found then raise exception 'PLAN_NOT_AVAILABLE' using errcode = 'P0001'; end if;
  select * into v_tenant from public.tenants where id = v_sub.tenant_id for update;

  if v_sub.kind = 'upgrade' then
    -- ترقية فورية: ارفع الحدود فقط، والمدة كما هي
    v_period_start := now();
    v_period_end   := v_tenant.subscription_ends_at;
    update public.subscriptions
      set status = 'approved', period_start = v_period_start, period_end = v_period_end,
          reviewed_by = auth.uid(), reviewed_at = now()
      where id = p_subscription_id;
    update public.tenants
      set allowed_fields = greatest(allowed_fields, coalesce(v_sub.requested_fields, allowed_fields)),
          allowed_staff  = greatest(allowed_staff,  coalesce(v_sub.requested_staff,  allowed_staff))
      where id = v_sub.tenant_id;
  else
    -- تجديد/جديد: مدّد المدة وارفع الحدود
    v_period_start := greatest(
      now(),
      coalesce(v_tenant.subscription_ends_at, '-infinity'::timestamptz),
      coalesce(v_tenant.trial_ends_at,        '-infinity'::timestamptz)
    );
    v_period_end := v_period_start + make_interval(days => v_plan.duration_days);
    update public.subscriptions
      set status = 'approved', period_start = v_period_start, period_end = v_period_end,
          reviewed_by = auth.uid(), reviewed_at = now()
      where id = p_subscription_id;
    update public.tenants
      set subscription_ends_at = v_period_end,
          subscription_status  = 'active',
          allowed_fields = greatest(allowed_fields, coalesce(v_sub.requested_fields, allowed_fields)),
          allowed_staff  = greatest(allowed_staff,  coalesce(v_sub.requested_staff,  allowed_staff))
      where id = v_sub.tenant_id;
  end if;

  return jsonb_build_object(
    'subscription_id', p_subscription_id,
    'kind',            v_sub.kind,
    'period_start',    v_period_start,
    'period_end',      v_period_end
  );
end;
$function$;

-- ── قوائم العرض: + kind ──
drop function if exists public.list_my_subscriptions();
create function public.list_my_subscriptions()
 returns table(id uuid, status text, kind text, amount numeric, payment_reference text, receipt_path text, note text,
   period_start timestamptz, period_end timestamptz, reviewed_at timestamptz, reject_reason text,
   created_at timestamptz, plan_name text, requested_fields integer, requested_staff integer)
 language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_tenant_id uuid := public.get_my_tenant_id();
begin
  if v_tenant_id is null then return; end if;
  return query
  select s.id, s.status, s.kind, s.amount, s.payment_reference, s.receipt_path, s.note,
         s.period_start, s.period_end, s.reviewed_at, s.reject_reason,
         s.created_at, p.name, s.requested_fields, s.requested_staff
  from public.subscriptions s
  join public.plans p on p.id = s.plan_id
  where s.tenant_id = v_tenant_id
  order by s.created_at desc;
end;
$function$;

drop function if exists public.admin_list_pending_subscriptions();
create function public.admin_list_pending_subscriptions()
 returns table(id uuid, tenant_id uuid, tenant_name text, plan_name text, kind text, amount numeric,
   payment_reference text, receipt_path text, note text, requested_fields integer, requested_staff integer,
   created_at timestamptz)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then raise exception 'NOT_SUPER_ADMIN' using errcode = 'P0001'; end if;
  return query
  select s.id, s.tenant_id, t.name, p.name, s.kind, s.amount, s.payment_reference, s.receipt_path, s.note,
         s.requested_fields, s.requested_staff, s.created_at
  from public.subscriptions s
  join public.tenants t on t.id = s.tenant_id
  join public.plans   p on p.id = s.plan_id
  where s.status = 'pending'
  order by s.created_at asc;
end;
$function$;

drop function if exists public.admin_list_subscriptions(text);
create function public.admin_list_subscriptions(p_status text default null)
 returns table(id uuid, tenant_id uuid, tenant_name text, status text, kind text, amount numeric,
   requested_fields integer, requested_staff integer, payment_reference text, receipt_path text, note text,
   period_start timestamptz, period_end timestamptz, created_at timestamptz, reviewed_at timestamptz, reject_reason text)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then raise exception 'NOT_SUPER_ADMIN' using errcode = 'P0001'; end if;
  return query
  select s.id, s.tenant_id, t.name, s.status, s.kind, s.amount, s.requested_fields, s.requested_staff,
         s.payment_reference, s.receipt_path, s.note, s.period_start, s.period_end, s.created_at, s.reviewed_at, s.reject_reason
  from public.subscriptions s
  join public.tenants t on t.id = s.tenant_id
  where (p_status is null or s.status = p_status)
  order by s.created_at desc
  limit 500;
end;
$function$;
