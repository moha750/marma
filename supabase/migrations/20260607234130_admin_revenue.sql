-- لوحة المشرف: سجلّ الاشتراكات الكامل + إحصاءات الإيراد (محميّة بـ is_super_admin)

-- 1) كل الاشتراكات (اختياري الفلترة بالحالة) مع اسم الملعب
CREATE OR REPLACE FUNCTION public.admin_list_subscriptions(p_status text DEFAULT NULL)
 RETURNS TABLE(
   id uuid, tenant_id uuid, tenant_name text, status text, amount numeric,
   requested_fields integer, requested_staff integer, payment_reference text, note text,
   period_start timestamptz, period_end timestamptz, created_at timestamptz,
   reviewed_at timestamptz, reject_reason text
 )
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'NOT_SUPER_ADMIN' USING ERRCODE = 'P0001'; END IF;
  RETURN QUERY
    SELECT s.id, s.tenant_id, t.name, s.status, s.amount, s.requested_fields, s.requested_staff,
           s.payment_reference, s.note, s.period_start, s.period_end, s.created_at, s.reviewed_at, s.reject_reason
    FROM public.subscriptions s
    JOIN public.tenants t ON t.id = s.tenant_id
    WHERE (p_status IS NULL OR s.status = p_status)
    ORDER BY s.created_at DESC
    LIMIT 500;
END;
$function$;

-- 2) إحصاءات الإيراد: الإجمالي + الشهر الحالي + المتوسط + اتجاه آخر 6 أشهر (بتوقيت الرياض)
CREATE OR REPLACE FUNCTION public.admin_revenue_stats()
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET timezone TO 'Asia/Riyadh'
AS $function$
DECLARE
  v_total numeric; v_count int; v_avg numeric; v_this_month numeric; v_monthly jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'NOT_SUPER_ADMIN' USING ERRCODE = 'P0001'; END IF;

  SELECT COALESCE(sum(amount), 0), count(*), COALESCE(avg(amount), 0)
  INTO v_total, v_count, v_avg
  FROM public.subscriptions WHERE status = 'approved';

  SELECT COALESCE(sum(amount), 0) INTO v_this_month
  FROM public.subscriptions
  WHERE status = 'approved'
    AND COALESCE(reviewed_at, created_at) >= date_trunc('month', now());

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'label',   to_char(months.m, 'Mon YY'),
             'revenue', COALESCE(agg.rev, 0),
             'count',   COALESCE(agg.cnt, 0)
           ) ORDER BY months.m), '[]'::jsonb)
  INTO v_monthly
  FROM (
    SELECT generate_series(
             date_trunc('month', now()) - interval '5 months',
             date_trunc('month', now()),
             interval '1 month') AS m
  ) months
  LEFT JOIN (
    SELECT date_trunc('month', COALESCE(reviewed_at, created_at)) AS m,
           sum(amount) AS rev, count(*) AS cnt
    FROM public.subscriptions WHERE status = 'approved'
    GROUP BY 1
  ) agg ON agg.m = months.m;

  RETURN jsonb_build_object(
    'total_revenue',  v_total,
    'approved_count', v_count,
    'avg_amount',     round(v_avg, 2),
    'this_month',     v_this_month,
    'monthly',        v_monthly
  );
END;
$function$;
