-- ─────────────────────────────────────────────────────────────────────
-- ملخّص أسبوعي للمالك كل يوم أحد 9 صباحاً السعودية (6 UTC)
--
-- المحتوى: عدد حجوزات الأسبوع القادم، اليوم الأكثر ازدحاماً، الإيرادات المتوقّعة
-- الأسلوب: أرقام مختصرة (style A)
--
-- مثال: "23 حجز · أعلى يوم الخميس · 3,450 ر.س"
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.send_weekly_summaries()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_project_url text;
  v_secret text;
  v_tenant RECORD;
  v_total_bookings int;
  v_total_revenue numeric;
  v_busiest_day text;
  v_busiest_count int;
BEGIN
  v_project_url := public._get_vault_secret('PROJECT_URL');
  v_secret := public._get_vault_secret('INTERNAL_HOOK_SECRET');

  IF v_project_url IS NULL OR v_secret IS NULL THEN
    RAISE WARNING 'send_weekly_summaries: missing vault secrets';
    RETURN;
  END IF;

  -- ندور على الـ tenants النشطة فقط (تجربة أو اشتراك أو سماح)
  FOR v_tenant IN
    SELECT id
    FROM public.tenants
    WHERE (subscription_ends_at IS NULL AND trial_ends_at > NOW())
       OR (subscription_ends_at IS NOT NULL
           AND subscription_ends_at + INTERVAL '3 days' > NOW())
  LOOP
    -- إحصائيات الأسبوع القادم (الحجوزات غير الملغاة)
    SELECT
      COUNT(*)::int,
      COALESCE(SUM(total_price), 0)
    INTO v_total_bookings, v_total_revenue
    FROM public.bookings
    WHERE tenant_id = v_tenant.id
      AND start_time >= NOW()
      AND start_time < NOW() + INTERVAL '7 days'
      AND status IN ('confirmed', 'pending');

    -- لا تُرسل لو ما فيه حجوزات
    IF v_total_bookings = 0 THEN
      CONTINUE;
    END IF;

    -- اليوم الأكثر ازدحاماً (بالعربية)
    SELECT
      CASE EXTRACT(DOW FROM start_time)::int
        WHEN 0 THEN 'الأحد'
        WHEN 1 THEN 'الاثنين'
        WHEN 2 THEN 'الثلاثاء'
        WHEN 3 THEN 'الأربعاء'
        WHEN 4 THEN 'الخميس'
        WHEN 5 THEN 'الجمعة'
        WHEN 6 THEN 'السبت'
      END,
      COUNT(*)::int
    INTO v_busiest_day, v_busiest_count
    FROM public.bookings
    WHERE tenant_id = v_tenant.id
      AND start_time >= NOW()
      AND start_time < NOW() + INTERVAL '7 days'
      AND status IN ('confirmed', 'pending')
    GROUP BY EXTRACT(DOW FROM start_time)
    ORDER BY COUNT(*) DESC
    LIMIT 1;

    -- نادِ Edge Function
    BEGIN
      PERFORM net.http_post(
        url := v_project_url || '/functions/v1/send-weekly-summary',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_secret
        ),
        body := jsonb_build_object(
          'tenant_id', v_tenant.id::text,
          'total_bookings', v_total_bookings,
          'total_revenue', v_total_revenue,
          'busiest_day', v_busiest_day,
          'busiest_count', v_busiest_count
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'send-weekly-summary call failed for tenant %: %',
        v_tenant.id, SQLERRM;
    END;
  END LOOP;
END;
$$;

-- جدولة: كل أحد 6 UTC = 9 صباحاً السعودية
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'weekly-summary') THEN
    PERFORM cron.unschedule('weekly-summary');
  END IF;
END $$;

SELECT cron.schedule(
  'weekly-summary',
  '0 6 * * 0',  -- الأحد 6:00 UTC
  $$SELECT public.send_weekly_summaries()$$
);
