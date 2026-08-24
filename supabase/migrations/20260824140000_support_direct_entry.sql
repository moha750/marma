-- الخيار الثاني: دخولٌ مباشر بلا موافقة المالك — قرار مالك المنصّة.
--
-- الخيار الأوّل (20260824120000) باقٍ كما هو ولا يُمسّ: طلبٌ يوافق عليه المالك،
-- أو دعوةٌ يفتحها بنفسه. وهذا الملفّ يضيف طريقاً ثالثاً للجلسة نفسها — لا آلةً
-- جديدة: نفس الجدول، نفس support_session_tenant، نفس التريجرات التي تقفل المال
-- والهويّة. المتغيّر الوحيد كيف تبدأ الجلسة، لا ماذا يُسمح فيها.
--
-- ما يفعله الدخول المباشر:
--   · يُفتح فوراً 'active' بيد المشرف وحده — لا إشعار للمالك، ولا شريط على
--     شاشته، ولا موافقة. الجلسة تعمل «كأنه المالك» كما طُلب.
--   · مقصورٌ على المشرف العام (is_super_admin) — كالخيار الأوّل تماماً.
--   · تبقى الأبواب المقفلة مقفلة: الاشتراك والهويّة وحذف الحساب ممنوعة داخله
--     كما في كل جلسة. «كأنه المالك» في التعديل، لا في تملّك الحساب.
--
-- وما لا يفعله — وهذا مقصود ويبقى:
--   · السطر في admin_audit_log لا يُحذف. هو دفتر المنصّة الداخلي: أيّ مشرفٍ
--     دخل، أيّ ملعب، ومتى، وبأي سبب كتبه. لا يراه المالك، ولا يستأذنه، ولا
--     يبطّئ المشرف — لكنه الجواب الوحيد يوم يقول مالكٌ «أنا ما سوّيت هذا».
--     حذفه لا يخدم أحداً: يمحو دفاع المشرف نفسه.
--   · والسبب إلزامي — لا ليُعرَض على أحد، بل ليبقى في الدفتر. جلسةٌ بلا سببٍ
--     مكتوب سطرٌ لا معنى له بعد شهر.

-- origin ثالث: 'direct'
alter table public.support_sessions drop constraint if exists support_sessions_origin_check;
alter table public.support_sessions add constraint support_sessions_origin_check
  check (origin in ('member_request', 'support_request', 'direct'));


