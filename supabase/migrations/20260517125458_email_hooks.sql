-- ─────────────────────────────────────────────────────────────────────
-- Triggers لإرسال إشعارات البريد عبر Edge Functions.
--
-- يستخدم pg_net للنداء HTTP غير المتزامن من قاعدة البيانات.
-- يستخدم Vault لتخزين السر المشترك (INTERNAL_HOOK_SECRET) و project ref.
--
-- متطلبات قبل التشغيل (تُنفَّذ يدوياً مرة واحدة):
--   SELECT vault.create_secret('<random-secret>', 'INTERNAL_HOOK_SECRET');
--   SELECT vault.create_secret('https://vwzseueqfghirhyhwbva.supabase.co', 'PROJECT_URL');
-- ─────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ─── دالة مساعدة: تقرأ سر من Vault ─────────────────────────
CREATE OR REPLACE FUNCTION public._get_vault_secret(secret_name text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = vault, public
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = secret_name LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public._get_vault_secret(text) FROM PUBLIC, anon, authenticated;

-- ─── 1) Trigger: حجز جديد (status='pending') ──────────────
CREATE OR REPLACE FUNCTION public.notify_new_booking()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_project_url text;
  v_secret text;
BEGIN
  -- نُرسل فقط للحجوزات الجديدة بحالة pending (التي تأتي من الرابط العام)
  IF NEW.status IS DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;

  v_project_url := public._get_vault_secret('PROJECT_URL');
  v_secret := public._get_vault_secret('INTERNAL_HOOK_SECRET');

  IF v_project_url IS NULL OR v_secret IS NULL THEN
    RAISE WARNING 'notify_new_booking: missing vault secrets (PROJECT_URL/INTERNAL_HOOK_SECRET)';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_project_url || '/functions/v1/send-booking-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := jsonb_build_object('booking_id', NEW.id::text)
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- لا نُفشل insert الحجز لو فشل الإشعار
    RAISE WARNING 'notify_new_booking failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_notify_new_booking ON public.bookings;
CREATE TRIGGER tg_notify_new_booking
AFTER INSERT ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.notify_new_booking();

-- ─── 2) Trigger: دعوة موظف جديدة ───────────────────────────
CREATE OR REPLACE FUNCTION public.notify_staff_invitation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_project_url text;
  v_secret text;
BEGIN
  v_project_url := public._get_vault_secret('PROJECT_URL');
  v_secret := public._get_vault_secret('INTERNAL_HOOK_SECRET');

  IF v_project_url IS NULL OR v_secret IS NULL THEN
    RAISE WARNING 'notify_staff_invitation: missing vault secrets';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_project_url || '/functions/v1/send-staff-invitation',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := jsonb_build_object('invitation_id', NEW.id::text)
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'notify_staff_invitation failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_notify_staff_invitation ON public.staff_invitations;
CREATE TRIGGER tg_notify_staff_invitation
AFTER INSERT ON public.staff_invitations
FOR EACH ROW
EXECUTE FUNCTION public.notify_staff_invitation();
