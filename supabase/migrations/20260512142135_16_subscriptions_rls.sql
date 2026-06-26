-- ============================================================
-- 16_subscriptions_rls: RLS on new tables + tighten existing write policies
-- ============================================================

-- plans: anyone authenticated can SELECT active plans (or super-admin sees all);
--        super-admin only can write
DROP POLICY IF EXISTS plans_select_authenticated ON public.plans;
CREATE POLICY plans_select_authenticated ON public.plans
  FOR SELECT TO authenticated
  USING (is_active = true OR public.is_super_admin());

DROP POLICY IF EXISTS plans_write_admin ON public.plans;
CREATE POLICY plans_write_admin ON public.plans
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- subscriptions: own tenant SELECT; writes go via SECURITY DEFINER RPCs only
DROP POLICY IF EXISTS subscriptions_select_own_or_admin ON public.subscriptions;
CREATE POLICY subscriptions_select_own_or_admin ON public.subscriptions
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id() OR public.is_super_admin());

-- لا توجد سياسات INSERT/UPDATE/DELETE — كل التعديلات عبر RPCs (SECURITY DEFINER)

-- app_admins: self-read only
DROP POLICY IF EXISTS app_admins_select_self ON public.app_admins;
CREATE POLICY app_admins_select_self ON public.app_admins
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ============================================================
-- تشديد policies الكتابة: نضيف شرط is_my_tenant_active()
-- ============================================================

-- bookings
DROP POLICY IF EXISTS bookings_insert_own_tenant ON public.bookings;
CREATE POLICY bookings_insert_own_tenant ON public.bookings
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_my_tenant_id() AND public.is_my_tenant_active());

DROP POLICY IF EXISTS bookings_update_own_tenant ON public.bookings;
CREATE POLICY bookings_update_own_tenant ON public.bookings
  FOR UPDATE TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.is_my_tenant_active())
  WITH CHECK (tenant_id = public.get_my_tenant_id() AND public.is_my_tenant_active());

DROP POLICY IF EXISTS bookings_delete_own_tenant ON public.bookings;
CREATE POLICY bookings_delete_own_tenant ON public.bookings
  FOR DELETE TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.is_my_tenant_active());

-- customers
DROP POLICY IF EXISTS customers_insert_own_tenant ON public.customers;
CREATE POLICY customers_insert_own_tenant ON public.customers
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_my_tenant_id() AND public.is_my_tenant_active());

DROP POLICY IF EXISTS customers_update_own_tenant ON public.customers;
CREATE POLICY customers_update_own_tenant ON public.customers
  FOR UPDATE TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.is_my_tenant_active())
  WITH CHECK (tenant_id = public.get_my_tenant_id() AND public.is_my_tenant_active());

DROP POLICY IF EXISTS customers_delete_own_tenant ON public.customers;
CREATE POLICY customers_delete_own_tenant ON public.customers
  FOR DELETE TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.is_my_tenant_active());

-- fields
DROP POLICY IF EXISTS fields_insert_owner ON public.fields;
CREATE POLICY fields_insert_owner ON public.fields
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_my_tenant_id() AND public.is_owner() AND public.is_my_tenant_active());

DROP POLICY IF EXISTS fields_update_owner ON public.fields;
CREATE POLICY fields_update_owner ON public.fields
  FOR UPDATE TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.is_owner() AND public.is_my_tenant_active())
  WITH CHECK (tenant_id = public.get_my_tenant_id() AND public.is_owner() AND public.is_my_tenant_active());

DROP POLICY IF EXISTS fields_delete_owner ON public.fields;
CREATE POLICY fields_delete_owner ON public.fields
  FOR DELETE TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.is_owner() AND public.is_my_tenant_active());

-- working_periods
DROP POLICY IF EXISTS working_periods_insert_owner ON public.working_periods;
CREATE POLICY working_periods_insert_owner ON public.working_periods
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_my_tenant_id() AND public.is_owner() AND public.is_my_tenant_active());

DROP POLICY IF EXISTS working_periods_update_owner ON public.working_periods;
CREATE POLICY working_periods_update_owner ON public.working_periods
  FOR UPDATE TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.is_owner() AND public.is_my_tenant_active())
  WITH CHECK (tenant_id = public.get_my_tenant_id() AND public.is_owner() AND public.is_my_tenant_active());

DROP POLICY IF EXISTS working_periods_delete_owner ON public.working_periods;
CREATE POLICY working_periods_delete_owner ON public.working_periods
  FOR DELETE TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.is_owner() AND public.is_my_tenant_active());
;