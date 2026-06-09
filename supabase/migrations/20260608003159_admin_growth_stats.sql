-- لوحة المشرف: تحليلات نموّ المنصّة (محميّة بـ is_super_admin، شهور بتوقيت الرياض)
CREATE OR REPLACE FUNCTION public.admin_growth_stats()
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET timezone TO 'Asia/Riyadh'
AS $function$
DECLARE
  v_total_tenants int; v_total_bookings int; v_total_customers int;
  v_paying int; v_active int;
  v_tenants_monthly jsonb; v_bookings_monthly jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'NOT_SUPER_ADMIN' USING ERRCODE = 'P0001'; END IF;

  SELECT count(*) INTO v_total_tenants   FROM public.tenants;
  SELECT count(*) INTO v_total_bookings  FROM public.bookings;
  SELECT count(*) INTO v_total_customers FROM public.customers;
  SELECT count(DISTINCT tenant_id) INTO v_paying FROM public.subscriptions WHERE status = 'approved';
  SELECT count(*) INTO v_active FROM public.tenants t WHERE public.is_tenant_active(t.id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('label', to_char(months.m, 'Mon YY'), 'count', COALESCE(agg.c, 0)) ORDER BY months.m), '[]'::jsonb)
  INTO v_tenants_monthly
  FROM (SELECT generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') AS m) months
  LEFT JOIN (SELECT date_trunc('month', created_at) AS m, count(*) AS c FROM public.tenants GROUP BY 1) agg ON agg.m = months.m;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('label', to_char(months.m, 'Mon YY'), 'count', COALESCE(agg.c, 0)) ORDER BY months.m), '[]'::jsonb)
  INTO v_bookings_monthly
  FROM (SELECT generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') AS m) months
  LEFT JOIN (SELECT date_trunc('month', created_at) AS m, count(*) AS c FROM public.bookings GROUP BY 1) agg ON agg.m = months.m;

  RETURN jsonb_build_object(
    'totals', jsonb_build_object('tenants', v_total_tenants, 'bookings', v_total_bookings, 'customers', v_total_customers),
    'paying', v_paying,
    'active', v_active,
    'conversion_rate', CASE WHEN v_total_tenants > 0 THEN round(100.0 * v_paying / v_total_tenants, 1) ELSE 0 END,
    'tenants_monthly', v_tenants_monthly,
    'bookings_monthly', v_bookings_monthly
  );
END;
$function$;
