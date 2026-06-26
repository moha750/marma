-- إضافة suspended و lifetime لقائمة الملاعب (لعرض الحالة الصحيحة في اللوحة)
drop function if exists public.admin_list_tenants();
create function public.admin_list_tenants()
 returns table(id uuid, name text, cities text, trial_ends_at timestamptz,
   subscription_ends_at timestamptz, subscription_status text, is_active boolean,
   suspended boolean, lifetime boolean, created_at timestamptz, last_subscription_at timestamptz)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then raise exception 'NOT_SUPER_ADMIN' using errcode = 'P0001'; end if;
  return query
  select
    t.id, t.name,
    (select string_agg(distinct f.city, ' · ' order by f.city)
       from public.fields f
       where f.tenant_id = t.id and f.city is not null and f.city <> '') as cities,
    t.trial_ends_at, t.subscription_ends_at, t.subscription_status,
    public.is_tenant_active(t.id) as is_active,
    coalesce(t.suspended, false) as suspended,
    coalesce(t.lifetime, false) as lifetime,
    t.created_at,
    (select max(s.reviewed_at) from public.subscriptions s
     where s.tenant_id = t.id and s.status = 'approved') as last_subscription_at
  from public.tenants t
  order by t.created_at desc;
end;
$function$;
