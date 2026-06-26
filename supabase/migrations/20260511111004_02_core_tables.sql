-- 1. جدول الملاعب (المستأجرون)
CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  city text,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. جدول المستخدمين (ملاك وموظفو الملاعب)
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'staff')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_tenant ON public.profiles(tenant_id);

-- 3. جدول الأرضيات (ملعب قد يحتوي على عدة أرضيات)
CREATE TABLE public.fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  hourly_price numeric(10,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_fields_tenant ON public.fields(tenant_id);

-- 4. جدول العملاء
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  phone text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone)
);

CREATE INDEX idx_customers_tenant_name ON public.customers(tenant_id, full_name);

-- 5. جدول الحجوزات
CREATE TABLE public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  field_id uuid NOT NULL REFERENCES public.fields(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  total_price numeric(10,2) NOT NULL,
  paid_amount numeric(10,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'completed', 'cancelled')),
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time),
  CHECK (paid_amount >= 0 AND paid_amount <= total_price)
);

CREATE INDEX idx_bookings_tenant_start ON public.bookings(tenant_id, start_time);
CREATE INDEX idx_bookings_field_start ON public.bookings(field_id, start_time);
CREATE INDEX idx_bookings_customer ON public.bookings(customer_id);

-- قيد منع تعارض الحجوزات على مستوى قاعدة البيانات
-- يستخدم EXCLUSION constraint مع btree_gist
ALTER TABLE public.bookings ADD CONSTRAINT no_overlapping_bookings
EXCLUDE USING gist (
  field_id WITH =,
  tstzrange(start_time, end_time, '[)') WITH &&
) WHERE (status != 'cancelled');

-- دالة مساعدة لإرجاع tenant_id للمستخدم الحالي (تُستخدم في سياسات RLS)
CREATE OR REPLACE FUNCTION public.get_my_tenant_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
$$;

REVOKE ALL ON FUNCTION public.get_my_tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_tenant_id() TO authenticated;

-- دالة مساعدة للتحقق من دور المستخدم
CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'owner'
  )
$$;

REVOKE ALL ON FUNCTION public.is_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated;
;