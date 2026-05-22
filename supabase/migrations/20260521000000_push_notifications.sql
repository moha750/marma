-- ─────────────────────────────────────────────────────────────────────
-- إشعارات Push عبر Web Push API.
--
-- يضيف جدول push_subscriptions ويوسّع tg_notify_new_booking ليستدعي
-- Edge Function send-booking-push بالإضافة إلى send-booking-notification (الإيميل).
--
-- متطلبات قبل التشغيل (Vault secrets — يجب أن تكون موجودة من email_hooks):
--   PROJECT_URL          — رابط Supabase project
--   INTERNAL_HOOK_SECRET — السر المشترك بين DB و Edge Functions
-- ─────────────────────────────────────────────────────────────────────

-- ─── 1) جدول الاشتراكات ──────────────────────────────────────────────

CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh_key text NOT NULL,
  auth_key text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  failed_count int NOT NULL DEFAULT 0
);

CREATE INDEX idx_push_sub_tenant ON public.push_subscriptions(tenant_id);
CREATE INDEX idx_push_sub_user ON public.push_subscriptions(user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- المستخدم يدير اشتراكاته فقط (insert/select/update/delete على الصفوف الخاصة به)
CREATE POLICY "users_manage_own_push_subs" ON public.push_subscriptions
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- service_role (المستخدم في Edge Function) يتجاوز RLS تلقائياً

-- ─── 2) توسيع trigger الحجز الجديد ───────────────────────────────────
-- النسخة الجديدة تستدعي كلاً من email و push functions.
-- الفشل في أيٍّ منهما لا يُفشل INSERT.

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
  -- نُرسل فقط للحجوزات الجديدة بحالة pending (من الرابط العام)
  IF NEW.status IS DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;

  v_project_url := public._get_vault_secret('PROJECT_URL');
  v_secret := public._get_vault_secret('INTERNAL_HOOK_SECRET');

  IF v_project_url IS NULL OR v_secret IS NULL THEN
    RAISE WARNING 'notify_new_booking: missing vault secrets (PROJECT_URL/INTERNAL_HOOK_SECRET)';
    RETURN NEW;
  END IF;

  -- إيميل (موجود)
  BEGIN
    PERFORM net.http_post(
      url := v_project_url || '/functions/v1/send-booking-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_secret
      ),
      body := jsonb_build_object('booking_id', NEW.id::text)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'send-booking-notification call failed: %', SQLERRM;
  END;

  -- Push (جديد) — مستقلّ عن الإيميل
  BEGIN
    PERFORM net.http_post(
      url := v_project_url || '/functions/v1/send-booking-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_secret
      ),
      body := jsonb_build_object('booking_id', NEW.id::text)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'send-booking-push call failed: %', SQLERRM;
  END;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'notify_new_booking failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

-- لا حاجة لإعادة إنشاء TRIGGER نفسه (يبقى من email_hooks migration)
