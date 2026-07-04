-- سياسة SELECT للمشرف العام على جدول المنشآت.
-- المشرف يرى كل المنشآت أصلًا عبر RPCs (SECURITY DEFINER)، فهذه لا تكشف بيانات جديدة،
-- لكنها تُمكّن Realtime من تسليم أحداث كل المنشآت للوحة الأدمن (منشأة جديدة، تغيّر حالة).
create policy tenants_select_admin on public.tenants
  for select to authenticated
  using (is_super_admin());
