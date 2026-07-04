-- ═══════════════════════════════════════════════════════════
-- نظام الإشعارات داخل التطبيق (جرس) — شامل للملاك والأدمن
-- تغطية مضمونة عبر مُحفِّزات قاعدة البيانات (أي مصدر للحدث يُنشئ إشعارًا).
-- ═══════════════════════════════════════════════════════════

-- 1) الجداول ─────────────────────────────────────────────────
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  audience   text not null check (audience in ('owner','admin')),
  tenant_id  uuid references public.tenants(id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text,
  link       text,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_tenant   on public.notifications (tenant_id, created_at desc);
create index if not exists idx_notifications_audience  on public.notifications (audience, created_at desc);

create table if not exists public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (notification_id, user_id)
);
create index if not exists idx_notification_reads_user on public.notification_reads (user_id);

-- 2) RLS ─────────────────────────────────────────────────────
alter table public.notifications      enable row level security;
alter table public.notification_reads enable row level security;

-- المالك/الموظف يرى إشعارات منشأته؛ المشرف يرى إشعارات الإدارة
create policy notifications_select on public.notifications
  for select to authenticated
  using (
    (audience = 'owner' and tenant_id = get_my_tenant_id())
    or (audience = 'admin' and is_super_admin())
  );

-- حالة القراءة خاصّة بكل مستخدم
create policy notification_reads_select on public.notification_reads
  for select to authenticated using (user_id = auth.uid());
create policy notification_reads_insert on public.notification_reads
  for insert to authenticated with check (user_id = auth.uid());

-- 3) دوال العميل (RPCs) — SECURITY INVOKER فتُطبَّق RLS تلقائيًّا ─
create or replace function public.list_notifications(p_limit int default 30)
returns table (id uuid, type text, title text, body text, link text, data jsonb, created_at timestamptz, is_read boolean)
language sql stable security invoker set search_path to 'public' as $$
  select n.id, n.type, n.title, n.body, n.link, n.data, n.created_at,
         (r.notification_id is not null) as is_read
  from public.notifications n
  left join public.notification_reads r
    on r.notification_id = n.id and r.user_id = auth.uid()
  order by n.created_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;

create or replace function public.unread_notifications_count()
returns integer
language sql stable security invoker set search_path to 'public' as $$
  select count(*)::int
  from public.notifications n
  where not exists (
    select 1 from public.notification_reads r
    where r.notification_id = n.id and r.user_id = auth.uid()
  );
$$;

create or replace function public.mark_notification_read(p_id uuid)
returns void
language sql volatile security invoker set search_path to 'public' as $$
  insert into public.notification_reads (notification_id, user_id)
  select p_id, auth.uid()
  where exists (select 1 from public.notifications n where n.id = p_id)
  on conflict (notification_id, user_id) do nothing;
$$;

create or replace function public.mark_all_notifications_read()
returns void
language sql volatile security invoker set search_path to 'public' as $$
  insert into public.notification_reads (notification_id, user_id)
  select n.id, auth.uid() from public.notifications n
  on conflict (notification_id, user_id) do nothing;
$$;

-- 4) مُنشئ الإشعار (SECURITY DEFINER لتجاوز RLS عند الإدراج) ───
create or replace function public.notify_create(
  p_audience text, p_tenant_id uuid, p_type text,
  p_title text, p_body text, p_link text, p_data jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.notifications(audience, tenant_id, type, title, body, link, data)
  values (p_audience, p_tenant_id, p_type, p_title, p_body, p_link, coalesce(p_data, '{}'::jsonb));
end $$;

-- 5) المُحفِّزات ──────────────────────────────────────────────

-- حجوزات: جديد (pending) + إلغاء عميل (cancelled_by IS NULL)
create or replace function public.trg_notify_booking() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_field text;
begin
  if TG_OP = 'INSERT' then
    if NEW.status = 'pending' then
      select name into v_field from public.fields where id = NEW.field_id;
      perform public.notify_create('owner', NEW.tenant_id, 'booking_new',
        'حجز جديد',
        coalesce(NEW.customer_input_name, 'عميل') || ' — ' || coalesce(v_field, 'ملعب'),
        '/bookings', jsonb_build_object('booking_id', NEW.id));
    end if;
  elsif TG_OP = 'UPDATE' then
    if NEW.status = 'cancelled' and OLD.status is distinct from 'cancelled' and NEW.cancelled_by is null then
      select name into v_field from public.fields where id = NEW.field_id;
      perform public.notify_create('owner', NEW.tenant_id, 'booking_cancelled',
        'أُلغي حجز',
        coalesce(NEW.customer_input_name, 'عميل') || ' — ' || coalesce(v_field, 'ملعب'),
        '/bookings', jsonb_build_object('booking_id', NEW.id));
    end if;
  end if;
  return null;
