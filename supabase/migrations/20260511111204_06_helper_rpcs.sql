-- RPC: إحصائيات لوحة التحكم
-- ترجع JSONB بكل البيانات اللازمة للوحة التحكم في استعلام واحد
CREATE OR REPLACE FUNCTION public.dashboard_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_today_start timestamptz;
  v_today_end timestamptz;
  v_month_start timestamptz;
  v_result jsonb;
BEGIN
  v_tenant_id := public.get_my_tenant_id();
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object(
      'today_bookings', 0,
      'today_revenue', 0,
      'month_revenue', 0,
      'customers_count', 0
    );
  END IF;

  v_today_start := date_trunc('day', now());
  v_today_end := v_today_start + interval '1 day';
  v_month_start := date_trunc('month', now());

  SELECT jsonb_build_object(
    'today_bookings', (
      SELECT count(*) FROM public.bookings
      WHERE tenant_id = v_tenant_id
        AND status != 'cancelled'
        AND start_time >= v_today_start
        AND start_time < v_today_end
    ),
    'today_revenue', (
      SELECT COALESCE(SUM(total_price), 0) FROM public.bookings
      WHERE tenant_id = v_tenant_id
        AND status != 'cancelled'
        AND start_time >= v_today_start
        AND start_time < v_today_end
    ),
    'today_paid', (
      SELECT COALESCE(SUM(paid_amount), 0) FROM public.bookings
      WHERE tenant_id = v_tenant_id
        AND status != 'cancelled'
        AND start_time >= v_today_start
        AND start_time < v_today_end
    ),
    'month_revenue', (
      SELECT COALESCE(SUM(total_price), 0) FROM public.bookings
      WHERE tenant_id = v_tenant_id
        AND status != 'cancelled'
        AND start_time >= v_month_start
    ),
    'month_paid', (
      SELECT COALESCE(SUM(paid_amount), 0) FROM public.bookings
      WHERE tenant_id = v_tenant_id
        AND status != 'cancelled'
        AND start_time >= v_month_start
    ),
    'customers_count', (
      SELECT count(*) FROM public.customers WHERE tenant_id = v_tenant_id
    ),
    'fields_count', (
      SELECT count(*) FROM public.fields
      WHERE tenant_id = v_tenant_id AND is_active = true
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.dashboard_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dashboard_stats() TO authenticated;

-- RPC: تقرير حسب نطاق التاريخ (إجماليات يومية)
CREATE OR REPLACE FUNCTION public.daily_report(
  from_date date,
  to_date date
)
RETURNS TABLE (
  day date,
  bookings_count bigint,
  total_revenue numeric,
  total_paid numeric,
  total_remaining numeric
)
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
  SELECT
    (start_time AT TIME ZONE 'UTC')::date AS day,
    count(*)::bigint AS bookings_count,
    COALESCE(SUM(total_price), 0) AS total_revenue,
    COALESCE(SUM(paid_amount), 0) AS total_paid,
    COALESCE(SUM(total_price - paid_amount), 0) AS total_remaining
  FROM public.bookings
  WHERE tenant_id = public.get_my_tenant_id()
    AND status != 'cancelled'
    AND start_time >= from_date::timestamptz
    AND start_time < (to_date + 1)::timestamptz
  GROUP BY (start_time AT TIME ZONE 'UTC')::date
  ORDER BY day;
$$;

REVOKE ALL ON FUNCTION public.daily_report(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daily_report(date, date) TO authenticated;
;