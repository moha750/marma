-- سجلّ نشاط المشرفين: كل إجراء إداري يُسجَّل (مَن/ماذا/أي ملعب/التفاصيل/متى)
create table if not exists public.admin_audit_log (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid references auth.users(id) on delete set null,
  action     text not null,
  tenant_id  uuid references public.tenants(id) on delete set null,
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.admin_audit_log enable row level security;
-- لا سياسات → الوصول فقط عبر SECURITY DEFINER
create index if not exists idx_audit_tenant on public.admin_audit_log(tenant_id, created_at desc);
create index if not exists idx_audit_created on public.admin_audit_log(created_at desc);

-- دالة التسجيل الداخلية (تُستدعى من دوال الإجراءات)
create or replace function public.admin_log_action(p_action text, p_tenant_id uuid, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.admin_audit_log(actor_id, action, tenant_id, details)
  values (auth.uid(), p_action, p_tenant_id, coalesce(p_details, '{}'::jsonb));
$$;

-- ── ربط دوال الإجراءات بالتسجيل ──

-- تفعيل/تعطيل
create or replace function public.admin_set_tenant_active(p_tenant_id uuid, p_active boolean)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then raise exception 'NOT_SUPER_ADMIN' using errcode = 'P0001'; end if;
  update public.tenants set suspended = not p_active where id = p_tenant_id;
  if not found then raise exception 'الملعب غير موجود' using errcode = 'P0001'; end if;
  perform public.admin_log_action(
    case when p_active then 'activate' else 'suspend' end, p_tenant_id, '{}'::jsonb);
end;
$function$;

-- تمديد/بدء التجربة
create or replace function public.admin_extend_trial(p_tenant_id uuid, p_days integer)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_new timestamptz;
begin
  if not public.is_super_admin() then raise exception 'NOT_SUPER_ADMIN' using errcode = 'P0001'; end if;
  if p_days is null or p_days <= 0 then raise exception 'عدد الأيام غير صالح' using errcode = 'P0001'; end if;
  update public.tenants
  set trial_ends_at = greatest(coalesce(trial_ends_at, now()), now()) + make_interval(days => p_days)
  where id = p_tenant_id
  returning trial_ends_at into v_new;
  if not found then raise exception 'الملعب غير موجود' using errcode = 'P0001'; end if;
  perform public.admin_log_action('extend_trial', p_tenant_id,
    jsonb_build_object('days', p_days, 'until', v_new));
end;
$function$;

-- منح/تمديد اشتراك يدوي
create or replace function public.admin_grant_subscription(p_tenant_id uuid, p_days integer, p_fields integer, p_staff integer)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_tenant record; v_end timestamptz;
begin
  if not public.is_super_admin() then raise exception 'NOT_SUPER_ADMIN' using errcode = 'P0001'; end if;
  if p_days is null or p_days <= 0 then raise exception 'عدد الأيام غير صالح' using errcode = 'P0001'; end if;
  select * into v_tenant from public.tenants where id = p_tenant_id for update;
  if not found then raise exception 'الملعب غير موجود' using errcode = 'P0001'; end if;
  v_end := greatest(
    now(),
    coalesce(v_tenant.subscription_ends_at, '-infinity'::timestamptz),
    coalesce(v_tenant.trial_ends_at,        '-infinity'::timestamptz)
  ) + make_interval(days => p_days);
  update public.tenants
  set subscription_ends_at = v_end,
      subscription_status  = 'active',
      suspended = false,
      allowed_fields = coalesce(p_fields, allowed_fields),
      allowed_staff  = coalesce(p_staff, allowed_staff)
  where id = p_tenant_id;
  perform public.admin_log_action('grant_subscription', p_tenant_id,
    jsonb_build_object('days', p_days, 'fields', p_fields, 'staff', p_staff, 'until', v_end));
end;
$function$;

-- ضبط الحدود فقط (يسجّل القيم قبل/بعد)
create or replace function public.admin_set_limits(p_tenant_id uuid, p_fields integer, p_staff integer)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_of integer; v_os integer;
begin
  if not public.is_super_admin() then raise exception 'NOT_SUPER_ADMIN' using errcode = 'P0001'; end if;
  if p_fields is null or p_fields < 0 or p_staff is null or p_staff < 0 then
    raise exception 'قيمة غير صالحة' using errcode = 'P0001';
  end if;
  select allowed_fields, allowed_staff into v_of, v_os from public.tenants where id = p_tenant_id;
  if not found then raise exception 'الملعب غير موجود' using errcode = 'P0001'; end if;
  update public.tenants set allowed_fields = p_fields, allowed_staff = p_staff where id = p_tenant_id;
  perform public.admin_log_action('set_limits', p_tenant_id,
    jsonb_build_object('fields_from', v_of, 'fields_to', p_fields, 'staff_from', v_os, 'staff_to', p_staff));
end;
$function$;

-- ── قراءة السجلّ العام (مع تصفية اختيارية بملعب) ──
create or replace function public.admin_list_audit_log(p_tenant_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v jsonb;
begin
  if not public.is_super_admin() then raise exception 'forbidden'; end if;
  select coalesce(jsonb_agg(x order by ord desc), '[]'::jsonb) into v
  from (
    select jsonb_build_object(
      'id', a.id, 'action', a.action, 'details', a.details, 'created_at', a.created_at,
      'tenant_id', a.tenant_id, 'tenant_name', t.name,
      'actor', coalesce(u.raw_user_meta_data->>'display_name', u.raw_user_meta_data->>'full_name', u.email)
    ) as x, a.created_at as ord
    from public.admin_audit_log a
    left join public.tenants t on t.id = a.tenant_id
    left join auth.users u on u.id = a.actor_id
    where (p_tenant_id is null or a.tenant_id = p_tenant_id)
    order by a.created_at desc
    limit 200
  ) s;
  return v;
end $$;
