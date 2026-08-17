-- التجربة المجانية: ٣ أيام → ٧ أيام (أسبوع كامل).
-- تغيير واحد فقط داخل create_owner_tenant — بقية الدالة كما هي من
-- 20260704035402_enforce_saudi_owner_phone.sql (فرض صيغة الجوّال السعودي).
--
-- ملاحظات:
--   • يسري على الحسابات الجديدة فقط؛ التجارب الجارية تحتفظ بتاريخ انتهائها.
--     لتمديد الجارية: admin_extend_trial، أو update مباشر على trial_ends_at.
--   • send_subscription_warnings لا تحتاج تعديلًا — تذكيراتها نسبية إلى
--     trial_ends_at (٣ أيام / يوم / ساعة قبل الانتهاء) لا إلى طول التجربة.
--   • فترة السماح تبقى يومًا واحدًا (20260703064509_grace_period_1_day.sql).

create or replace function public.create_owner_tenant(p_name text, p_phone text default null)
 returns uuid
 language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_user_id   uuid := auth.uid();
  v_name      text := btrim(coalesce(p_name, ''));
  v_phone     text := btrim(coalesce(p_phone, ''));
  v_full_name text;
  v_tenant_id uuid;
begin
  if v_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if v_name = '' then raise exception 'TENANT_NAME_REQUIRED' using errcode = 'P0001'; end if;
  if v_phone = '' then raise exception 'PHONE_REQUIRED' using errcode = 'P0001'; end if;
  -- صيغة الجوّال السعودي: 05 ثم 8 أرقام
  if v_phone !~ '^05[0-9]{8}$' then raise exception 'INVALID_PHONE' using errcode = 'P0001'; end if;

  -- منشأة واحدة لكل مالك — إن كان له profile مسبقًا فقد أُعِدّ من قبل
  if exists (select 1 from public.profiles where id = v_user_id) then
    raise exception 'ALREADY_ONBOARDED' using errcode = 'P0001';
  end if;

  -- الاسم الكامل من ميتاداتا المستخدم (بريد أو OAuth)، مع سقوط لطيف
  select coalesce(
           nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
           nullif(btrim(u.raw_user_meta_data->>'name'), ''),
           nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
           'مالك'
         )
    into v_full_name
  from auth.users u where u.id = v_user_id;

  insert into public.tenants (name, trial_ends_at, subscription_status)
  values (v_name, now() + interval '7 days', 'trial')
  returning id into v_tenant_id;

  insert into public.profiles (id, tenant_id, full_name, role, phone)
  values (v_user_id, v_tenant_id, coalesce(v_full_name, 'مالك'), 'owner', v_phone);

  return v_tenant_id;
end;
$function$;
