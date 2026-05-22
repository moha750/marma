-- ─────────────────────────────────────────────────────────────────────
-- تنبيهات اقتراب انتهاء التجربة / الاشتراك / فترة السماح
--
-- يعمل بدقّة الساعة (وليس اليوم) لأن expires_at يحفظ الساعة والدقيقة.
-- نوافذ ساعتين كاحتياط (cron يعمل كل ساعة).
--
-- 9 إشعارات محتملة عبر دورة حياة الحساب:
--   3 للتجربة (trial_3d, trial_1d, trial_final)
--   3 للاشتراك المدفوع (sub_3d, sub_1d, sub_final)
--   3 لفترة السماح قبل القفل الكامل (grace_3d, grace_1d, grace_final)
-- ─────────────────────────────────────────────────────────────────────

-- ─── 1) جدول لتتبّع ما أُرسل (يمنع التكرار) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.subscription_warnings_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind text NOT NULL,
  target_timestamp timestamptz NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);

-- المفتاح الفريد: (tenant, kind, target) — يضمن أن كل تحذير محدّد يُرسَل مرة واحدة
-- ولو غُيّر expires_at لاحقاً (تجديد)، target_timestamp يختلف → يُسمح بإرسال جديد
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscription_warnings_log
  ON public.subscription_warnings_log (tenant_id, kind, target_timestamp);

CREATE INDEX IF NOT EXISTS idx_subscription_warnings_log_tenant
  ON public.subscription_warnings_log (tenant_id);

ALTER TABLE public.subscription_warnings_log ENABLE ROW LEVEL SECURITY;
-- لا policy للمستخدمين العاديين — service_role فقط يكتب/يقرأ

-- فهارس على tenants لتسريع نوافذ الاستعلام
CREATE INDEX IF NOT EXISTS idx_tenants_trial_ends ON public.tenants(trial_ends_at)
  WHERE trial_ends_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tenants_sub_ends ON public.tenants(subscription_ends_at)
  WHERE subscription_ends_at IS NOT NULL;

