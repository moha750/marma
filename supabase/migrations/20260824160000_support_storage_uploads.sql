-- الصور تُرفض داخل جلسة النيابة — لأن التخزين لم يمرّ بموضع الغرس.
--
-- كل سياسة RLS في القاعدة تنتهي إلى get_my_tenant_id()، ولذلك كسبت الجلسة كل
-- جدولٍ بتعديلٍ واحد. أمّا سياسات storage.objects فكُتبت قبل ذلك بأشهر، وتسأل
-- profiles مباشرةً: `(storage.foldername(name))[1] = (select tenant_id from
-- profiles where id = auth.uid())`. والمشرف لا صفّ له في profiles — بالتصميم،
-- فهو ليس عضواً في ملعبٍ أصلاً — فيعود الاستعلام null، فتسقط المطابقة، فيأتي
-- "new row violates row-level security policy". لا الجلسة انتهت، ولا الصلاحية
-- نقصت: السؤال وحده كان يسأل المكان الخطأ.
--
-- وهذا بالضبط ما حذّرت منه هجرة النيابة: «أوّل جدولٍ يُنسى ثغرةٌ صامتة» — وقد
-- كان. والعلاج هو العلاج نفسه: تسأل السياسة get_my_tenant_id() فترث الجلسة
-- كما ورثها كل شيءٍ آخر، ويبقى سلوك المالك والموظّف كما هو حرفاً بحرف (الدالّة
-- تعود إلى profiles حين لا جلسة).
--
-- وما لا يُمسّ: payment-receipts. إيصال الدفع مالٌ، والمال بابٌ مقفل على الدعم
-- كما في التريجرات — يبقى مربوطاً بـ profiles وبدور المالك وحده.

-- INSERT
drop policy if exists "field_images_tenant_insert" on storage.objects;
create policy "field_images_tenant_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'field-images'
    and (storage.foldername(name))[1] = public.get_my_tenant_id()::text
  );

-- UPDATE (upsert=true يولّد UPDATE عند الاستبدال)
drop policy if exists "field_images_tenant_update" on storage.objects;
create policy "field_images_tenant_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'field-images'
    and (storage.foldername(name))[1] = public.get_my_tenant_id()::text
  )
  with check (
    bucket_id = 'field-images'
    and (storage.foldername(name))[1] = public.get_my_tenant_id()::text
  );

-- DELETE: استبدال صورةٍ يحذف القديمة، فلو بقي الحذف ممنوعاً تراكمت الملفّات
-- اليتيمة بصمت — والمستخدم يظنّ أنه استبدل.
drop policy if exists "field_images_tenant_delete" on storage.objects;
create policy "field_images_tenant_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'field-images'
    and (storage.foldername(name))[1] = public.get_my_tenant_id()::text
  );
