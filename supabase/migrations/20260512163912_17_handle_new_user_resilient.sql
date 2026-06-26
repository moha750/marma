-- اجعل handle_new_user مرنا لإنشاء المستخدمين من Supabase Dashboard:
-- إذا لم يكن هناك invite_code ولا tenant_name، نتخطى إنشاء tenant/profile بصمت.
-- هذا يسمح بإنشاء مستخدمين تجريبيين من اللوحة، ولا يكسر signup.html العادي.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_invite_code text;
  v_invitation record;
  v_tenant_id uuid;
  v_full_name text;
  v_tenant_name text;
BEGIN
  v_invite_code := NEW.raw_user_meta_data->>'invite_code';
  v_full_name := NEW.raw_user_meta_data->>'full_name';
  v_tenant_name := NEW.raw_user_meta_data->>'tenant_name';

  -- إذا لم يُرسل invite_code ولا tenant_name (مثل إنشاء من Supabase Dashboard)،
  -- نسمح بإنشاء auth user فقط بدون tenant/profile. التطبيق يتعامل مع غياب الـ profile.
  IF (v_invite_code IS NULL OR v_invite_code = '')
     AND (v_tenant_name IS NULL OR v_tenant_name = '') THEN
    RETURN NEW;
  END IF;

  -- المسار 1: تسجيل بدعوة موظف
  IF v_invite_code IS NOT NULL AND v_invite_code <> '' THEN
    SELECT id, tenant_id, email, full_name, used_at, expires_at
    INTO v_invitation
    FROM public.staff_invitations
    WHERE code = v_invite_code
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'INVITE_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
    IF v_invitation.used_at IS NOT NULL THEN
      RAISE EXCEPTION 'INVITE_ALREADY_USED' USING ERRCODE = 'P0001';
    END IF;
    IF v_invitation.expires_at <= now() THEN
      RAISE EXCEPTION 'INVITE_EXPIRED' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.profiles (id, tenant_id, full_name, role)
    VALUES (NEW.id, v_invitation.tenant_id, v_invitation.full_name, 'staff');

    UPDATE public.staff_invitations SET used_at = now() WHERE id = v_invitation.id;

    RETURN NEW;
  END IF;

  -- المسار 2: مالك جديد (tenant_name مطلوب)
  IF v_full_name IS NULL OR v_full_name = '' THEN
    RAISE EXCEPTION 'FULL_NAME_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.tenants (name, city, phone, trial_ends_at, subscription_status)
  VALUES (
    v_tenant_name,
    NEW.raw_user_meta_data->>'city',
    NEW.raw_user_meta_data->>'phone',
    now() + interval '3 days',
    'trial'
  )
  RETURNING id INTO v_tenant_id;

  INSERT INTO public.profiles (id, tenant_id, full_name, role)
  VALUES (NEW.id, v_tenant_id, v_full_name, 'owner');

  RETURN NEW;
END;
$$;
;