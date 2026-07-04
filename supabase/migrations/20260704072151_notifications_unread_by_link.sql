-- عدّ الإشعارات غير المقروءة مجمّعة حسب الوجهة (link) — لوضع شارة على التبويب المعنيّ.
create or replace function public.unread_notifications_by_link()
returns table(link text, cnt integer)
language sql stable security invoker set search_path to 'public' as $$
  select coalesce(n.link, '') as link, count(*)::int as cnt
  from public.notifications n
  where not exists (
    select 1 from public.notification_reads r
    where r.notification_id = n.id and r.user_id = auth.uid()
  )
  group by n.link;
$$;

-- تعليم كل إشعارات وجهة معيّنة كمقروءة (عند فتح التبويب المعنيّ).
create or replace function public.mark_notifications_read_by_link(p_link text)
returns void
language sql volatile security invoker set search_path to 'public' as $$
  insert into public.notification_reads (notification_id, user_id)
  select n.id, auth.uid() from public.notifications n
  where n.link = p_link
  on conflict (notification_id, user_id) do nothing;
$$;
