-- ميزة «الأجهزة المسجّلة دخول بالحساب»
-- دالتا RPC تتيحان للمستخدم رؤية جلساته (auth.sessions) وإنهاء أيّ جهاز آخر.
-- كلتاهما SECURITY DEFINER بفلترة صارمة على auth.uid() ومقصورتان على authenticated.

-- ─── قائمة جلسات المستخدم الحالي ───────────────────────────────
CREATE OR REPLACE FUNCTION public.list_my_sessions()
RETURNS TABLE (
  id          uuid,
  created_at  timestamptz,
  last_seen   timestamptz,
  user_agent  text,
  ip          text,
  is_current  boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT
    s.id,
    s.created_at,
    COALESCE(s.refreshed_at::timestamptz, s.updated_at, s.created_at) AS last_seen,
    s.user_agent,
    host(s.ip) AS ip,
    s.id = NULLIF(auth.jwt() ->> 'session_id', '')::uuid AS is_current
  FROM auth.sessions s
  WHERE s.user_id = auth.uid()           -- anon → auth.uid() NULL → لا صفوف
  ORDER BY
    (s.id = NULLIF(auth.jwt() ->> 'session_id', '')::uuid) DESC,
    COALESCE(s.refreshed_at::timestamptz, s.updated_at, s.created_at) DESC;
$function$;

-- ─── إنهاء جلسة جهاز آخر يخصّ المستخدم نفسه ────────────────────
CREATE OR REPLACE FUNCTION public.revoke_my_session(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_current uuid := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'غير مصرّح' USING ERRCODE = 'P0001';
  END IF;
  IF p_session_id = v_current THEN
    RAISE EXCEPTION 'لا يمكن إنهاء الجلسة الحالية من هنا — استخدم تسجيل الخروج' USING ERRCODE = 'P0001';
  END IF;
  -- الحذف يتتالى على auth.refresh_tokens فيخرج الجهاز عند أول تحديث للرمز
  DELETE FROM auth.sessions
  WHERE id = p_session_id AND user_id = v_uid;
END;
$function$;

-- صلاحيات: للمستخدمين المسجّلين فقط (دفاع عميق: نزع التنفيذ من public و anon —
-- Supabase يمنح anon تنفيذًا افتراضيًا صريحًا على دوال public، فلا يكفي REVOKE من public).
REVOKE ALL     ON FUNCTION public.list_my_sessions()       FROM public;
REVOKE ALL     ON FUNCTION public.revoke_my_session(uuid)  FROM public;
REVOKE EXECUTE ON FUNCTION public.list_my_sessions()       FROM anon;
REVOKE EXECUTE ON FUNCTION public.revoke_my_session(uuid)  FROM anon;
GRANT EXECUTE  ON FUNCTION public.list_my_sessions()       TO authenticated;
GRANT EXECUTE  ON FUNCTION public.revoke_my_session(uuid)  TO authenticated;
