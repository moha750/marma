-- نظام تتبع الزيارات (٢/٣): دوال الإحصاء والعرض
-- ----------------------------------------------------------------------------
-- visits_stats_for: المجمّع المركزي (خاص — لا يُستدعى مباشرة من العملاء).
-- tenant_visits_stats: للمالك (نطاق ملعبه عبر get_my_tenant_id).
-- admin_visits_stats / admin_tenant_visits: للمشرف العام (حارس is_super_admin).
-- visits_live_now: عدّاد "متصلون الآن" (جلسات آخر 5 دقائق) — يُستطلع كل 30 ثانية.
-- كل التجميع اليومي/الساعي بتوقيت الرياض (SET timezone على مستوى الدالة).

-- ─── المجمّع المركزي (p_tenant_id = null → المنصّة كاملة) ───
create or replace function public.visits_stats_for(p_tenant_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
set timezone to 'Asia/Riyadh'
as $$
declare
  v_views int; v_visitors int; v_sessions int; v_avg_duration int;
  v_bounce numeric; v_starts int; v_bookings int; v_live int;
  v_daily jsonb; v_sources jsonb; v_devices jsonb; v_countries jsonb; v_cities jsonb;
  v_fields jsonb; v_heatmap jsonb;
  v_book_views int; v_field_views int;
begin
  -- تثبيت النطاق: حد أقصى سنة للخلف (الأقدم في جدول التجميع اليومي)
  p_to := least(coalesce(p_to, current_date), current_date);
  p_from := coalesce(p_from, p_to - 29);
  p_from := greatest(p_from, current_date - 365);
  if p_from > p_to then p_from := p_to; end if;

  -- الإجماليات
  select count(*)::int,
         count(distinct visitor_id)::int,
         count(distinct session_id)::int,
         coalesce(round(avg(duration_seconds))::int, 0),
         count(*) filter (where page = 'book')::int,
         count(*) filter (where page = 'book_field')::int
  into v_views, v_visitors, v_sessions, v_avg_duration, v_book_views, v_field_views
  from public.page_visits
  where (p_tenant_id is null or tenant_id = p_tenant_id)
    and entered_at::date between p_from and p_to;

  -- الارتداد: جلسات بمشاهدة واحدة فقط (يُحسب وقت الاستعلام — لا يُخزَّن)
  select coalesce(round(100.0 * count(*) filter (where c = 1) / nullif(count(*), 0), 1), 0)
  into v_bounce
  from (
    select session_id, count(*) as c
    from public.page_visits
    where (p_tenant_id is null or tenant_id = p_tenant_id)
      and entered_at::date between p_from and p_to
    group by session_id
  ) s;

  -- أحداث القُمع
  select coalesce(count(*) filter (where event_type = 'booking_start'), 0)::int,
         coalesce(count(*) filter (where event_type = 'booking_created'), 0)::int
  into v_starts, v_bookings
  from public.visit_events
  where (p_tenant_id is null or tenant_id = p_tenant_id)
    and created_at::date between p_from and p_to;

  -- متصلون الآن (مستقل عن نطاق التاريخ)
  select count(distinct session_id)::int into v_live
  from public.page_visits
  where (p_tenant_id is null or tenant_id = p_tenant_id)
    and entered_at > now() - interval '5 minutes';

  -- السلسلة اليومية
  select coalesce(jsonb_agg(jsonb_build_object(
           'date', to_char(days.d, 'YYYY-MM-DD'),
           'views', coalesce(agg.views, 0),
           'visitors', coalesce(agg.visitors, 0)) order by days.d), '[]'::jsonb)
  into v_daily
  from (select generate_series(p_from, p_to, interval '1 day')::date as d) days
  left join (
    select entered_at::date as d, count(*)::int as views, count(distinct visitor_id)::int as visitors
    from public.page_visits
    where (p_tenant_id is null or tenant_id = p_tenant_id)
      and entered_at::date between p_from and p_to
    group by 1
  ) agg on agg.d = days.d;

  -- المصادر: utm_source ثم نطاق المُحيل ثم "مباشر"
  select coalesce(jsonb_agg(jsonb_build_object('source', s.src, 'views', s.views, 'visitors', s.visitors) order by s.views desc), '[]'::jsonb)
  into v_sources
  from (
    select coalesce(nullif(utm_source, ''), ref_domain, 'مباشر') as src,
           count(*)::int as views, count(distinct visitor_id)::int as visitors
    from public.page_visits
    where (p_tenant_id is null or tenant_id = p_tenant_id)
      and entered_at::date between p_from and p_to
    group by 1 order by 2 desc limit 10
  ) s;

  -- الأجهزة
  select coalesce(jsonb_agg(jsonb_build_object('device', s.device, 'views', s.views, 'visitors', s.visitors) order by s.views desc), '[]'::jsonb)
  into v_devices
  from (
    select coalesce(device_type, 'unknown') as device,
           count(*)::int as views, count(distinct visitor_id)::int as visitors
    from public.page_visits
    where (p_tenant_id is null or tenant_id = p_tenant_id)
      and entered_at::date between p_from and p_to
    group by 1
  ) s;

  -- الدول والمدن
  select coalesce(jsonb_agg(jsonb_build_object('country', s.country, 'views', s.views, 'visitors', s.visitors) order by s.views desc), '[]'::jsonb)
  into v_countries
  from (
    select country, count(*)::int as views, count(distinct visitor_id)::int as visitors
    from public.page_visits
    where (p_tenant_id is null or tenant_id = p_tenant_id)
      and entered_at::date between p_from and p_to
    group by 1 order by 2 desc limit 10
  ) s;

  select coalesce(jsonb_agg(jsonb_build_object('city', s.city, 'country', s.country, 'views', s.views) order by s.views desc), '[]'::jsonb)
  into v_cities
  from (
    select city, country, count(*)::int as views
    from public.page_visits
    where (p_tenant_id is null or tenant_id = p_tenant_id)
      and entered_at::date between p_from and p_to
      and city is not null
    group by 1, 2 order by 3 desc limit 10
  ) s;

  -- الأرضيات (لنطاق ملعب فقط): مشاهدات صفحة الأرضية + حجوزات القُمع لكل أرضية
  if p_tenant_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('field_id', x.field_id, 'name', x.name, 'views', x.views, 'bookings', x.bookings)
                              order by x.views desc, x.bookings desc), '[]'::jsonb)
    into v_fields
    from (
      select f.id as field_id, f.name, coalesce(pv.views, 0) as views, coalesce(ev.bookings, 0) as bookings
      from public.fields f
      left join (
        select field_id, count(*)::int as views
        from public.page_visits
        where tenant_id = p_tenant_id and page = 'book_field'
          and entered_at::date between p_from and p_to and field_id is not null
        group by 1
      ) pv on pv.field_id = f.id
      left join (
        select field_id, count(*)::int as bookings
        from public.visit_events
        where tenant_id = p_tenant_id and event_type = 'booking_created'
          and created_at::date between p_from and p_to and field_id is not null
        group by 1
      ) ev on ev.field_id = f.id
      where f.tenant_id = p_tenant_id
      order by 3 desc, 4 desc
      limit 20
    ) x;
  else
    v_fields := '[]'::jsonb;
  end if;

  -- خريطة الأوقات 7×24 (الصف 0 = السبت، بتوقيت الرياض)
  select coalesce(jsonb_agg(r.day_row order by r.d), '[]'::jsonb)
  into v_heatmap
  from (
    select dd.d, jsonb_agg(coalesce(agg.c, 0) order by hh.h) as day_row
    from generate_series(0, 6) as dd(d)
    cross join generate_series(0, 23) as hh(h)
    left join (
      select ((extract(dow from entered_at)::int + 1) % 7) as d,
             extract(hour from entered_at)::int as h,
             count(*)::int as c
      from public.page_visits
      where (p_tenant_id is null or tenant_id = p_tenant_id)
        and entered_at::date between p_from and p_to
      group by 1, 2
    ) agg on agg.d = dd.d and agg.h = hh.h
    group by dd.d
  ) r;

  return jsonb_build_object(
    'from', to_char(p_from, 'YYYY-MM-DD'),
    'to', to_char(p_to, 'YYYY-MM-DD'),
    'totals', jsonb_build_object(
      'views', v_views,
      'visitors', v_visitors,
      'sessions', v_sessions,
      'avg_duration', v_avg_duration,
      'bounce_rate', v_bounce,
      'booking_starts', v_starts,
      'bookings', v_bookings,
      'conversion_rate', coalesce(round(100.0 * v_bookings / nullif(v_sessions, 0), 1), 0)
    ),
    'live_now', coalesce(v_live, 0),
    'daily', v_daily,
    'sources', v_sources,
    'devices', v_devices,
    'countries', v_countries,
    'cities', v_cities,
    'fields', v_fields,
    'heatmap', v_heatmap,
    'funnel', jsonb_build_object(
      'book_views', v_book_views,
      'field_views', v_field_views,
      'booking_starts', v_starts,
      'bookings', v_bookings
    )
  );
