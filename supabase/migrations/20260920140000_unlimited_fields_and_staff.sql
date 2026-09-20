-- «أرضيات وموظفون بلا حدّ» — يصير حقيقةً في الجدول لا وعدًا على الصفحة.
--
-- الحدّان (allowed_fields = 1، allowed_staff = 0) وُضعا يوم كان السعر يُحسب
-- بالوحدات: كل أرضية إضافية ٥٠ ريالًا، فالحدّ كان أداة تحصيل. ومنذ
-- 20260920120000 صار السعر واحدًا شاملًا (v_unit_price = 0)، فبقي الحدّ بلا
-- وظيفة — إلا أنه ظلّ يعمل: صاحب ملعب بأرضيتين يصطدم في أول يوم بـ«بلغت حدّ
-- الأرضيات. ارفع الباقة»، وصفحة الهبوط ورسائل البيع تعده بلا حدود.
--
-- ٩٩٩ لا «بلا حدّ» حرفيًا: القيد tenants_allowed_fields_positive يفرض >= 1،
-- والعمود integer، فرقم كبير أبسط من إعادة تصميم القيد، ويظلّ سقفًا يكشف أي
-- خلل لو تضاعفت الصفوف بلا سبب.
--
-- يسري على القائم والجديد معًا: الافتراضي للحسابات القادمة (create_owner_tenant
-- لا يمرّر العمودين فيأخذان الافتراضي)، والـ update للتسعة الموجودين.

alter table public.tenants alter column allowed_fields set default 999;
alter table public.tenants alter column allowed_staff  set default 999;

update public.tenants
   set allowed_fields = greatest(allowed_fields, 999),
       allowed_staff  = greatest(allowed_staff,  999)
 where allowed_fields < 999 or allowed_staff < 999;