end $$;
drop trigger if exists notify_booking on public.bookings;
create trigger notify_booking after insert or update on public.bookings
  for each row execute function public.trg_notify_booking();

-- اشتراكات: طلب جديد (→أدمن) + موافقة/رفض (→مالك)
create or replace function public.trg_notify_subscription() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_tname text;
begin
  if TG_OP = 'INSERT' then
    if NEW.status = 'pending' then
      select name into v_tname from public.tenants where id = NEW.tenant_id;
      perform public.notify_create('admin', NEW.tenant_id, 'subscription_request',
        'طلب اشتراك جديد', coalesce(v_tname, 'منشأة'), '/admin/subscriptions',
        jsonb_build_object('subscription_id', NEW.id));
    end if;
  elsif TG_OP = 'UPDATE' then
    if OLD.status = 'pending' and NEW.status = 'approved' then
      perform public.notify_create('owner', NEW.tenant_id, 'subscription_approved',
        'تمت الموافقة على اشتراكك', 'صار حسابك مفعّلًا — شكرًا لك.', '/subscription', '{}'::jsonb);
    elsif OLD.status = 'pending' and NEW.status = 'rejected' then
      perform public.notify_create('owner', NEW.tenant_id, 'subscription_rejected',
        'رُفض طلب اشتراكك', NEW.reject_reason, '/subscription', '{}'::jsonb);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists notify_subscription on public.subscriptions;
create trigger notify_subscription after insert or update on public.subscriptions
  for each row execute function public.trg_notify_subscription();

-- منشآت: جديدة (→أدمن) + تعليق/تفعيل/وصول دائم/تمديد تجربة (→مالك)
create or replace function public.trg_notify_tenant() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if TG_OP = 'INSERT' then
    perform public.notify_create('admin', NEW.id, 'tenant_new',
      'منشأة جديدة', NEW.name, '/admin/tenants', jsonb_build_object('tenant_id', NEW.id));
  elsif TG_OP = 'UPDATE' then
    if NEW.suspended is true and OLD.suspended is distinct from true then
      perform public.notify_create('owner', NEW.id, 'account_suspended',
        'تم تعليق حسابك', 'تواصل مع الإدارة لمعرفة التفاصيل.', '/subscription', '{}'::jsonb);
    end if;
    if NEW.suspended is false and OLD.suspended is distinct from false then
      perform public.notify_create('owner', NEW.id, 'account_unsuspended',
        'أُعيد تفعيل حسابك', 'مرحبًا بعودتك — حسابك يعمل الآن.', '/dashboard', '{}'::jsonb);
    end if;
    if NEW.lifetime is true and OLD.lifetime is distinct from true then
      perform public.notify_create('owner', NEW.id, 'lifetime_granted',
        'مُنِحت وصولًا دائمًا 💎', 'كل المميزات مفتوحة بلا حدود.', '/subscription', '{}'::jsonb);
    end if;
    if NEW.trial_ends_at is not null and OLD.trial_ends_at is not null and NEW.trial_ends_at > OLD.trial_ends_at then
      perform public.notify_create('owner', NEW.id, 'trial_extended',
        'تم تمديد تجربتك', 'استمتع بوقتٍ إضافي لتجربة النظام.', '/subscription', '{}'::jsonb);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists notify_tenant on public.tenants;
create trigger notify_tenant after insert or update on public.tenants
  for each row execute function public.trg_notify_tenant();

-- ملفات: انضمام موظف جديد (→مالك)
create or replace function public.trg_notify_profile() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if TG_OP = 'INSERT' and NEW.role = 'staff' then
    perform public.notify_create('owner', NEW.tenant_id, 'staff_joined',
      'انضمّ موظف جديد', coalesce(NEW.full_name, 'موظف'), '/staff',
      jsonb_build_object('profile_id', NEW.id));
  end if;
  return null;
end $$;
drop trigger if exists notify_profile on public.profiles;
create trigger notify_profile after insert on public.profiles
  for each row execute function public.trg_notify_profile();

-- بثّ الإدارة (audience='owners') → إشعار لكل مالك
create or replace function public.trg_notify_broadcast() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if NEW.audience = 'owners' then
    insert into public.notifications(audience, tenant_id, type, title, body, link, data)
    select 'owner', p.tenant_id, 'broadcast', NEW.title, NEW.body, '/dashboard',
           jsonb_build_object('broadcast_id', NEW.id)
    from public.profiles p
    where p.role = 'owner' and p.tenant_id is not null;
  end if;
  return null;
end $$;
drop trigger if exists notify_broadcast on public.broadcasts;
create trigger notify_broadcast after insert on public.broadcasts
  for each row execute function public.trg_notify_broadcast();

-- 6) Realtime ────────────────────────────────────────────────
alter publication supabase_realtime add table public.notifications;