-- الفتح المباشر — 'active' من أوّل لحظة، بلا إشعارٍ ولا انتظار.
create or replace function public.admin_direct_support_session(p_tenant_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_reason text;
begin
  if not public.is_super_admin() then
    raise exception 'NOT_SUPER_ADMIN' using errcode = 'P0001';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if length(v_reason) < 3 then
    raise exception 'SUPPORT_REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'TENANT_NOT_FOUND' using errcode = 'P0001';
  end if;

  perform public.support_session_sweep(p_tenant_id);

  insert into public.support_sessions(
    tenant_id, actor_id, origin, requested_by, reason,
    status, approved_at, approved_by, expires_at)
  values (p_tenant_id, auth.uid(), 'direct', auth.uid(), v_reason,
          'active', now(), auth.uid(), now() + interval '30 minutes')
  returning id into v_id;

  -- الدفتر الداخلي: لا إشعار للمالك، لكن السطر يبقى — باسم المشرف الداخل.
  insert into public.admin_audit_log(actor_id, action, tenant_id, details)
  values (auth.uid(), 'support_start', p_tenant_id,
          jsonb_build_object('session_id', v_id, 'origin', 'direct', 'reason', v_reason));

  return v_id;
exception when unique_violation then
  raise exception 'SUPPORT_SESSION_EXISTS' using errcode = 'P0001';
end $$;

revoke all on function public.admin_direct_support_session(uuid, text) from public, anon;
grant execute on function public.admin_direct_support_session(uuid, text) to authenticated;


-- الإنهاء: الجلسة المباشرة لا شريط للمالك يُنهى، فلا إشعار إنهاءٍ يصله عمّا لم
-- يعلم به. والسطر في الدفتر يبقى في الحالتين. غير ذلك السلوك واحد.
create or replace function public.support_session_end(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_row public.support_sessions; v_tenant uuid; v_by text; v_mins int;
begin
  select * into v_row from public.support_sessions where id = p_id for update;
  if not found then raise exception 'SUPPORT_SESSION_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_row.status not in ('invited', 'pending', 'active') then return; end if;

  select tenant_id into v_tenant from public.profiles where id = auth.uid();
  if v_tenant = v_row.tenant_id then
    v_by := 'owner';
  elsif v_row.actor_id = auth.uid() and public.is_super_admin() then
    v_by := 'support';
  else
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  update public.support_sessions
     set status = 'ended', ended_at = now(), ended_by = v_by
   where id = p_id;

  if v_row.status = 'active' then
    v_mins := greatest(1, ceil(extract(epoch from (now() - v_row.approved_at)) / 60)::int);
    -- الجلسة المباشرة لا يعرف بها المالك، فإشعار إنهائها يفتح باباً لسؤالٍ عن
    -- بابٍ لم يُطرق. أمّا جلسة الإذن فإشعار إنهائها جزءٌ من الشفافية التي وعدنا.
    if v_row.origin <> 'direct' then
      insert into public.notifications(audience, tenant_id, type, title, body, link, data)
      values ('owner', v_row.tenant_id, 'support_session', 'انتهت جلسة الدعم',
              'استمرّت ' || v_mins || ' دقيقة — وكل ما جرى فيها مسجّل باسم الدعم',
              '/dashboard', jsonb_build_object('session_id', p_id, 'status', 'ended'));
    end if;
    insert into public.admin_audit_log(actor_id, action, tenant_id, details)
    values (v_row.actor_id, 'support_end', v_row.tenant_id,
            jsonb_build_object('session_id', p_id, 'minutes', v_mins,
                               'ended_by', v_by, 'origin', v_row.origin));
  end if;
end $$;

revoke all on function public.support_session_end(uuid) from public, anon;
grant execute on function public.support_session_end(uuid) to authenticated;


-- ما تقرؤه الواجهة: الجلسة المباشرة يراها المشرف الداخل (ليعرف أنه في حساب
-- غيره، ولينهيها) — ولا يراها المالك أبداً. هذا هو معنى «كأنه المالك»: لا شريط
-- على شاشة المالك. فرع المالك يستثني 'direct' صراحةً.
create or replace function public.support_session_current()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.support_sessions; v_tenant uuid; v_admin boolean; v_name text;
begin
  if auth.uid() is null then return null; end if;
  v_admin := public.is_super_admin();
  select tenant_id into v_tenant from public.profiles where id = auth.uid();

  perform public.support_session_sweep(v_tenant);

  -- المشرف داخل جلسة يراها أوّلاً (بما فيها المباشرة): هو في حساب غيره الآن
  if v_admin then
    select * into v_row from public.support_sessions
     where actor_id = auth.uid() and status = 'active' and expires_at > now()
     order by approved_at desc limit 1;
  end if;

  -- فرع المالك/الموظّف: الجلسة المباشرة محجوبة عنه — لا شريط ولا أثر
  if v_row.id is null and v_tenant is not null then
    select * into v_row from public.support_sessions
     where tenant_id = v_tenant and status in ('invited', 'pending', 'active')
       and origin <> 'direct'
       and expires_at > now()
     order by requested_at desc limit 1;
  end if;

  if v_row.id is null then return null; end if;

  select name into v_name from public.tenants where id = v_row.tenant_id;
  return jsonb_build_object(
    'id', v_row.id,
    'tenant_id', v_row.tenant_id,
    'tenant_name', v_name,
    'status', v_row.status,
    'origin', v_row.origin,
    'reason', v_row.reason,
    'expires_at', v_row.expires_at,
    'approved_at', v_row.approved_at,
    'viewer', case when v_admin and v_row.actor_id = auth.uid() and v_row.status = 'active'
                   then 'support' else 'member' end,
    'can_respond', (v_row.status = 'pending' and exists (
       select 1 from public.profiles
        where id = auth.uid() and role = 'owner' and tenant_id = v_row.tenant_id))
  );
end $$;

revoke all on function public.support_session_current() from public, anon;
grant execute on function public.support_session_current() to authenticated;


-- الطريق المسدود الوحيد الذي يفتحه الحجب: المالك لا يرى الجلسة المباشرة، فلو
-- ضغط «ساعدني» والدعم داخلٌ فعلاً، ارتطم بـ«يوجد طلب أو جلسة مفتوحة — أنهِها
-- أولاً» — أمرٌ بإنهاء ما لا يراه. والدعم في حسابه الآن يصلح ما اتّصل بشأنه،
-- فدعوته تحصيل حاصل: نُرجع الجلسة القائمة بلا ضجّة وبلا كشف. الجسد كما هو،
-- والتغيير في مقبض الخطأ وحده.
create or replace function public.request_support_help(p_reason text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid; v_id uuid; v_name text; v_tname text; v_title text; v_body text;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  -- الدعم داخل جلسة لا يدعو نفسه إلى جلسة أخرى
  if public.support_session_tenant() is not null then
    raise exception 'SUPPORT_FORBIDDEN' using errcode = 'P0001';
  end if;

  select tenant_id, full_name into v_tenant, v_name
    from public.profiles where id = auth.uid();
  if v_tenant is null then raise exception 'NO_TENANT' using errcode = 'P0001'; end if;

  perform public.support_session_sweep(v_tenant);

  insert into public.support_sessions(tenant_id, origin, requested_by, reason, status, expires_at)
  values (v_tenant, 'member_request', auth.uid(), nullif(btrim(coalesce(p_reason, '')), ''),
          'invited', now() + interval '2 hours')
  returning id into v_id;

  v_title := 'طلب مساعدة من الدعم';
  v_body  := coalesce(v_name, 'أحد أعضاء الفريق') || ' فتح الباب للدعم ليعدّل نيابةً — بإمكانك إلغاؤه';
  insert into public.notifications(audience, tenant_id, type, title, body, link, data)
  values ('owner', v_tenant, 'support_session', v_title, v_body, '/dashboard',
          jsonb_build_object('session_id', v_id, 'status', 'invited'));
  perform public.push_owner(v_tenant, v_title, v_body, '/dashboard', 'support-' || v_id::text);

  select name into v_tname from public.tenants where id = v_tenant;
  insert into public.notifications(audience, tenant_id, type, title, body, link, data)
  values ('admin', v_tenant, 'support_session', 'ملعب يطلب المساعدة',
          coalesce(v_tname, 'ملعب') || ' فتح لك الباب — ادخل وأصلح له',
          '/admin/tenants/' || v_tenant::text,
          jsonb_build_object('session_id', v_id, 'status', 'invited'));

  return v_id;
exception when unique_violation then
  select id into v_id from public.support_sessions
   where tenant_id = v_tenant and origin = 'direct'
     and status = 'active' and expires_at > now();
  if v_id is not null then return v_id; end if;
  raise exception 'SUPPORT_SESSION_EXISTS' using errcode = 'P0001';
end $$;

revoke all on function public.request_support_help(text) from public, anon;
grant execute on function public.request_support_help(text) to authenticated;
