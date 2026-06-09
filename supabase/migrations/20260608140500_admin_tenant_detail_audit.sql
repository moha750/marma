-- تضمين سجلّ الإجراءات ضمن تفاصيل الملعب (مفتاح audit)
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
      'suspended', v_tenant.suspended
    ),
    'is_active', public.is_tenant_active(p_tenant_id),
    'owner', jsonb_build_object('full_name', v_owner_name, 'email', v_owner_email),
    'counts', jsonb_build_object('fields', v_fields, 'staff', v_staff, 'bookings', v_bookings),
    'subscriptions', v_subs,
    'audit', v_audit
  );
end;
$function$;
