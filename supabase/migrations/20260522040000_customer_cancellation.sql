-- ─────────────────────────────────────────────────────────────────────
-- إلغاء الحجز ذاتياً من طرف العميل (Customer self-service cancellation).
--
-- التصميم: العميل يدخل رقم جواله في صفحة الحجز العامة → يرى قائمة
-- حجوزاته القادمة في هذا الملعب → يضغط "إلغاء" بجانب الحجز المراد.
-- لا حاجة لحفظ رابط ولا SMS OTP — رقم الجوال كافٍ كمفتاح.
--
-- يضيف:
--   1) حقلَي audit: cancelled_at, cancelled_by ('staff'|'customer')
--   2) RPC: list_customer_bookings(tenant_id, phone) — قائمة الحجوزات القادمة
--   3) RPC: cancel_booking_by_phone(tenant_id, booking_id, phone) — إلغاء
--   4) Trigger: notify_customer_cancellation — يُرسل push للموظفين عند إلغاء العميل
--
-- ملاحظات:
--   - status='cancelled' يُحرّر السلوت تلقائياً عبر get_available_slots
--     وقيد no_overlapping_bookings (كلاهما يفلتر cancelled).
--   - تذكيرات الحجوزات المعلّقة تتوقف ذاتياً (send_pending_reminders يفلتر status='pending').
--   - لا يوجد منطق refund — paid_amount يبقى كما هو.
-- ─────────────────────────────────────────────────────────────────────

-- ─── 1) حقول audit ────────────────────────────────────────────
ALTER TABLE public.bookings
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancelled_by text CHECK (cancelled_by IN ('staff','customer'));

-- ─── 2) RPC: قائمة حجوزات العميل القادمة ───────────────────────
CREATE OR REPLACE FUNCTION public.list_customer_bookings(
  p_tenant_id uuid,
  p_phone text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text;
  v_tenant_name text;
  v_bookings jsonb;
BEGIN
  v_phone := btrim(p_phone);
  IF v_phone IS NULL OR v_phone = '' THEN
    RAISE EXCEPTION 'PHONE_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT name INTO v_tenant_name FROM public.tenants WHERE id = p_tenant_id;
  IF v_tenant_name IS NULL THEN
    RAISE EXCEPTION 'TENANT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(jsonb_agg(row_obj ORDER BY (row_obj->>'start_time')), '[]'::jsonb)
  INTO v_bookings
  FROM (
    SELECT jsonb_build_object(
      'id', b.id,
      'status', b.status,
      'start_time', b.start_time,
      'end_time', b.end_time,
      'total_price', b.total_price,
      'field_name', f.name,
      'field_city', f.city,
      'is_cancellable', (b.status IN ('pending','confirmed') AND b.start_time > now())
    ) AS row_obj
    FROM public.bookings b
    JOIN public.fields f ON f.id = b.field_id
    JOIN public.customers c ON c.id = b.customer_id
    WHERE b.tenant_id = p_tenant_id
      AND c.phone = v_phone
      AND b.status IN ('pending','confirmed')
      AND b.start_time > now()
  ) sub;

  RETURN jsonb_build_object(
    'tenant_name', v_tenant_name,
    'bookings', v_bookings
  );
END $$;

-- ─── 3) RPC: إلغاء بواسطة مطابقة الجوال ───────────────────────
CREATE OR REPLACE FUNCTION public.cancel_booking_by_phone(
  p_tenant_id uuid,
  p_booking_id uuid,
  p_phone text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_start timestamptz;
  v_phone_match boolean;
  v_clean_phone text;
BEGIN
  v_clean_phone := btrim(p_phone);
  IF v_clean_phone IS NULL OR v_clean_phone = '' THEN
    RAISE EXCEPTION 'PHONE_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT b.status, b.start_time, (c.phone = v_clean_phone)
    INTO v_status, v_start, v_phone_match
  FROM public.bookings b
  JOIN public.customers c ON c.id = b.customer_id
  WHERE b.id = p_booking_id AND b.tenant_id = p_tenant_id;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF NOT v_phone_match THEN
    RAISE EXCEPTION 'PHONE_MISMATCH' USING ERRCODE = '28000';
  END IF;
  IF v_status NOT IN ('pending','confirmed') THEN
    RAISE EXCEPTION 'NOT_CANCELLABLE_STATUS' USING ERRCODE = '22000';
  END IF;
  IF v_start <= now() THEN
    RAISE EXCEPTION 'BOOKING_ALREADY_STARTED' USING ERRCODE = '22000';
  END IF;

  UPDATE public.bookings
     SET status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = 'customer'
   WHERE id = p_booking_id;

  RETURN jsonb_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.list_customer_bookings(uuid, text)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_booking_by_phone(uuid, uuid, text) TO anon, authenticated;

-- ─── 4) Trigger: إشعار الموظفين عند إلغاء العميل ───────────────
CREATE OR REPLACE FUNCTION public.notify_customer_cancellation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_project_url text;
  v_secret text;
BEGIN
  IF NEW.status <> 'cancelled'
     OR NEW.cancelled_by IS DISTINCT FROM 'customer'
     OR OLD.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  v_project_url := public._get_vault_secret('PROJECT_URL');
  v_secret := public._get_vault_secret('INTERNAL_HOOK_SECRET');

  IF v_project_url IS NULL OR v_secret IS NULL THEN
    RAISE WARNING 'notify_customer_cancellation: missing vault secrets';
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url := v_project_url || '/functions/v1/send-booking-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_secret
      ),
      body := jsonb_build_object(
        'booking_id', NEW.id::text,
        'type', 'cancelled_by_customer'
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'send-booking-push (cancellation) call failed: %', SQLERRM;
  END;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'notify_customer_cancellation failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_notify_customer_cancellation ON public.bookings;
CREATE TRIGGER tg_notify_customer_cancellation
AFTER UPDATE ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.notify_customer_cancellation();
