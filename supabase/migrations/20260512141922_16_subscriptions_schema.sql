-- ============================================================
-- 16_subscriptions_schema: trial + monthly subscription system
-- Adds: trial_ends_at + subscription_ends_at + subscription_status on tenants,
--       plans table, subscriptions table, app_admins table,
--       helper functions is_super_admin / is_tenant_active / is_my_tenant_active.
-- ============================================================

-- 1. Tenant columns
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS trial_ends_at        timestamptz,
  ADD COLUMN IF NOT EXISTS subscription_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS subscription_status  text NOT NULL DEFAULT 'trial';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenants_subscription_status_check'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_subscription_status_check
      CHECK (subscription_status IN ('trial','active','expired','cancelled'));
  END IF;
END$$;

-- Backfill existing tenants: trial = created_at + 3 days
UPDATE public.tenants
SET trial_ends_at = created_at + interval '3 days'
WHERE trial_ends_at IS NULL;

-- 2. Plans table
CREATE TABLE IF NOT EXISTS public.plans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  price         numeric(10,2) NOT NULL,
  duration_days int NOT NULL DEFAULT 30,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.plans (name, price, duration_days)
SELECT 'شهري', 99, 30
WHERE NOT EXISTS (SELECT 1 FROM public.plans);

-- 3. Subscriptions table
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_id           uuid NOT NULL REFERENCES public.plans(id),
  status            text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','approved','rejected')),
  amount            numeric(10,2) NOT NULL,
  payment_reference text NOT NULL,
  note              text,
  period_start      timestamptz,
  period_end        timestamptz,
  reviewed_by       uuid REFERENCES auth.users(id),
  reviewed_at       timestamptz,
  reject_reason     text,
  created_by        uuid NOT NULL REFERENCES auth.users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscriptions_tenant_idx ON public.subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS subscriptions_pending_idx ON public.subscriptions(status) WHERE status = 'pending';

-- 4. App admins table (super admins)
CREATE TABLE IF NOT EXISTS public.app_admins (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 5. Enable RLS
ALTER TABLE public.plans         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_admins    ENABLE ROW LEVEL SECURITY;

-- 6. Helper functions
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_admins WHERE user_id = auth.uid())
$$;

-- يعتبر نشطاً إذا داخل التجربة أو الاشتراك، أو خلال 3 أيام فترة سماح بعدهما
CREATE OR REPLACE FUNCTION public.is_tenant_active(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenants
    WHERE id = p_tenant_id
      AND (
        (trial_ends_at IS NOT NULL AND now() < trial_ends_at + interval '3 days')
        OR (subscription_ends_at IS NOT NULL AND now() < subscription_ends_at + interval '3 days')
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.is_my_tenant_active()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_tenant_active(public.get_my_tenant_id())
$$;
;