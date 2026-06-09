-- لوحة المشرف: إدارة المشرفين العامّين (app_admins) — محميّة بـ is_super_admin

CREATE OR REPLACE FUNCTION public.admin_list_admins()
 RETURNS TABLE(user_id uuid, email text, name text, created_at timestamptz)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'NOT_SUPER_ADMIN' USING ERRCODE = 'P0001'; END IF;
  RETURN QUERY
    SELECT a.user_id, au.email::text, (au.raw_user_meta_data->>'display_name')::text, a.created_at
    FROM public.app_admins a JOIN auth.users au ON au.id = a.user_id
    ORDER BY a.created_at;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_add_admin(p_email text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'NOT_SUPER_ADMIN' USING ERRCODE = 'P0001'; END IF;
  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = lower(btrim(p_email)) LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'لا يوجد مستخدم مسجّل بهذا البريد (يجب أن يملك حساباً أولاً)' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.app_admins(user_id, created_at)
  SELECT v_uid, now()
  WHERE NOT EXISTS (SELECT 1 FROM public.app_admins WHERE user_id = v_uid);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_remove_admin(p_user_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_cnt int;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'NOT_SUPER_ADMIN' USING ERRCODE = 'P0001'; END IF;
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'لا يمكنك إزالة نفسك' USING ERRCODE = 'P0001'; END IF;
  SELECT count(*) INTO v_cnt FROM public.app_admins;
  IF v_cnt <= 1 THEN RAISE EXCEPTION 'لا يمكن إزالة آخر مشرف' USING ERRCODE = 'P0001'; END IF;
  DELETE FROM public.app_admins WHERE user_id = p_user_id;
END;
$function$;
