-- نظام تتبع الزيارات (١/٣): الجداول الخام + دوال الاستقبال المجهولة
-- ----------------------------------------------------------------------------
-- المصدر: زوّار الصفحات العامة (الرئيسية، صفحة الحجز، صفحات auth) عبر
-- دالة الحافة /api/vt التي تُثري الحمولة (جغرافيا/جهاز/ip_hash) ثم تستدعي
-- record_visit بمفتاح anon. لا كوكيز: visitor_id معرّف عشوائي أول-طرف من
-- localStorage، وip_hash تجزئة يومية مُملّحة تُستخدم لحدود المعدل فقط (ليست هوية).
--
-- الخصوصية: لا يُخزَّن IP خام ولا أي مُعرِّف شخصي. RLS مفعّل بلا سياسات
-- (نمط admin_audit_log) — كل القراءة عبر دوال إحصاء SECURITY DEFINER لاحقة.

-- ─── جدول المشاهدات الخام ───
create table if not exists public.page_visits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade, -- null = الرئيسية/auth
  page text not null check (page in ('landing','auth_login','auth_signup','book','book_field')),
  field_id uuid references public.fields(id) on delete set null,
  visitor_id uuid not null,          -- marma:vid من localStorage
  session_id uuid not null,          -- marma:sid نافذة 30 دقيقة متجددة
  ip_hash text,                      -- sha256(اليوم + ملح + IP) — لمنع الإغراق فقط
  referrer text,
  ref_domain text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  device_type text check (device_type in ('mobile','tablet','desktop')),
  browser text,
  os text,
  country text,                      -- ISO-3166 alpha-2 من Cloudflare
  city text,
  language text,
  entered_at timestamptz not null default now(),
  duration_seconds integer           -- يُملأ لاحقًا عبر beacon المغادرة (تقديري)
);

create index if not exists page_visits_tenant_entered_idx on public.page_visits (tenant_id, entered_at desc);
create index if not exists page_visits_entered_idx on public.page_visits (entered_at desc);
create index if not exists page_visits_session_idx on public.page_visits (session_id);
create index if not exists page_visits_ip_hash_idx on public.page_visits (ip_hash, entered_at desc);

