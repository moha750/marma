-- بثّ إشعار/بريد لكل ملّاك الملاعب + سجلّ بثّات
create table if not exists public.broadcasts (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text not null,
  channels    text[] not null default '{}',
  audience    text not null default 'owners',
  recipients  int  not null default 0,
  push_sent   int  not null default 0,
  email_sent  int  not null default 0,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
alter table public.broadcasts enable row level security;
-- لا سياسات → الوصول فقط عبر service role / SECURITY DEFINER

-- أعداد الجمهور (للعرض في النموذج قبل الإرسال)
create or replace function public.admin_broadcast_audience_counts()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'owners', (select count(*) from profiles where role = 'owner'),
    'push_devices', (select count(*) from push_subscriptions ps
                      where ps.user_id in (select id from profiles where role = 'owner'))
  );
end $$;

-- المستلمون الفعليون (تُستدعى من الدالة الطرفية بـ JWT المشرف)
create or replace function public.admin_broadcast_targets()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'owners', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', p.id, 'email', u.email, 'name', coalesce(p.full_name, u.email)))
      from profiles p join auth.users u on u.id = p.id
      where p.role = 'owner' and u.email is not null
    ), '[]'::jsonb),
    'push', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ps.id, 'endpoint', ps.endpoint, 'p256dh', ps.p256dh_key, 'auth', ps.auth_key))
      from push_subscriptions ps
      where ps.user_id in (select id from profiles where role = 'owner')
    ), '[]'::jsonb)
  );
end $$;

-- تسجيل بدء البثّ (auth.uid من JWT المشرف) → يُرجع المعرّف
create or replace function public.admin_log_broadcast(p_title text, p_body text, p_channels text[], p_recipients int)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if not public.is_super_admin() then raise exception 'forbidden'; end if;
  insert into broadcasts(title, body, channels, recipients, created_by)
  values (p_title, p_body, p_channels, p_recipients, auth.uid())
  returning id into new_id;
  return new_id;
end $$;

-- سجلّ البثّات السابقة
create or replace function public.admin_list_broadcasts()
returns setof public.broadcasts language sql security definer set search_path = public stable as $$
  select * from public.broadcasts
  where public.is_super_admin()
  order by created_at desc
  limit 50;
$$;
