
-- Trigger: منع إضافة/تفعيل أرضية إذا تجاوزت الحد المسموح
CREATE OR REPLACE FUNCTION public.enforce_field_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed int;
  v_current int;
BEGIN
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.is_active AND NOT OLD.is_active) THEN
    SELECT allowed_fields INTO v_allowed
    FROM public.tenants WHERE id = NEW.tenant_id;
    IF v_allowed IS NULL THEN
      RETURN NEW;
    END IF;
    SELECT count(*) INTO v_current
    FROM public.fields
    WHERE tenant_id = NEW.tenant_id
      AND is_active
      AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
    IF v_current >= v_allowed THEN
      RAISE EXCEPTION 'FIELD_LIMIT_REACHED' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_field_limit ON public.fields;
CREATE TRIGGER trg_enforce_field_limit
  BEFORE INSERT OR UPDATE OF is_active ON public.fields
  FOR EACH ROW EXECUTE FUNCTION public.enforce_field_limit();


-- Trigger: منع إنشاء دعوة موظف إذا (موظفين حاليين + دعوات معلّقة) >= الحد
CREATE OR REPLACE FUNCTION public.enforce_staff_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed int;
  v_current_staff int;
  v_pending_invites int;
BEGIN
  SELECT allowed_staff INTO v_allowed
  FROM public.tenants WHERE id = NEW.tenant_id;
  IF v_allowed IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO v_current_staff
  FROM public.profiles
  WHERE tenant_id = NEW.tenant_id AND role = 'staff';
  SELECT count(*) INTO v_pending_invites
  FROM public.staff_invitations
  WHERE tenant_id = NEW.tenant_id
    AND used_at IS NULL
    AND expires_at > now()
    AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
  IF v_current_staff + v_pending_invites >= v_allowed THEN
    RAISE EXCEPTION 'STAFF_LIMIT_REACHED' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_staff_limit ON public.staff_invitations;
CREATE TRIGGER trg_enforce_staff_limit
  BEFORE INSERT ON public.staff_invitations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_staff_limit();
;