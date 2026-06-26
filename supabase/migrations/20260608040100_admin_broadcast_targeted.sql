-- دعم البثّ لملّاك محدّدين + قائمة الملّاك للمنتقي

-- قائمة الملّاك (للمنتقي): الاسم، البريد، الملعب، هل لديه جهاز إشعارات
create or replace function public.admin_broadcast_owners()
returns jsonb language plpgsql security definer set search_path = public stable as $$
begin
  if not public.is_super_admin() then raise exception 'forbidden'; end if;
  return coalesce((
    select jsonb_agg(o order by o->>'tenant_name', o->>'name')
    from (
      select jsonb_build_object(
        'user_id', p.id,
        'name', coalesce(p.full_name, u.email),
        'email', u.email,
        'tenant_name', t.name,
        'has_push', exists(select 1 from push_subscriptions ps where ps.user_id = p.id)
      ) as o
      from profiles p
      join auth.users u on u.id = p.id
      left join tenants t on t.id = p.tenant_id
      where p.role = 'owner' and u.email is not null
    ) s
  ), '[]'::jsonb);
end $$;

-- المستلمون الفعليون — مع تصفية اختيارية بقائمة معرّفات
drop function if exists public.admin_broadcast_targets();
create or replace function public.admin_broadcast_targets(p_user_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'owners', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', p.id, 'email', u.email, 'name', coalesce(p.full_name, u.email)))
      from profiles p join auth.users u on u.id = p.id
      where p.role = 'owner' and u.email is not null
        and (p_user_ids is null or p.id = any(p_user_ids))
    ), '[]'::jsonb),
    'push', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ps.id, 'endpoint', ps.endpoint, 'p256dh', ps.p256dh_key, 'auth', ps.auth_key))
      from push_subscriptions ps
      where ps.user_id in (select id from profiles where role = 'owner')
        and (p_user_ids is null or ps.user_id = any(p_user_ids))
    ), '[]'::jsonb)
  );
end $$;

-- سجّل البثّ مع نوع الجمهور
drop function if exists public.admin_log_broadcast(text, text, text[], int);
create or replace function public.admin_log_broadcast(
  p_title text, p_body text, p_channels text[], p_recipients int, p_audience text default 'owners')
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if not public.is_super_admin() then raise exception 'forbidden'; end if;
  insert into broadcasts(title, body, channels, recipients, audience, created_by)
  values (p_title, p_body, p_channels, p_recipients, coalesce(p_audience, 'owners'), auth.uid())
  returning id into new_id;
  return new_id;
end $$;
