-- ─────────────────────────────────────────────────────────────────────
-- ملخّص شهري للمالك في أول كل شهر 9 صباحاً السعودية (6 UTC)
--
-- نظرة إلى الوراء: إجمالي حجوزات وإيرادات الشهر المنصرم + مقارنة
-- بالشهر الذي قبله (نسبة نمو).
--
-- مثال:
--   Title: "شهر مايو — ملخّصك 💰"
--   Body : "142 حجز · 21,500 ر.س · ⬆️ 18% عن أبريل"
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.send_monthly_summaries()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_project_url text;
  v_secret text;
  v_tenant RECORD;
  v_last_start timestamptz;
  v_last_end timestamptz;
  v_prev_start timestamptz;
  v_prev_end timestamptz;
  v_last_bookings int;
  v_last_revenue numeric;
  v_prev_revenue numeric;
  v_growth_pct numeric;
  v_last_month_name text;
  v_prev_month_name text;
BEGIN
  v_project_url := public._get_vault_secret('PROJECT_URL');
  v_secret := public._get_vault_secret('INTERNAL_HOOK_SECRET');

  IF v_project_url IS NULL OR v_secret IS NULL THEN
    RAISE WARNING 'send_monthly_summaries: missing vault secrets';
    RETURN;
  END IF;

  -- حساب نوافذ الشهر السابق والذي قبله مرّة واحدة لكل التشغيل
  v_last_start := date_trunc('month', NOW() - INTERVAL '1 month');
  v_last_end   := date_trunc('month', NOW());
  v_prev_start := date_trunc('month', NOW() - INTERVAL '2 months');
  v_prev_end   := v_last_start;

  -- اسم الشهر السابق بالعربية (للعنوان)
  v_last_month_name := CASE EXTRACT(MONTH FROM v_last_start)::int
    WHEN 1 THEN 'يناير'   WHEN 2 THEN 'فبراير' WHEN 3 THEN 'مارس'
    WHEN 4 THEN 'أبريل'   WHEN 5 THEN 'مايو'   WHEN 6 THEN 'يونيو'
    WHEN 7 THEN 'يوليو'   WHEN 8 THEN 'أغسطس'  WHEN 9 THEN 'سبتمبر'
    WHEN 10 THEN 'أكتوبر' WHEN 11 THEN 'نوفمبر' WHEN 12 THEN 'ديسمبر'
  END;

  -- اسم الشهر الذي قبله (لتسمية المقارنة في body)
  v_prev_month_name := CASE EXTRACT(MONTH FROM v_prev_start)::int
    WHEN 1 THEN 'يناير'   WHEN 2 THEN 'فبراير' WHEN 3 THEN 'مارس'
    WHEN 4 THEN 'أبريل'   WHEN 5 THEN 'مايو'   WHEN 6 THEN 'يونيو'
    WHEN 7 THEN 'يوليو'   WHEN 8 THEN 'أغسطس'  WHEN 9 THEN 'سبتمبر'
    WHEN 10 THEN 'أكتوبر' WHEN 11 THEN 'نوفمبر' WHEN 12 THEN 'ديسمبر'
  END;

  -- ندور على tenants النشطة
  FOR v_tenant IN
    SELECT id
    FROM public.tenants
    WHERE (subscription_ends_at IS NULL AND trial_ends_at > NOW())
       OR (subscription_ends_at IS NOT NULL
           AND subscription_ends_at + INTERVAL '3 days' > NOW())
  LOOP
    -- إحصائيات الشهر المنصرم
    SELECT
      COUNT(*)::int,
      COALESCE(SUM(total_price), 0)
    INTO v_last_bookings, v_last_revenue
    FROM public.bookings
    WHERE tenant_id = v_tenant.id
      AND start_time >= v_last_start
      AND start_time < v_last_end
      AND status NOT IN ('cancelled');

    -- لو ما فيه حجوزات في الشهر المنصرم، تخطّى
    IF v_last_bookings = 0 THEN
      CONTINUE;
    END IF;

    -- إيرادات الشهر الذي قبله (لحساب النمو)
    SELECT COALESCE(SUM(total_price), 0)
    INTO v_prev_revenue
    FROM public.bookings
    WHERE tenant_id = v_tenant.id
      AND start_time >= v_prev_start
      AND start_time < v_prev_end
      AND status NOT IN ('cancelled');

    -- احسب النمو فقط لو الشهر السابق له إيرادات (تجنّب القسمة على صفر)
    IF v_prev_revenue > 0 THEN
      v_growth_pct := ROUND(((v_last_revenue - v_prev_revenue) / v_prev_revenue) * 100);
    ELSE
      v_growth_pct := NULL;
    END IF;

    -- نادِ Edge Function
    BEGIN
      PERFORM net.http_post(
        url := v_project_url || '/functions/v1/send-monthly-summary',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_secret
        ),
        body := jsonb_build_object(
          'tenant_id',        v_tenant.id::text,
          'month_name',       v_last_month_name,
          'prev_month_name',  v_prev_month_name,
          'total_bookings',   v_last_bookings,
          'total_revenue',    v_last_revenue,
          'growth_pct',       v_growth_pct
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'send-monthly-summary call failed for tenant %: %',
        v_tenant.id, SQLERRM;
    END;
  END LOOP;
END;
$$;

-- جدولة: اليوم 1 من كل شهر، 6 UTC = 9 صباحاً السعودية
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monthly-summary') THEN
    PERFORM cron.unschedule('monthly-summary');
  END IF;
END $$;

SELECT cron.schedule(
  'monthly-summary',
  '0 6 1 * *',  -- اليوم 1 من كل شهر، 6:00 UTC
  $$SELECT public.send_monthly_summaries()$$
);
