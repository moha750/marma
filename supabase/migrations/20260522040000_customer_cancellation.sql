-- ─────────────────────────────────────────────────────────────────────
-- إلغاء الحجز ذاتياً من طرف العميل (Customer self-service cancellation).
--
-- يضيف:
--   1) حقلَي audit: cancelled_at, cancelled_by ('staff'|'customer')
--   2) RPC: get_booking_for_customer  — جلب حجز عبر (tenant_id + booking_id) للعرض
--   3) RPC: cancel_booking_by_customer — إلغاء بشرط مطابقة آخر 4 أرقام من الجوال
--   4) Trigger: notify_customer_cancellation — يُرسل push للموظفين عند إلغاء العميل
--
-- ملاحظات:
--   - cancelled='cancelled' يُحرّر السلوت تلقائياً عبر get_available_slots وقيد
--     no_overlapping_bookings (كلاهما يفلتر cancelled).
--   - تذكيرات الحجوزات المعلّقة تتوقف ذاتياً لأن send_pending_reminders يفلتر
--     status='pending'.
--   - لا يوجد منطق refund — paid_amount يبقى كما هو.
-- ─────────────────────────────────────────────────────────────────────

-- ─── 1) حقول audit ────────────────────────────────────────────
ALTER TABLE public.bookings
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancelled_by text CHECK (cancelled_by IN ('staff','customer'));

-- ─── 2) RPC: جلب حجز للعرض (UUID فقط) ─────────────────────────
-- يُعيد التفاصيل + آخر 4 أرقام من الجوال (للتلميح للعميل) + علم is_cancellable.
CREATE OR REPLACE FUNCTION public.get_booking_for_customer(
  p_tenant_id uuid,
  p_booking_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', b.id,
    'status', b.status,
    'start_time', b.start_time,
    'end_time', b.end_time,
    'total_price', b.total_price,
    'paid_amount', b.paid_amount,
    'field_name', f.name,
    'field_city', f.city,
    'tenant_name', t.name,
    'cancelled_at', b.cancelled_at,
    'cancelled_by', b.cancelled_by,
    'is_cancellable', (b.status IN ('pending','confirmed') AND b.start_time > now())
  ) INTO v_row
  FROM public.bookings b
  JOIN public.fields f ON f.id = b.field_id
  JOIN public.tenants t ON t.id = b.tenant_id
  WHERE b.id = p_booking_id AND b.tenant_id = p_tenant_id;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_row;
END $$;

-- ─── 3) RPC: إلغاء بواسطة العميل (UUID + آخر 4 أرقام) ──────────
CREATE OR REPLACE FUNCTION public.cancel_booking_by_customer(
  p_tenant_id uuid,
  p_booking_id uuid,
  p_phone_last4 text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_start timestamptz;
  v_phone_match boolean;
BEGIN
  SELECT b.status, b.start_time, (RIGHT(c.phone, 4) = p_phone_last4)
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

GRANT EXECUTE ON FUNCTION public.get_booking_for_customer(uuid, uuid)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_booking_by_customer(uuid, uuid, text) TO anon, authenticated;

-- ─── 4) Trigger: إشعار الموظفين عند إلغاء العميل ───────────────
-- يستدعي send-booking-push بنوع جديد 'cancelled_by_customer'.
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
  -- فقط عند الانتقال إلى cancelled بواسطة العميل
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
