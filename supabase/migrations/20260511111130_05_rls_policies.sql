-- تفعيل RLS على كل الجداول
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_invitations ENABLE ROW LEVEL SECURITY;

-- ============== tenants ==============
-- كل أعضاء tenant يستطيعون قراءته
CREATE POLICY "tenants_select_own"
  ON public.tenants FOR SELECT
  TO authenticated
  USING (id = public.get_my_tenant_id());

-- فقط المالك يستطيع التعديل
CREATE POLICY "tenants_update_owner"
  ON public.tenants FOR UPDATE
  TO authenticated
  USING (id = public.get_my_tenant_id() AND public.is_owner())
  WITH CHECK (id = public.get_my_tenant_id() AND public.is_owner());

-- ============== profiles ==============
-- كل أعضاء tenant يستطيعون رؤية بعضهم
CREATE POLICY "profiles_select_own_tenant"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_my_tenant_id());

-- المستخدم يستطيع تحديث بياناته (الاسم فقط، الدور محمي بـ trigger إذا أردنا)
CREATE POLICY "profiles_update_self"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND tenant_id = public.get_my_tenant_id());

-- المالك يستطيع حذف موظف (لكن ليس نفسه)
CREATE POLICY "profiles_delete_owner"
  ON public.profiles FOR DELETE
  TO authenticated
  USING (
    tenant_id = public.get_my_tenant_id()
    AND public.is_owner()
    AND id <> auth.uid()
  );

-- ============== fields ==============
-- كل المستخدمين داخل tenant يستطيعون رؤية الأرضيات
CREATE POLICY "fields_select_own_tenant"
  ON public.fields FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_my_tenant_id());

-- المالك فقط يستطيع إضافة أرضية
CREATE POLICY "fields_insert_owner"
  ON public.fields FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = public.get_my_tenant_id() AND public.is_owner());

-- المالك فقط يستطيع تعديل أرضية
CREATE POLICY "fields_update_owner"
  ON public.fields FOR UPDATE
  TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.is_owner())
  WITH CHECK (tenant_id = public.get_my_tenant_id() AND public.is_owner());

-- المالك فقط يستطيع حذف أرضية
CREATE POLICY "fields_delete_owner"
  ON public.fields FOR DELETE
  TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.is_owner());

-- ============== customers ==============
-- كل العاملين داخل tenant يستطيعون إدارة العملاء
CREATE POLICY "customers_select_own_tenant"
  ON public.customers FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_my_tenant_id());

CREATE POLICY "customers_insert_own_tenant"
  ON public.customers FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = public.get_my_tenant_id());

CREATE POLICY "customers_update_own_tenant"
  ON public.customers FOR UPDATE
  TO authenticated
  USING (tenant_id = public.get_my_tenant_id())
  WITH CHECK (tenant_id = public.get_my_tenant_id());

CREATE POLICY "customers_delete_own_tenant"
  ON public.customers FOR DELETE
  TO authenticated
  USING (tenant_id = public.get_my_tenant_id());

-- ============== bookings ==============
-- كل العاملين داخل tenant يستطيعون إدارة الحجوزات
CREATE POLICY "bookings_select_own_tenant"
  ON public.bookings FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_my_tenant_id());

CREATE POLICY "bookings_insert_own_tenant"
  ON public.bookings FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = public.get_my_tenant_id());

CREATE POLICY "bookings_update_own_tenant"
  ON public.bookings FOR UPDATE
  TO authenticated
  USING (tenant_id = public.get_my_tenant_id())
  WITH CHECK (tenant_id = public.get_my_tenant_id());

CREATE POLICY "bookings_delete_own_tenant"
  ON public.bookings FOR DELETE
  TO authenticated
  USING (tenant_id = public.get_my_tenant_id());

-- ============== staff_invitations ==============
-- المالك فقط يدير دعوات الموظفين
CREATE POLICY "staff_invitations_select_owner"
  ON public.staff_invitations FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.is_owner());

CREATE POLICY "staff_invitations_insert_owner"
  ON public.staff_invitations FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = public.get_my_tenant_id() AND public.is_owner());

CREATE POLICY "staff_invitations_delete_owner"
  ON public.staff_invitations FOR DELETE
  TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.is_owner());
;