-- ─── 2) دالة مساعدة: ترسل تحذيراً إن لم يُرسَل سابقاً ────────────────
CREATE OR REPLACE FUNCTION public._maybe_send_subscription_warning(
  p_tenant_id uuid,
  p_kind text,
  p_target timestamptz,
  p_min_offset interval,
  p_max_offset interval,
  p_project_url text,
  p_secret text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- شِك أن target ضمن النافذة الزمنية المطلوبة
  IF p_target NOT BETWEEN NOW() + p_min_offset AND NOW() + p_max_offset THEN
    RETURN;
  END IF;

  -- حاول إدراج سجل اللوغ — لو conflict، يعني سبق إرساله، تجاهل
  BEGIN
    INSERT INTO public.subscription_warnings_log (tenant_id, kind, target_timestamp)
    VALUES (p_tenant_id, p_kind, p_target);
  EXCEPTION WHEN unique_violation THEN
    RETURN;
  END;

  -- استدعِ Edge Function
  BEGIN
    PERFORM net.http_post(
      url := p_project_url || '/functions/v1/send-subscription-warning',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || p_secret
      ),
      body := jsonb_build_object(
        'tenant_id', p_tenant_id::text,
        'kind', p_kind
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'send-subscription-warning call failed (%, %): %',
      p_tenant_id, p_kind, SQLERRM;
  END;
END;
$$;

-- ─── 3) الدالة الرئيسية التي يستدعيها cron ───────────────────────────
CREATE OR REPLACE FUNCTION public.send_subscription_warnings()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_project_url text;
  v_secret text;
  v_tenant RECORD;
  v_hard_lock timestamptz;
BEGIN
  v_project_url := public._get_vault_secret('PROJECT_URL');
  v_secret := public._get_vault_secret('INTERNAL_HOOK_SECRET');

  IF v_project_url IS NULL OR v_secret IS NULL THEN
    RAISE WARNING 'send_subscription_warnings: missing vault secrets';
    RETURN;
  END IF;

  -- فلترة مبكّرة: فقط tenants لها تجربة أو اشتراك سيُعمل لها تذكير
  FOR v_tenant IN
    SELECT id, trial_ends_at, subscription_ends_at
    FROM public.tenants
    WHERE
      -- التجربة لا تزال قادمة (خلال 3 أيام)
      (subscription_ends_at IS NULL AND trial_ends_at > NOW() AND trial_ends_at < NOW() + INTERVAL '4 days')
      -- أو اشتراك مدفوع له expires/lock خلال 4 أيام
      OR (subscription_ends_at IS NOT NULL
          AND subscription_ends_at + INTERVAL '3 days' > NOW()
          AND subscription_ends_at < NOW() + INTERVAL '4 days')
  LOOP
    -- ── المسار 1: تجربة فقط (لا اشتراك مدفوع)
    IF v_tenant.subscription_ends_at IS NULL AND v_tenant.trial_ends_at IS NOT NULL THEN
      PERFORM public._maybe_send_subscription_warning(
        v_tenant.id, 'trial_3d', v_tenant.trial_ends_at,
        INTERVAL '71 hours', INTERVAL '73 hours', v_project_url, v_secret
      );
      PERFORM public._maybe_send_subscription_warning(
        v_tenant.id, 'trial_1d', v_tenant.trial_ends_at,
        INTERVAL '23 hours', INTERVAL '25 hours', v_project_url, v_secret
      );
      PERFORM public._maybe_send_subscription_warning(
        v_tenant.id, 'trial_final', v_tenant.trial_ends_at,
        INTERVAL '1 hour', INTERVAL '3 hours', v_project_url, v_secret
      );
    END IF;

    -- ── المسار 2: اشتراك مدفوع (نشط أو في السماح)
    IF v_tenant.subscription_ends_at IS NOT NULL THEN
      -- تحذيرات قبل انتهاء الاشتراك
      PERFORM public._maybe_send_subscription_warning(
        v_tenant.id, 'sub_3d', v_tenant.subscription_ends_at,
        INTERVAL '71 hours', INTERVAL '73 hours', v_project_url, v_secret
      );
      PERFORM public._maybe_send_subscription_warning(
        v_tenant.id, 'sub_1d', v_tenant.subscription_ends_at,
        INTERVAL '23 hours', INTERVAL '25 hours', v_project_url, v_secret
      );
      PERFORM public._maybe_send_subscription_warning(
        v_tenant.id, 'sub_final', v_tenant.subscription_ends_at,
        INTERVAL '1 hour', INTERVAL '3 hours', v_project_url, v_secret
      );

      -- تحذيرات فترة السماح (قبل القفل الكامل = subscription_ends_at + 3 days)
      v_hard_lock := v_tenant.subscription_ends_at + INTERVAL '3 days';
      PERFORM public._maybe_send_subscription_warning(
        v_tenant.id, 'grace_3d', v_hard_lock,
        INTERVAL '71 hours', INTERVAL '73 hours', v_project_url, v_secret
      );
      PERFORM public._maybe_send_subscription_warning(
        v_tenant.id, 'grace_1d', v_hard_lock,
        INTERVAL '23 hours', INTERVAL '25 hours', v_project_url, v_secret
      );
      PERFORM public._maybe_send_subscription_warning(
        v_tenant.id, 'grace_final', v_hard_lock,
        INTERVAL '1 hour', INTERVAL '3 hours', v_project_url, v_secret
      );
    END IF;
  END LOOP;
END;
$$;

-- ─── 4) جدولة cron كل ساعة ───────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'subscription-warnings') THEN
    PERFORM cron.unschedule('subscription-warnings');
  END IF;
END $$;

SELECT cron.schedule(
  'subscription-warnings',
  '0 * * * *',  -- كل ساعة عند الدقيقة 0
  $$SELECT public.send_subscription_warnings()$$
);
