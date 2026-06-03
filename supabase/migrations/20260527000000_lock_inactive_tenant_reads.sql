-- حبس الـtenant المنتهي اشتراكه على مستوى قاعدة البيانات (defense-in-depth)
--
-- الخلفية:
--   - سياسات INSERT/UPDATE/DELETE على الجداول الأساسية كانت تفحص is_my_tenant_active()
--     لكن سياسات SELECT لم تكن تفحصه → المنتهي اشتراكه كان يقرأ بياناته رغم القفل.
--   - is_tenant_active() كانت تمنح التجربة 3 أيام سماح بينما get_my_subscription_status()
--     لا تمنحها أيّ سماح (هجرة remove_trial_grace_period وحّدت الحالة ونسيت هذه الدالة).
--
-- هذه الهجرة:
--   1) توحّد is_tenant_active() مع منطق get_my_subscription_status بالضبط
--      (تجربة: لا سماح؛ اشتراك: 3 أيام سماح).
--   2) تضيف is_my_tenant_active() إلى سياسات SELECT على bookings/customers/fields/working_periods.
--
-- ملاحظة: SELECT على tenants/profiles/subscriptions/plans يبقى مفتوحاً ليتمكن المالك
--          من رؤية حالته والتجديد، وصفحات الحجز العامة تعمل عبر SECURITY DEFINER RPCs.

-- ─── 1) توحيد منطق النشاط ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_tenant_active(p_tenant_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.tenants
    WHERE id = p_tenant_id
      AND now() < CASE
        WHEN subscription_ends_at IS NOT NULL THEN subscription_ends_at + interval '3 days'
        WHEN trial_ends_at        IS NOT NULL THEN trial_ends_at
        ELSE 'epoch'::timestamptz
      END
  )
$function$;

-- ─── 2) قفل القراءة للمنتهي اشتراكهم ─────────────────────────
ALTER POLICY bookings_select_own_tenant ON public.bookings
  USING (tenant_id = get_my_tenant_id() AND is_my_tenant_active());

ALTER POLICY customers_select_own_tenant ON public.customers
  USING (tenant_id = get_my_tenant_id() AND is_my_tenant_active());

ALTER POLICY fields_select_own_tenant ON public.fields
  USING (tenant_id = get_my_tenant_id() AND is_my_tenant_active());

ALTER POLICY working_periods_select_own_tenant ON public.working_periods
  USING (tenant_id = get_my_tenant_id() AND is_my_tenant_active());

-- ─── 3) سدّ ثغرة SECURITY DEFINER في محرّر الجدول ────────────
-- set_day_periods يتجاوز RLS (SECURITY DEFINER)، فكان يسمح لمالك منتهٍ اشتراكه
-- بالكتابة في working_periods رغم قفل سياسات RLS. نضيف بوابة النشاط داخلياً.
CREATE OR REPLACE FUNCTION public.set_day_periods(p_field_id uuid, p_day_of_week integer, p_periods jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_field record;
  v_period jsonb;
  v_count int := 0;
BEGIN
  v_tenant_id := public.get_my_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'غير مصرّح' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'هذه العملية متاحة للمالك فقط' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.is_my_tenant_active() THEN
    RAISE EXCEPTION 'TENANT_INACTIVE' USING ERRCODE = 'P0001';
  END IF;
  IF p_day_of_week < 0 OR p_day_of_week > 6 THEN
    RAISE EXCEPTION 'يوم غير صحيح' USING ERRCODE = 'P0001';
  END IF;

  -- التحقق أن الأرضية تتبع tenant المستخدم
  SELECT id, tenant_id INTO v_field
  FROM public.fields
  WHERE id = p_field_id AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الأرضية غير موجودة' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.working_periods
  WHERE field_id = p_field_id AND day_of_week = p_day_of_week;

  IF p_periods IS NULL OR jsonb_typeof(p_periods) <> 'array' THEN
    RETURN jsonb_build_object('inserted', 0);
  END IF;

  FOR v_period IN SELECT * FROM jsonb_array_elements(p_periods)
  LOOP
    INSERT INTO public.working_periods (
      tenant_id, field_id, day_of_week, open_time, close_time,
      slot_duration_minutes, hourly_price
    )
    VALUES (
      v_tenant_id,
      p_field_id,
      p_day_of_week,
      (v_period->>'open')::time,
      (v_period->>'close')::time,
      COALESCE((v_period->>'duration')::int, 60),
      COALESCE((v_period->>'price')::numeric, 0)
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_count);
END;
$function$;

-- ─── 4) دفاع عميق في get_available_slots ────────────────────
-- لو استُدعيت الدالة مباشرة عبر API لـtenant منتهٍ، تُرجع فارغاً بدل المواعيد.
-- (صفحة الحجز العامة تحجب أصلاً عبر get_public_tenant_info.is_active، فهذا belt-and-suspenders.)
CREATE OR REPLACE FUNCTION public.get_available_slots(p_tenant_id uuid, p_field_id uuid, p_date date)
 RETURNS TABLE(slot_start timestamp with time zone, slot_end timestamp with time zone, is_available boolean, is_past boolean, slot_duration_minutes integer, slot_price numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_field record;
  v_period record;
  v_target_dow int;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_slot_start timestamptz;
  v_slot_end timestamptz;
  v_min_future timestamptz;
BEGIN
  -- بوابة دفاع عميق: لا تُرجع مواعيد لـtenant منتهٍ اشتراكه
  IF NOT public.is_tenant_active(p_tenant_id) THEN
    RETURN;
  END IF;

  SELECT id, tenant_id, is_active
  INTO v_field
  FROM public.fields
  WHERE id = p_field_id AND tenant_id = p_tenant_id AND is_active = true;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_target_dow := EXTRACT(DOW FROM p_date)::int;
  v_min_future := now() + interval '1 hour';

  FOR v_period IN
    SELECT wp.open_time, wp.close_time, wp.slot_duration_minutes AS duration, wp.hourly_price AS price
    FROM public.working_periods wp
    WHERE wp.field_id = p_field_id AND wp.day_of_week = v_target_dow
    ORDER BY wp.open_time
  LOOP
    v_day_start := (p_date::text || ' ' || v_period.open_time::text)::timestamptz;
    IF v_period.close_time <= v_period.open_time THEN
      v_day_end := ((p_date + 1)::text || ' ' || v_period.close_time::text)::timestamptz;
    ELSE
      v_day_end := (p_date::text || ' ' || v_period.close_time::text)::timestamptz;
    END IF;

    v_slot_start := v_day_start;
    WHILE v_slot_start < v_day_end LOOP
      v_slot_end := v_slot_start + make_interval(mins => v_period.duration);
      EXIT WHEN v_slot_end > v_day_end;

      slot_start := v_slot_start;
      slot_end := v_slot_end;
      slot_duration_minutes := v_period.duration;
      slot_price := round(((v_period.duration / 60.0) * v_period.price)::numeric, 2);
      is_past := v_slot_start < v_min_future;
      is_available := NOT is_past AND NOT EXISTS (
        SELECT 1 FROM public.bookings b
        WHERE b.field_id = p_field_id
          AND b.status IN ('pending', 'confirmed', 'completed')
          AND tstzrange(b.start_time, b.end_time, '[)') && tstzrange(v_slot_start, v_slot_end, '[)')
      );
      RETURN NEXT;

      v_slot_start := v_slot_end;
    END LOOP;
  END LOOP;
END;
$function$;
