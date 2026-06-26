-- ─────────────────────────────────────────────────────────────────────
-- تذكيرات تصاعدية للحجوزات المعلّقة
--
-- جدول الإرسال: 1h, 6h, 12h, 24h بعد إنشاء الحجز إذا بقي status='pending'.
-- يتوقف تلقائياً عند تغيير الحالة أو بدء وقت الحجز أو إكمال 4 تذكيرات.
--
-- يعتمد على pg_cron (يُفعَّل أدناه) و send-booking-push Edge Function الموجودة.
-- ─────────────────────────────────────────────────────────────────────

-- ─── 1) تفعيل pg_cron ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ─── 2) أعمدة التتبّع ───────────────────────────────────────────────
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS reminder_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reminded_at TIMESTAMPTZ;

-- لتفادي إرسال تذكيرات متراكمة لحجوزات قديمة (موجودة قبل هذا الـ migration):
-- نُعيّن reminder_count بحيث يطابق ما "كان يجب" إرساله، فلا يصل إلا التذكير التالي.
UPDATE public.bookings
SET reminder_count = CASE
  WHEN created_at < NOW() - INTERVAL '24 hours' THEN 4
  WHEN created_at < NOW() - INTERVAL '12 hours' THEN 3
  WHEN created_at < NOW() - INTERVAL '6 hours'  THEN 2
  WHEN created_at < NOW() - INTERVAL '1 hour'   THEN 1
  ELSE 0
END
WHERE status = 'pending' AND reminder_count = 0;

-- ─── 3) الدالة التي يستدعيها cron ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.send_pending_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_project_url text;
  v_secret text;
  v_booking RECORD;
  v_next_count int;
BEGIN
  v_project_url := public._get_vault_secret('PROJECT_URL');
  v_secret := public._get_vault_secret('INTERNAL_HOOK_SECRET');

  IF v_project_url IS NULL OR v_secret IS NULL THEN
    RAISE WARNING 'send_pending_reminders: missing vault secrets';
    RETURN;
  END IF;

  -- ابحث عن الحجوزات التي تحتاج تذكيراً الآن:
  --   pending + count<4 + start_time لم يأتِ بعد + مضى وقت التذكير القادم
  FOR v_booking IN
    SELECT id, reminder_count
    FROM public.bookings
    WHERE status = 'pending'
      AND reminder_count < 4
      AND start_time > NOW()
      AND created_at < NOW() - CASE reminder_count
        WHEN 0 THEN INTERVAL '1 hour'
        WHEN 1 THEN INTERVAL '6 hours'
        WHEN 2 THEN INTERVAL '12 hours'
        WHEN 3 THEN INTERVAL '24 hours'
      END
  LOOP
    v_next_count := v_booking.reminder_count + 1;

    BEGIN
      PERFORM net.http_post(
        url := v_project_url || '/functions/v1/send-booking-push',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_secret
        ),
        body := jsonb_build_object(
          'booking_id', v_booking.id::text,
          'type', 'reminder',
          'reminder_count', v_next_count
        )
      );

      UPDATE public.bookings
      SET reminder_count = v_next_count,
          last_reminded_at = NOW()
      WHERE id = v_booking.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'send_pending_reminders failed for booking %: %', v_booking.id, SQLERRM;
    END;
  END LOOP;
END;
$$;

-- ─── 4) جدولة cron كل 5 دقائق ───────────────────────────────────────
-- أزل الجدولة القديمة إن وُجدت (idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pending-booking-reminders') THEN
    PERFORM cron.unschedule('pending-booking-reminders');
  END IF;
END $$;

SELECT cron.schedule(
  'pending-booking-reminders',
  '*/5 * * * *',
  $$SELECT public.send_pending_reminders()$$
);