-- ─── جدول أحداث القُمع (بدء حجز / حجز مُنشأ) ───
create table if not exists public.visit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_type text not null check (event_type in ('booking_start','booking_created')),
  field_id uuid references public.fields(id) on delete set null,
  visitor_id uuid not null,
  session_id uuid not null,
  booking_id uuid references public.bookings(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists visit_events_tenant_created_idx on public.visit_events (tenant_id, created_at desc);
create index if not exists visit_events_session_idx on public.visit_events (session_id);

-- RLS مفعّل بلا أي سياسات → لا وصول مباشر لأي دور؛ القراءة/الكتابة عبر الدوال فقط
alter table public.page_visits enable row level security;
alter table public.visit_events enable row level security;

-- ─── تسجيل مشاهدة صفحة ───
-- إسقاط صامت (تعيد null) عند أي خلل — دالة عامة يجب ألا تكسر صفحة زائر أبدًا.
create or replace function public.record_visit(
  p_page text,
  p_tenant_id uuid default null,
  p_field_id uuid default null,
  p_visitor_id uuid default null,
  p_session_id uuid default null,
  p_referrer text default null,
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_device text default null,
  p_browser text default null,
  p_os text default null,
  p_country text default null,
  p_city text default null,
  p_language text default null,
  p_ip_hash text default null
) returns uuid
language plpgsql volatile security definer set search_path to 'public' as $$
declare
  v_id uuid;
  v_ref_domain text;
begin
  if p_page is null or p_page not in ('landing','auth_login','auth_signup','book','book_field') then
    return null;
  end if;
  if p_visitor_id is null or p_session_id is null then
    return null;
  end if;

  -- صفحات الحجز يجب أن تحمل ملعبًا موجودًا فعلاً؛ غيرها لا يتبع ملعبًا
  if p_page in ('book','book_field') then
    if p_tenant_id is null or not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
      return null;
    end if;
  else
    p_tenant_id := null;
  end if;

  -- field_id لا يُقبل إلا إن كان تابعًا للملعب نفسه
  if p_field_id is not null and (p_tenant_id is null or not exists (
    select 1 from public.fields f where f.id = p_field_id and f.tenant_id = p_tenant_id
  )) then
    p_field_id := null;
  end if;

  -- حدود المعدل (حماية من الإغراق): 60/دقيقة لكل ip_hash و2000/يوم لكل زائر
  if p_ip_hash is not null and (
    select count(*) from public.page_visits v
    where v.ip_hash = p_ip_hash and v.entered_at > now() - interval '1 minute'
  ) >= 60 then
    return null;
  end if;
  if (
    select count(*) from public.page_visits v
    where v.visitor_id = p_visitor_id and v.entered_at > now() - interval '1 day'
  ) >= 2000 then
    return null;
  end if;

  if p_device is not null and p_device not in ('mobile','tablet','desktop') then
    p_device := null;
  end if;

  -- نطاق المُحيل يُشتق هنا كي يبقى عقد الحافة بسيطًا
  v_ref_domain := lower(substring(p_referrer from '^[a-zA-Z][a-zA-Z0-9+.-]*://(?:[^@/]*@)?([^:/?#]+)'));

  insert into public.page_visits (
    tenant_id, page, field_id, visitor_id, session_id, ip_hash,
    referrer, ref_domain, utm_source, utm_medium, utm_campaign,
    device_type, browser, os, country, city, language
  ) values (
    p_tenant_id, p_page, p_field_id, p_visitor_id, p_session_id, left(p_ip_hash, 64),
    nullif(left(p_referrer, 500), ''), nullif(left(v_ref_domain, 100), ''),
    nullif(left(p_utm_source, 100), ''), nullif(left(p_utm_medium, 100), ''), nullif(left(p_utm_campaign, 100), ''),
    p_device, nullif(left(p_browser, 40), ''), nullif(left(p_os, 40), ''),
    nullif(upper(left(p_country, 2)), ''), nullif(left(p_city, 80), ''), nullif(left(p_language, 10), '')
  ) returning id into v_id;

  return v_id;
exception when others then
  return null;
end;
$$;

-- ─── تحديث مدة الزيارة عند المغادرة ───
-- id الصف (uuid عشوائي أعاده record_visit) هو التوكن: لا يزيد المدة إلا هو،
-- زيادةً فقط، بسقف 6 ساعات، وعلى صفوف حديثة فقط.
create or replace function public.record_visit_leave(p_visit_id uuid, p_seconds integer)
returns void
language sql volatile security definer set search_path to 'public' as $$
  update public.page_visits
  set duration_seconds = greatest(coalesce(duration_seconds, 0), least(greatest(coalesce(p_seconds, 0), 0), 21600))
  where id = p_visit_id
    and entered_at > now() - interval '6 hours';
$$;

-- ─── تسجيل حدث قُمع (بدء حجز / حجز مُنشأ) ───
create or replace function public.record_visit_event(
  p_event_type text,
  p_tenant_id uuid default null,
  p_field_id uuid default null,
  p_visitor_id uuid default null,
  p_session_id uuid default null,
  p_booking_id uuid default null
) returns void
language plpgsql volatile security definer set search_path to 'public' as $$
begin
  if p_event_type is null or p_event_type not in ('booking_start','booking_created') then return; end if;
  if p_visitor_id is null or p_session_id is null then return; end if;
  if p_tenant_id is null or not exists (select 1 from public.tenants t where t.id = p_tenant_id) then return; end if;

  if p_field_id is not null and not exists (
    select 1 from public.fields f where f.id = p_field_id and f.tenant_id = p_tenant_id
  ) then
    p_field_id := null;
  end if;

  -- الحجز المربوط يجب أن يتبع الملعب نفسه وإلا يُصفَّر
  if p_booking_id is not null and not exists (
    select 1 from public.bookings b where b.id = p_booking_id and b.tenant_id = p_tenant_id
  ) then
    p_booking_id := null;
  end if;

  -- حد المعدل: 100 حدث/ساعة للجلسة الواحدة
  if (
    select count(*) from public.visit_events e
    where e.session_id = p_session_id and e.created_at > now() - interval '1 hour'
  ) >= 100 then
    return;
  end if;

  insert into public.visit_events (tenant_id, event_type, field_id, visitor_id, session_id, booking_id)
  values (p_tenant_id, p_event_type, p_field_id, p_visitor_id, p_session_id, p_booking_id);
exception when others then
  return;
end;
$$;

-- ─── الصلاحيات: دوال الاستقبال متاحة للزوار (anon) — نمط create_pending_booking ───
revoke all on function public.record_visit(text, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.record_visit(text, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text, text) to anon, authenticated;

revoke all on function public.record_visit_leave(uuid, integer) from public;
grant execute on function public.record_visit_leave(uuid, integer) to anon, authenticated;

revoke all on function public.record_visit_event(text, uuid, uuid, uuid, uuid, uuid) from public;
grant execute on function public.record_visit_event(text, uuid, uuid, uuid, uuid, uuid) to anon, authenticated;
