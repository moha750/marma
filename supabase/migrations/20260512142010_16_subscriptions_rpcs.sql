-- ============================================================
-- 16_subscriptions_rpcs: updated trigger + new RPC functions
-- ============================================================

-- 1. Replace handle_new_user to set trial_ends_at on new tenant path
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_invite_code text;
  v_invitation record;
  v_tenant_id uuid;
  v_full_name text;
  v_tenant_name text;
BEGIN
  v_invite_code := NEW.raw_user_meta_data->>'invite_code';
  v_full_name := NEW.raw_user_meta_data->>'full_name';

  -- Path 1: staff invitation
  IF v_invite_code IS NOT NULL AND v_invite_code <> '' THEN
    SELECT id, tenant_id, email, full_name, used_at, expires_at
    INTO v_invitation
    FROM public.staff_invitations
    WHERE code = v_invite_code
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'INVITE_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
    IF v_invitation.used_at IS NOT NULL THEN
      RAISE EXCEPTION 'INVITE_ALREADY_USED' USING ERRCODE = 'P0001';
    END IF;
    IF v_invitation.expires_at <= now() THEN
      RAISE EXCEPTION 'INVITE_EXPIRED' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.profiles (id, tenant_id, full_name, role)
    VALUES (NEW.id, v_invitation.tenant_id, v_invitation.full_name, 'staff');

    UPDATE public.staff_invitations SET used_at = now() WHERE id = v_invitation.id;

    RETURN NEW;
  END IF;

  -- Path 2: new owner (creates tenant with 3-day trial)
  v_tenant_name := NEW.raw_user_meta_data->>'tenant_name';

  IF v_tenant_name IS NULL OR v_tenant_name = '' THEN
    RAISE EXCEPTION 'TENANT_NAME_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF v_full_name IS NULL OR v_full_name = '' THEN
    RAISE EXCEPTION 'FULL_NAME_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.tenants (name, city, phone, trial_ends_at, subscription_status)
  VALUES (
    v_tenant_name,
    NEW.raw_user_meta_data->>'city',
    NEW.raw_user_meta_data->>'phone',
    now() + interval '3 days',
    'trial'
  )
  RETURNING id INTO v_tenant_id;

  INSERT INTO public.profiles (id, tenant_id, full_name, role)
  VALUES (NEW.id, v_tenant_id, v_full_name, 'owner');

  RETURN NEW;
END;
$$;

-- 2. Replace get_public_tenant_info to include is_active + subscription_status
CREATE OR REPLACE FUNCTION public.get_public_tenant_info(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant record;
  v_fields jsonb;
  v_is_active boolean;
BEGIN
  SELECT id, name, city, subscription_status INTO v_tenant
  FROM public.tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_is_active := public.is_tenant_active(p_tenant_id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', f.id,
    'name', f.name
  ) ORDER BY f.name), '[]'::jsonb) INTO v_fields
  FROM public.fields f
  WHERE f.tenant_id = p_tenant_id AND f.is_active = true;

  RETURN jsonb_build_object(
    'id', v_tenant.id,
    'name', v_tenant.name,
    'city', v_tenant.city,
    'is_active', v_is_active,
    'subscription_status', v_tenant.subscription_status,
    'fields', v_fields
  );
END;
$$;

