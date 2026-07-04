-- إعداد المالك الجديد: يُنشئ منشأته (تجربة 3 أيام) + profile owner باسم يختاره.
-- يُستدعى من شاشة الإعداد بعد تسجيل الدخول (بريد أو OAuth) لمن لا يملك منشأة بعد.
-- حارس: منشأة واحدة لكل مالك (ALREADY_ONBOARDED).
create or replace function public.create_owner_tenant(p_name text)
 returns uuid
 language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_user_id   uuid := auth.uid();
  v_name      text := btrim(coalesce(p_name, ''));
  v_full_name text;
  v_tenant_id uuid;
begin
  if v_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if v_name = '' then raise exception 'TENANT_NAME_REQUIRED' using errcode = 'P0001'; end if;

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

  insert into public.profiles (id, tenant_id, full_name, role)
  values (v_user_id, v_tenant_id, coalesce(v_full_name, 'مالك'), 'owner');

  return v_tenant_id;
end;
$function$;
