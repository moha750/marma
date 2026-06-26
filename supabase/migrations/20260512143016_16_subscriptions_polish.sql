-- Performance polish:
-- 1) Indexes for subscriptions FKs
CREATE INDEX IF NOT EXISTS subscriptions_plan_idx        ON public.subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS subscriptions_reviewed_by_idx ON public.subscriptions(reviewed_by);
CREATE INDEX IF NOT EXISTS subscriptions_created_by_idx  ON public.subscriptions(created_by);

-- 2) Optimize app_admins SELECT policy: use (select auth.uid()) so it's
--    evaluated once per query instead of per row.
DROP POLICY IF EXISTS app_admins_select_self ON public.app_admins;
CREATE POLICY app_admins_select_self ON public.app_admins
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- 3) Avoid duplicate permissive SELECT policies on plans.
--    plans_write_admin was FOR ALL (which includes SELECT); split it
--    into specific INSERT/UPDATE/DELETE so only one SELECT policy exists.
DROP POLICY IF EXISTS plans_write_admin ON public.plans;
CREATE POLICY plans_insert_admin ON public.plans
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());
CREATE POLICY plans_update_admin ON public.plans
  FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());
CREATE POLICY plans_delete_admin ON public.plans
  FOR DELETE TO authenticated
  USING (public.is_super_admin());
;