-- حجب المواعيد (استخدام خاص/صيانة): إشغال بلا عميل ضمن جدول الحجوزات.
-- status='blocked' يُخفي الموعد من الإتاحة ويمنع التداخل، دون احتسابه إيراداً أو عميلاً.

-- 1) السماح بحجز بلا عميل (للحجب فقط)
ALTER TABLE public.bookings ALTER COLUMN customer_id DROP NOT NULL;

-- 2) توسعة حالات الحجز لتشمل blocked
ALTER TABLE public.bookings DROP CONSTRAINT bookings_status_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'completed'::text, 'cancelled'::text, 'blocked'::text]));

-- 3) سلامة البيانات: blocked بلا عميل، وأي حالة أخرى تتطلب عميلاً
ALTER TABLE public.bookings ADD CONSTRAINT bookings_block_customer_check
  CHECK (
    (status = 'blocked' AND customer_id IS NULL)
    OR (status <> 'blocked' AND customer_id IS NOT NULL)
  );

-- 4) منع التداخل يشمل المحجوب (لا حجز عميل فوق محجوب ولا العكس)
ALTER TABLE public.bookings DROP CONSTRAINT no_overlapping_bookings;
ALTER TABLE public.bookings ADD CONSTRAINT no_overlapping_bookings
  EXCLUDE USING gist (
    field_id WITH =,
    tstzrange(start_time, end_time, '[)') WITH &&
  ) WHERE (status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'completed'::text, 'blocked'::text]));

-- 5) الإتاحة تعتبر المحجوب مشغولاً
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
          AND b.status IN ('pending', 'confirmed', 'completed', 'blocked')
          AND tstzrange(b.start_time, b.end_time, '[)') && tstzrange(v_slot_start, v_slot_end, '[)')
      );
      RETURN NEXT;

      v_slot_start := v_slot_end;
    END LOOP;
  END LOOP;
END;
$function$;