-- 3. Replace create_pending_booking with early is_tenant_active check
CREATE OR REPLACE FUNCTION public.create_pending_booking(
  p_tenant_id uuid,
  p_field_id uuid,
  p_start_time timestamptz,
  p_customer_name text,
  p_customer_phone text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_field record;
  v_customer record;
  v_customer_id uuid;
  v_customer_input_name text;
  v_total_price numeric;
  v_end_time timestamptz;
  v_booking_id uuid;
  v_clean_name text;
  v_clean_phone text;
  v_target_date date;
  v_target_time time;
  v_target_dow int;
  v_period record;
  v_day_start timestamptz;
  v_delta_seconds numeric;
  v_slot_seconds int;
  v_matched_duration int;
  v_matched_price numeric;
  v_matched boolean := false;
BEGIN
  -- البوابة: تأكد من أن tenant نشط
  IF NOT public.is_tenant_active(p_tenant_id) THEN
    RAISE EXCEPTION 'TENANT_INACTIVE' USING ERRCODE = 'P0001';
  END IF;

  v_clean_name := btrim(p_customer_name);
  v_clean_phone := btrim(p_customer_phone);

  IF v_clean_name IS NULL OR v_clean_name = '' THEN
    RAISE EXCEPTION 'اسم العميل مطلوب' USING ERRCODE = 'P0001';
  END IF;
  IF v_clean_phone IS NULL OR v_clean_phone = '' THEN
    RAISE EXCEPTION 'رقم الجوال مطلوب' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, tenant_id, name, is_active
  INTO v_field
  FROM public.fields
  WHERE id = p_field_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الأرضية غير موجودة' USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_field.is_active THEN
    RAISE EXCEPTION 'هذه الأرضية غير متاحة للحجز حالياً' USING ERRCODE = 'P0001';
  END IF;

  IF p_start_time < now() + interval '1 hour' THEN
    RAISE EXCEPTION 'يجب الحجز قبل ساعة على الأقل من الموعد' USING ERRCODE = 'P0001';
  END IF;

  v_target_date := p_start_time::date;
  v_target_time := p_start_time::time;
  v_target_dow := EXTRACT(DOW FROM v_target_date)::int;

  FOR v_period IN
    SELECT wp.open_time, wp.close_time, wp.slot_duration_minutes AS duration, wp.hourly_price AS price
    FROM public.working_periods wp
    WHERE wp.field_id = p_field_id AND wp.day_of_week = v_target_dow
  LOOP
    v_slot_seconds := v_period.duration * 60;
    IF v_period.close_time > v_period.open_time THEN
      IF v_target_time >= v_period.open_time AND v_target_time < v_period.close_time THEN
        v_day_start := (v_target_date::text || ' ' || v_period.open_time::text)::timestamptz;
        v_delta_seconds := EXTRACT(EPOCH FROM (p_start_time - v_day_start));
        IF v_delta_seconds >= 0 AND (v_delta_seconds::int % v_slot_seconds) = 0
           AND p_start_time + make_interval(mins => v_period.duration) <=
               (v_target_date::text || ' ' || v_period.close_time::text)::timestamptz THEN
          v_matched_duration := v_period.duration;
          v_matched_price := v_period.price;
          v_matched := true;
          EXIT;
        END IF;
      END IF;
    ELSE
      IF v_target_time >= v_period.open_time THEN
        v_day_start := (v_target_date::text || ' ' || v_period.open_time::text)::timestamptz;
        v_delta_seconds := EXTRACT(EPOCH FROM (p_start_time - v_day_start));
        IF v_delta_seconds >= 0 AND (v_delta_seconds::int % v_slot_seconds) = 0
           AND p_start_time + make_interval(mins => v_period.duration) <=
               ((v_target_date + 1)::text || ' ' || v_period.close_time::text)::timestamptz THEN
          v_matched_duration := v_period.duration;
          v_matched_price := v_period.price;
          v_matched := true;
          EXIT;
        END IF;
      END IF;
    END IF;
  END LOOP;

  IF NOT v_matched THEN
    FOR v_period IN
      SELECT wp.open_time, wp.close_time, wp.slot_duration_minutes AS duration, wp.hourly_price AS price
      FROM public.working_periods wp
      WHERE wp.field_id = p_field_id
        AND wp.day_of_week = ((v_target_dow - 1 + 7) % 7)
        AND wp.close_time <= wp.open_time
    LOOP
      v_slot_seconds := v_period.duration * 60;
      IF v_target_time < v_period.close_time THEN
        v_day_start := ((v_target_date - 1)::text || ' ' || v_period.open_time::text)::timestamptz;
        v_delta_seconds := EXTRACT(EPOCH FROM (p_start_time - v_day_start));
        IF v_delta_seconds >= 0 AND (v_delta_seconds::int % v_slot_seconds) = 0
           AND p_start_time + make_interval(mins => v_period.duration) <=
               (v_target_date::text || ' ' || v_period.close_time::text)::timestamptz THEN
          v_matched_duration := v_period.duration;
          v_matched_price := v_period.price;
          v_matched := true;
          EXIT;
        END IF;
      END IF;
    END LOOP;
  END IF;

  IF NOT v_matched THEN
    RAISE EXCEPTION 'الموعد المختار غير صالح حسب فترات العمل' USING ERRCODE = 'P0001';
  END IF;

  v_end_time := p_start_time + make_interval(mins => v_matched_duration);
  v_total_price := round(((v_matched_duration / 60.0) * v_matched_price)::numeric, 2);

  SELECT id, full_name INTO v_customer
  FROM public.customers
  WHERE tenant_id = p_tenant_id AND phone = v_clean_phone;

  IF FOUND THEN
    v_customer_id := v_customer.id;
    IF btrim(v_customer.full_name) <> v_clean_name THEN
      v_customer_input_name := v_clean_name;
    END IF;
  ELSE
    INSERT INTO public.customers (tenant_id, full_name, phone)
    VALUES (p_tenant_id, v_clean_name, v_clean_phone)
    RETURNING id INTO v_customer_id;
  END IF;

  BEGIN
    INSERT INTO public.bookings (
      tenant_id, field_id, customer_id, start_time, end_time,
      total_price, paid_amount, status, notes, customer_input_name, created_by
    )
    VALUES (
      p_tenant_id, p_field_id, v_customer_id, p_start_time, v_end_time,
      v_total_price, 0, 'pending', NULLIF(btrim(coalesce(p_notes, '')), ''),
      v_customer_input_name, NULL
    )
    RETURNING id INTO v_booking_id;
  EXCEPTION
    WHEN exclusion_violation THEN
      RAISE EXCEPTION 'هذا الموعد محجوز بالفعل على نفس الأرضية' USING ERRCODE = 'P0001';
  END;

  RETURN jsonb_build_object(
    'booking_id', v_booking_id,
    'total_price', v_total_price,
    'end_time', v_end_time,
    'message', 'تم استلام طلب الحجز بنجاح'
  );
END;
$$;
;