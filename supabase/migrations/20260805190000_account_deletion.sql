-- حذف الحساب من داخل التطبيق — متطلَّب إلزامي في المتجرين
-- ============================================================================
-- أبل: القاعدة 5.1.1(v) — كل تطبيق يسمح بإنشاء حساب يجب أن يسمح بحذفه من داخله،
-- ولا يكفي توجيه المستخدم لمراسلة الدعم. وقوقل: سياسة حذف البيانات تُلزِم بمسارٍ
-- داخل التطبيق ورابطٍ على الويب. غياب هذا سببُ رفضٍ مؤكَّد في المراجعة الأولى.
--
-- التصميم يفرّق بين دورين، لأن «الحساب» يعني شيئين مختلفين:
--
--   موظّف  → تُحذف عضويته فقط. الملعب وبياناته ليست ملكه، وحذفها لأنه استقال
--            كارثةٌ لا خدمة.
--   مالك   → يُحذف الملعب وكل بياناته. حسابه هو المنشأة عملياً، وترك بيانات
--            منشأةٍ حُذف مالكها يعني بياناتٍ لا مالك لها ولا من يطلب حذفها.
--
-- الحذف فوري وكامل (لا «طلب حذف» يراجعه بشر) — وهذا ما تطلبه أبل حرفياً.
--
-- ⚠️ ملاحظة للمالك التجاري: سجلّات الاشتراكات المدفوعة تُحذف مع الملعب. إن لزمك
-- الاحتفاظ بها لأغراض الزكاة والضريبة (مدّة الحفظ النظامية في السعودية ٦ سنوات
-- للفواتير)، فالمكان الصحيح لذلك تصديرٌ دوري خارج قاعدة البيانات، لا تعطيل هذه
-- الدالة — فالمستخدم له حقٌّ في حذف بياناته الشخصية على أي حال.

-- ─── دالة الحذف ─────────────────────────────────────────────────────────────
-- security definer لأنها تحذف عبر جداول كثيرة تحجبها RLS، لكنها تعمل حصراً على
-- صاحب الجلسة: auth.uid() هو مصدرها الوحيد للهوية، فلا يمكن لمستخدم أن يحذف غيره.
create or replace function public.purge_my_account(p_delete_business boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid          uuid := auth.uid();
  v_role         text;
  v_tenant       uuid;
  v_tenant_name  text;
  v_leftover     text;
  v_tbl          record;
  v_count        bigint;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  select p.role, p.tenant_id, t.name
    into v_role, v_tenant, v_tenant_name
  from public.profiles p
  left join public.tenants t on t.id = p.tenant_id
  where p.id = v_uid;

  -- لا profile: حساب غير مرتبط بمنشأة (سُجّل ولم يُكمل الإعداد). لا بيانات
  -- لحذفها هنا — الدالة الحدّية تحذف مستخدم المصادقة نفسه.
  if v_role is null then
    delete from public.push_subscriptions where user_id = v_uid;
    return jsonb_build_object('scope', 'identity_only', 'tenant_deleted', false);
  end if;

  if v_role <> 'owner' then
    -- موظّف: عضويته وأجهزته فقط
    delete from public.push_subscriptions where user_id = v_uid;
    delete from public.profiles where id = v_uid;
    return jsonb_build_object('scope', 'staff_membership', 'tenant_deleted', false);
  end if;

  -- ── مالك ──
  if not p_delete_business then
    -- حاجزُ نيّة: حذف حساب المالك يمحو منشأة كاملة، فلا يقع بنداءٍ عابر
    raise exception 'OWNER_MUST_CONFIRM_BUSINESS_DELETION';
  end if;

  -- bookings أولاً وبالاسم: مفتاحاها إلى fields و customers من نوع RESTRICT
  -- (وهو صحيح ومقصود — يمنع محو أرضيةٍ لها حجوزات). لكنه يعني أن حذف الملعب
  -- مباشرةً قد يفشل بحسب ترتيب التتالي الذي يختاره المحرّك. حذفها هنا يرفع
  -- الحاجز قبل أن يُختبَر.
  delete from public.bookings where tenant_id = v_tenant;

  -- والباقي يتتالى من الملعب (كل مفاتيح tenant_id على cascade)
  delete from public.tenants where id = v_tenant;

  -- ── تحقّق ذاتي: لا صفوف باقية لهذا الملعب في أي جدول ──
  -- هذا الفحص هو ما يجعل الدالة تصمد للمستقبل: أي جدول جديد يُضاف لاحقاً بعمود
  -- tenant_id بلا cascade سيُسقِط الحذف بخطأ صريح، بدل أن ينجح الحذف صامتاً
  -- ويُبقي بيانات منشأةٍ طلب صاحبها محوَها. الفشل الصاخب هنا أرحم بكثير.
  -- admin_audit_log مستثنى بقصد: مفتاحه set null، وسجلّ إجراءات المشرف العام
  -- ملكُ المنصّة لا الملعب، ويبقى بلا إشارةٍ إليه.
  for v_tbl in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'tenant_id'
      and t.table_type = 'BASE TABLE'
      and c.table_name <> 'admin_audit_log'
  loop
    execute format('select count(*) from public.%I where tenant_id = $1', v_tbl.table_name)
      into v_count using v_tenant;
    if v_count > 0 then
      v_leftover := coalesce(v_leftover || ', ', '') || v_tbl.table_name || '(' || v_count || ')';
    end if;
  end loop;

  if v_leftover is not null then
    raise exception 'PURGE_INCOMPLETE: بقيت صفوف في %', v_leftover;
  end if;

  return jsonb_build_object(
    'scope', 'owner_and_business',
    'tenant_deleted', true,
    'tenant_name', v_tenant_name
  );
end;
$$;

revoke all on function public.purge_my_account(boolean) from public;
grant execute on function public.purge_my_account(boolean) to authenticated;

comment on function public.purge_my_account(boolean) is
  'يحذف حساب صاحب الجلسة. الموظّف: عضويته فقط. المالك: الملعب وكل بياناته (يلزم p_delete_business=true). تستدعيها Edge Function delete-account التي تحذف بعدها مستخدم المصادقة.';
