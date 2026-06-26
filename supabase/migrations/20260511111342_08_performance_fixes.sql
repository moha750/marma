-- إضافة فهارس للمفاتيح الخارجية التي تشير إلى auth.users
CREATE INDEX IF NOT EXISTS idx_bookings_created_by ON public.bookings(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_staff_invitations_created_by ON public.staff_invitations(created_by) WHERE created_by IS NOT NULL;

-- إصلاح سياسات profiles لاستخدام (select auth.uid()) بدل auth.uid() مباشرة
-- هذا يمنع إعادة تقييم الدالة لكل صف
DROP POLICY IF EXISTS "profiles_update_self" ON public.profiles;
CREATE POLICY "profiles_update_self"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()) AND tenant_id = public.get_my_tenant_id());

DROP POLICY IF EXISTS "profiles_delete_owner" ON public.profiles;
CREATE POLICY "profiles_delete_owner"
  ON public.profiles FOR DELETE
  TO authenticated
  USING (
    tenant_id = public.get_my_tenant_id()
    AND public.is_owner()
    AND id <> (SELECT auth.uid())
  );
;