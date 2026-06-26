
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS allowed_fields integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS allowed_staff  integer NOT NULL DEFAULT 0;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS requested_fields integer,
  ADD COLUMN IF NOT EXISTS requested_staff  integer;

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_allowed_fields_positive CHECK (allowed_fields >= 1),
  ADD CONSTRAINT tenants_allowed_staff_nonneg    CHECK (allowed_staff  >= 0);
;