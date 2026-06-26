-- جدول دعوات الموظفين
-- المالك يولّد رمز دعوة، الموظف يستخدم الرابط للتسجيل
CREATE TABLE public.staff_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text NOT NULL,
  code text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  used_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_staff_invitations_tenant ON public.staff_invitations(tenant_id);
CREATE INDEX idx_staff_invitations_code ON public.staff_invitations(code) WHERE used_at IS NULL;

-- دالة عامة لجلب معلومات دعوة بالرمز فقط (تُستدعى من صفحة signup قبل المصادقة)
-- ترجع فقط البيانات اللازمة للعرض، لا تكشف tenant أو معلومات حساسة أخرى
CREATE OR REPLACE FUNCTION public.get_invitation_by_code(invite_code text)
RETURNS TABLE (
  email text,
  full_name text,
  tenant_name text,
  is_valid boolean
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    si.email,
    si.full_name,
    t.name AS tenant_name,
    (si.used_at IS NULL AND si.expires_at > now()) AS is_valid
  FROM public.staff_invitations si
  JOIN public.tenants t ON t.id = si.tenant_id
  WHERE si.code = invite_code
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_invitation_by_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invitation_by_code(text) TO anon, authenticated;
;