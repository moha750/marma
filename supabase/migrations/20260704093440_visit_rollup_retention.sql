-- نظام تتبع الزيارات (٣/٣): التجميع اليومي + الاحتفاظ
-- ----------------------------------------------------------------------------
-- visit_daily_stats: أرشيف يومي مضغوط (يبقى للأبد) يبنيه rollup_visits_daily
-- كل ليلة عبر pg_cron. الجداول الخام تُقصّ بعد 365 يومًا (purge_visits_raw) —
-- دوال الإحصاء تقرأ الخام (حد سنة)، والأرشيف اليومي للمدى الأطول مستقبلًا.

create table if not exists public.visit_daily_stats (
  day date not null,
  tenant_id uuid references public.tenants(id) on delete cascade, -- null = الرئيسية/auth
  views integer not null default 0,
  visitors integer not null default 0,
  sessions integer not null default 0,
  total_duration bigint not null default 0,   -- مجموع ثواني الزيارات المعلومة المدة
  duration_samples integer not null default 0,-- عدد الزيارات المعلومة المدة
  bounces integer not null default 0,         -- جلسات بمشاهدة واحدة
  booking_starts integer not null default 0,
  bookings integer not null default 0,
  breakdowns jsonb not null default '{}'      -- {sources, devices, countries, pages, hours[24]}
);

-- فريد لكل (يوم، ملعب) مع دلو ثابت للـ null (الرئيسية/auth)
create unique index if not exists visit_daily_stats_day_tenant_idx
  on public.visit_daily_stats (day, coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- RLS بلا سياسات — أرشيف داخلي، القراءة عبر دوال لاحقة عند الحاجة
alter table public.visit_daily_stats enable row level security;

-- ─── التجميع اليومي (idempotent: يعيد بناء الأيام الناقصة حتى الأمس) ───
create or replace function public.rollup_visits_daily()
returns void
language plpgsql volatile security definer
set search_path to 'public'
set timezone to 'Asia/Riyadh'
as $$
declare
  v_day date;
begin
  for v_day in
    select d::date
    from generate_series(
      coalesce((select min(entered_at)::date from public.page_visits), current_date),
      current_date - 1,
      interval '1 day'
    ) d
    where not exists (select 1 from public.visit_daily_stats s where s.day = d::date)
  loop
    -- حذف ثم إدراج (idempotent لو أُعيد التشغيل على يوم موجود جزئيًا)
    delete from public.visit_daily_stats where day = v_day;

    insert into public.visit_daily_stats
      (day, tenant_id, views, visitors, sessions, total_duration, duration_samples,
       bounces, booking_starts, bookings, breakdowns)
    select
      v_day,
      pv.tenant_id,
      count(*)::int,
      count(distinct pv.visitor_id)::int,
      count(distinct pv.session_id)::int,
      coalesce(sum(pv.duration_seconds) filter (where pv.duration_seconds is not null), 0)::bigint,
      count(*) filter (where pv.duration_seconds is not null)::int,
      coalesce((
        select count(*) from (
          select session_id from public.page_visits b
          where b.entered_at::date = v_day
            and b.tenant_id is not distinct from pv.tenant_id
          group by session_id having count(*) = 1
        ) bb
      ), 0)::int,
      coalesce((select count(*) from public.visit_events e
                where e.created_at::date = v_day
                  and e.tenant_id is not distinct from pv.tenant_id
                  and e.event_type = 'booking_start'), 0)::int,
      coalesce((select count(*) from public.visit_events e
                where e.created_at::date = v_day
                  and e.tenant_id is not distinct from pv.tenant_id
                  and e.event_type = 'booking_created'), 0)::int,
      jsonb_build_object(
        'sources', coalesce((
          select jsonb_object_agg(src, cnt) from (
            select coalesce(nullif(utm_source, ''), ref_domain, 'مباشر') as src, count(*)::int as cnt
            from public.page_visits b
            where b.entered_at::date = v_day and b.tenant_id is not distinct from pv.tenant_id
            group by 1 order by 2 desc limit 20
          ) s
        ), '{}'::jsonb),
        'devices', coalesce((
          select jsonb_object_agg(coalesce(device_type, 'unknown'), cnt) from (
            select device_type, count(*)::int as cnt
            from public.page_visits b
            where b.entered_at::date = v_day and b.tenant_id is not distinct from pv.tenant_id
            group by 1
          ) s
        ), '{}'::jsonb),
        'countries', coalesce((
          select jsonb_object_agg(coalesce(country, '--'), cnt) from (
            select country, count(*)::int as cnt
            from public.page_visits b
            where b.entered_at::date = v_day and b.tenant_id is not distinct from pv.tenant_id
            group by 1 order by 2 desc limit 20
          ) s
        ), '{}'::jsonb),
        'pages', coalesce((
          select jsonb_object_agg(page, cnt) from (
            select page, count(*)::int as cnt
            from public.page_visits b
            where b.entered_at::date = v_day and b.tenant_id is not distinct from pv.tenant_id
            group by 1
          ) s
        ), '{}'::jsonb),
        'hours', coalesce((
          select jsonb_agg(coalesce(cnt, 0) order by h) from
            generate_series(0, 23) h
            left join (
              select extract(hour from entered_at)::int as hh, count(*)::int as cnt
              from public.page_visits b
              where b.entered_at::date = v_day and b.tenant_id is not distinct from pv.tenant_id
              group by 1
            ) agg on agg.hh = h
        ), '[]'::jsonb)
      )
    from public.page_visits pv
    where pv.entered_at::date = v_day
    group by pv.tenant_id;
  end loop;
end;
$$;

-- ─── قصّ الخام الأقدم من سنة (الأرشيف اليومي يبقى) ───
create or replace function public.purge_visits_raw()
returns void
language sql volatile security definer set search_path to 'public' as $$
  delete from public.page_visits where entered_at < now() - interval '365 days';
  delete from public.visit_events where created_at < now() - interval '365 days';
$$;

-- دوال داخلية للنظام فقط — لا يستدعيها أي عميل
revoke all on function public.rollup_visits_daily() from public, anon, authenticated;
revoke all on function public.purge_visits_raw() from public, anon, authenticated;

-- ─── جدولة ليلية: 22:30 UTC = 01:30 الرياض (بعد إقفال اليوم المحلي) ───
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'visits-rollup-daily') THEN
    PERFORM cron.unschedule('visits-rollup-daily');
  END IF;
END $$;

SELECT cron.schedule(
  'visits-rollup-daily',
  '30 22 * * *',
  $$SELECT public.rollup_visits_daily(); SELECT public.purge_visits_raw();$$
);
