-- تشديد صيغة جوّال المالك على مستوى قاعدة البيانات: 05XXXXXXXX بالضبط (10 أرقام).
-- (1) قيد CHECK كضمان نهائي لأي مسار كتابة.
--     NOT VALID: يفرض الصيغة على الصفوف الجديدة/المحدّثة دون فحص بيانات اختبار قديمة.
alter table public.profiles
  drop constraint if exists profiles_phone_saudi_format;
alter table public.profiles
  add constraint profiles_phone_saudi_format
  check (phone is null or phone ~ '^05[0-9]{8}$') not valid;

-- (2) تحديث الدالة لتفرض نفس الصيغة برسالة INVALID_PHONE واضحة.
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
  values (v_name, now() + interval '3 days', 'trial')
  returning id into v_tenant_id;

  insert into public.profiles (id, tenant_id, full_name, role, phone)
  values (v_user_id, v_tenant_id, coalesce(v_full_name, 'مالك'), 'owner', v_phone);

  return v_tenant_id;
end;
$function$;