end;
$$;

-- ─── للمالك: إحصاءات ملعبه فقط ───
create or replace function public.tenant_visits_stats(p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $$
declare
  v_t uuid;
begin
  v_t := public.get_my_tenant_id();
  if v_t is null then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  return public.visits_stats_for(v_t, p_from, p_to);
end;
$$;

-- ─── للمشرف: إحصاءات ملعب محدد ───
create or replace function public.admin_tenant_visits(p_tenant_id uuid, p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $$
begin
  if not public.is_super_admin() then raise exception 'NOT_SUPER_ADMIN' using errcode = 'P0001'; end if;
  return public.visits_stats_for(p_tenant_id, p_from, p_to);
end;
$$;

-- ─── للمشرف: إحصاءات المنصّة كاملة + الرئيسية + قُمع الاستقطاب + أنشط الملاعب ───
create or replace function public.admin_visits_stats(p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
set timezone to 'Asia/Riyadh'
as $$
declare
  v_base jsonb;
  v_landing jsonb; v_landing_daily jsonb;
  v_signup_views int; v_signups int; v_landing_views int; v_landing_visitors int;
  v_top jsonb;
begin
  if not public.is_super_admin() then raise exception 'NOT_SUPER_ADMIN' using errcode = 'P0001'; end if;

  v_base := public.visits_stats_for(null, p_from, p_to);
  -- استخدم النطاق المثبَّت الذي أعاده المجمّع
  p_from := (v_base->>'from')::date;
  p_to := (v_base->>'to')::date;

  -- الصفحة الرئيسية
  select count(*)::int, count(distinct visitor_id)::int
  into v_landing_views, v_landing_visitors
  from public.page_visits
  where page = 'landing' and entered_at::date between p_from and p_to;

  select coalesce(jsonb_agg(jsonb_build_object(
           'date', to_char(days.d, 'YYYY-MM-DD'),
           'views', coalesce(agg.views, 0)) order by days.d), '[]'::jsonb)
  into v_landing_daily
  from (select generate_series(p_from, p_to, interval '1 day')::date as d) days
  left join (
    select entered_at::date as d, count(*)::int as views
    from public.page_visits
    where page = 'landing' and entered_at::date between p_from and p_to
    group by 1
  ) agg on agg.d = days.d;

  v_landing := jsonb_build_object('views', v_landing_views, 'visitors', v_landing_visitors, 'daily', v_landing_daily);

  -- قُمع الاستقطاب: رئيسية ← صفحة تسجيل ← منشأة جديدة
  select count(*)::int into v_signup_views
  from public.page_visits
  where page = 'auth_signup' and entered_at::date between p_from and p_to;

  select count(*)::int into v_signups
  from public.tenants
  where created_at::date between p_from and p_to;

  -- أنشط الملاعب زيارةً
  select coalesce(jsonb_agg(jsonb_build_object(
           'tenant_id', x.tenant_id, 'name', x.name,
           'views', x.views, 'visitors', x.visitors, 'bookings', x.bookings)
           order by x.views desc), '[]'::jsonb)
  into v_top
  from (
    select t.id as tenant_id, t.name,
           coalesce(pv.views, 0) as views, coalesce(pv.visitors, 0) as visitors,
           coalesce(ev.bookings, 0) as bookings
    from public.tenants t
    join (
      select tenant_id, count(*)::int as views, count(distinct visitor_id)::int as visitors
      from public.page_visits
      where tenant_id is not null and entered_at::date between p_from and p_to
      group by 1
    ) pv on pv.tenant_id = t.id
    left join (
      select tenant_id, count(*)::int as bookings
      from public.visit_events
      where event_type = 'booking_created' and created_at::date between p_from and p_to
      group by 1
    ) ev on ev.tenant_id = t.id
    order by 2 desc
    limit 15
  ) x;

  return v_base || jsonb_build_object(
    'landing', v_landing,
    'auth_funnel', jsonb_build_object(
      'landing_views', v_landing_views,
      'signup_views', v_signup_views,
      'signups', v_signups
    ),
    'top_tenants', v_top
  );
end;
$$;

-- ─── متصلون الآن (جلسات آخر 5 دقائق) — يُستطلع دوريًا من اللوحة ───
create or replace function public.visits_live_now(p_tenant_id uuid default null)
returns integer
language plpgsql stable security definer
set search_path to 'public'
as $$
declare
  v_t uuid;
  v_n int;
begin
  if public.is_super_admin() then
    v_t := p_tenant_id; -- null = المنصّة كلها
  else
    v_t := public.get_my_tenant_id();
    if v_t is null then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  end if;

  select count(distinct session_id)::int into v_n
  from public.page_visits
  where (v_t is null or tenant_id = v_t)
    and entered_at > now() - interval '5 minutes';

  return coalesce(v_n, 0);
end;
$$;

-- ─── الصلاحيات ───
-- المجمّع المركزي: خاص تمامًا — يُستدعى فقط من الدوال المُعرَّفة أعلاه
revoke all on function public.visits_stats_for(uuid, date, date) from public, anon, authenticated;

revoke all on function public.tenant_visits_stats(date, date) from public, anon;
grant execute on function public.tenant_visits_stats(date, date) to authenticated;

revoke all on function public.admin_tenant_visits(uuid, date, date) from public, anon;
grant execute on function public.admin_tenant_visits(uuid, date, date) to authenticated;

revoke all on function public.admin_visits_stats(date, date) from public, anon;
grant execute on function public.admin_visits_stats(date, date) to authenticated;

revoke all on function public.visits_live_now(uuid) from public, anon;
grant execute on function public.visits_live_now(uuid) to authenticated;
