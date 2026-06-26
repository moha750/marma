-- دالة تُستدعى تلقائياً عند تسجيل مستخدم جديد في auth.users
-- تنشئ tenant + profile جديد (إذا مالك)، أو تربط بـ tenant موجود (إذا موظف بدعوة)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

    -- استخدام البريد المخصص للدعوة كبريد للحساب (اختياري - يتحقق المالك من ذلك)
    INSERT INTO public.profiles (id, tenant_id, full_name, role)
    VALUES (NEW.id, v_invitation.tenant_id, v_invitation.full_name, 'staff');

    UPDATE public.staff_invitations
    SET used_at = now()
    WHERE id = v_invitation.id;

    RETURN NEW;
  END IF;

  -- المسار 2: تسجيل مالك جديد (ينشئ tenant جديد)
  v_tenant_name := NEW.raw_user_meta_data->>'tenant_name';

  IF v_tenant_name IS NULL OR v_tenant_name = '' THEN
    RAISE EXCEPTION 'TENANT_NAME_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  IF v_full_name IS NULL OR v_full_name = '' THEN
    RAISE EXCEPTION 'FULL_NAME_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.tenants (name, city, phone)
  VALUES (
    v_tenant_name,
    NEW.raw_user_meta_data->>'city',
    NEW.raw_user_meta_data->>'phone'
  )
  RETURNING id INTO v_tenant_id;

  INSERT INTO public.profiles (id, tenant_id, full_name, role)
  VALUES (NEW.id, v_tenant_id, v_full_name, 'owner');

  RETURN NEW;
END;
$$;

-- ربط الدالة بحدث إنشاء مستخدم جديد
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
;