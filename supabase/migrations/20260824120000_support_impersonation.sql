-- «الدخول نيابةً» — الدعم يعدّل في حساب المالك بإذنه، لا بدلاً عنه.
--
-- المشكلة التي وُلدت منها: مالكٌ في بلدٍ آخر لا يعرف كيف يعدّل وقتاً أو يرفق
-- صورة. الشرح المكتوب لا يُقرأ، والمكالمة تنتهي بـ«ما لقيت الزر»، والذهاب إليه
-- مستحيل. فالحلّ أن نفعلها له وهو ينظر — لا أن نصفها له.
--
-- والخطر واضح: بابٌ يدخل منه المشغّل إلى حساب أي عميل هو بابٌ خلفي مهما حسُنت
-- النيّة. فالتصميم كلّه قائم على أربعة قيود لا يعمل بدونها:
--
--   ١) لا جلسة بلا إذنٍ حيّ. إمّا المالك دعا («ساعدني»)، وإمّا الدعم طلب
--      والمالك وافق من جوّاله. لا طريق ثالث — ولا صلاحية دائمة أبداً.
--   ٢) نافذة تنتهي وحدها (٣٠ دقيقة). الانتهاء ليس وظيفةً مجدولة تُنسى: كل
--      قراءة تسأل expires_at، فالجلسة تموت بمرور الوقت لا بتنفيذ أحد.
--   ٣) سكّينٌ بيد المالك. صفٌّ واحد يقلبه إلى 'ended' فينقطع الوصول في نفس
--      اللحظة — وشريطٌ ظاهر على شاشته طوال الجلسة يذكّره أن السكّين بيده.
--   ٤) بابٌ مقفل على المال والهوية. الاشتراك، وجوّال المالك، وحذف الحساب:
--      ممنوعة داخل الجلسة بتريجرات في القاعدة لا بإخفاءٍ في الواجهة. النيابة
--      لتعديل وقتٍ ورفع صورة، لا لتملّك الحساب.
--
-- ═══ لماذا get_my_tenant_id هو موضع الغرس؟ ═══════════════════════════════
-- لأن كل سياسة RLS في هذا المشروع تنتهي إليها: `tenant_id = get_my_tenant_id()`
-- مكتوبةٌ في عشرات السياسات. فتعديلها في مكانٍ واحد يجعل الجلسة تُطبَّق على كل
-- جدولٍ حاضرٍ وكل جدولٍ يُضاف غداً — بلا سياسة إضافية واحدة. والبديل (سياسة
-- «أو الدعم» تُلحق بكل جدول) يعني أن أوّل جدولٍ يُنسى ثغرةٌ صامتة.
--
-- والاتجاه المعاكس مقصود كذلك: ما لا تكشفه السياسات للمالك لا تكشفه للدعم.
-- الدعم يرث صلاحية المالك، لا يعلوها.

-- ═══ ١) الجلسة ═════════════════════════════════════════════════════════
create table if not exists public.support_sessions (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,

  -- المشرف صاحب الجلسة. يبقى null في الدعوة حتى يلتقطها مشرفٌ بعينه: الدعوة
  -- تُفتح للدعم كجهة، والجلسة تُنسب لشخص.
  actor_id      uuid references auth.users(id) on delete cascade,

  -- 'member_request' = المالك (أو موظّفه) دعا  ·  'support_request' = الدعم طلب
  origin        text not null check (origin in ('member_request', 'support_request')),
  requested_by  uuid references auth.users(id) on delete set null,

  -- سببٌ إلزامي على طلب الدعم. يقرؤه المالك قبل أن يوافق، ويبقى في السجلّ بعدها
  -- — على سنّة loyalty_adjust_requires_reason: ما يمسّ حساب غيرك يُعلَّل.
  reason        text,

  status        text not null default 'pending'
                check (status in ('invited', 'pending', 'active', 'ended', 'denied', 'expired')),

  requested_at  timestamptz not null default now(),
  approved_at   timestamptz,
  approved_by   uuid references auth.users(id) on delete set null,
  ended_at      timestamptz,
  ended_by      text check (ended_by in ('owner', 'support', 'expiry')),

  -- في الدعوة: متى تسقط الدعوة. وفي الجلسة: متى ينقطع الوصول.
  expires_at    timestamptz not null
);

-- جلسةٌ حيّة واحدة لكل ملعب. جلستان متوازيتان تعنيان شريطين متناقضين على شاشة
-- المالك، و«أنهِ الآن» لا يعرف أيّهما يُنهي.
create unique index if not exists support_sessions_one_live
  on public.support_sessions(tenant_id)
  where status in ('invited', 'pending', 'active');

create index if not exists support_sessions_actor_live
  on public.support_sessions(actor_id, expires_at desc)
  where status = 'active';

create index if not exists support_sessions_tenant_recent
  on public.support_sessions(tenant_id, requested_at desc);

alter table public.support_sessions enable row level security;

-- القراءة فقط عبر السياسة؛ وكل تحويلٍ للحالة يمرّ بدالّة. لا سياسة كتابة واحدة:
-- من يكتب في هذا الجدول مباشرةً يمنح نفسه الوصول.
drop policy if exists support_sessions_read on public.support_sessions;
create policy support_sessions_read on public.support_sessions
  for select to authenticated
  using (
    tenant_id = public.get_my_tenant_id()   -- أهل الملعب (والدعم داخل جلسته)
    or actor_id = auth.uid()                -- المشرف يرى جلساته
    or public.is_super_admin()
  );

-- الشريط الحيّ يعتمد على وصول التغيير لا على استجواب دوري
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'support_sessions'
  ) then
    alter publication supabase_realtime add table public.support_sessions;
  end if;
end $$;


-- ═══ ٢) الجلسة الحيّة ══════════════════════════════════════════════════
-- قلب الميزة كلّها. ثلاثة شروط مجتمعة، وسقوط أيّها يُنهي الوصول فوراً:
--   status = 'active'  ·  expires_at > now()  ·  والفاعل مشرفٌ عام الآن
-- الشرط الثالث ليس تزيّداً: مشرفٌ نُزعت صلاحيته وله جلسة مفتوحة كان سيبقى داخل
-- الحساب حتى تنتهي نافذته. نزع الصلاحية يجب أن يُغلق الباب في نفس اللحظة.
create or replace function public.support_session_tenant()
returns uuid language sql stable security definer set search_path = public as $$
  select s.tenant_id
    from public.support_sessions s
   where s.actor_id = auth.uid()
     and s.status = 'active'
     and s.expires_at > now()
     and exists (select 1 from public.app_admins a where a.user_id = auth.uid())
   order by s.approved_at desc nulls last
   limit 1
$$;

revoke all on function public.support_session_tenant() from public, anon;
grant execute on function public.support_session_tenant() to authenticated;


-- ═══ ٣) الغرس ═════════════════════════════════════════════════════════
-- جلسة الدعم تسبق صفّ profiles لا تُضاف إليه: المشرف لا صفّ له أصلاً (بالتصميم:
-- المشرف ليس مالك ملعب)، والمالك الذي يشرف — إن وُجد — فتحَ الجلسة بنفسه فقصدَ
-- الوجهة الأخرى. و«العودة لحسابي» تكون بإنهاء الجلسة، وهي ضغطة واحدة.
create or replace function public.get_my_tenant_id()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    public.support_session_tenant(),
    (select tenant_id from public.profiles where id = auth.uid())
  )
$$;

revoke all on function public.get_my_tenant_id() from public, anon;
grant execute on function public.get_my_tenant_id() to authenticated;

-- والدعم يعمل بيد المالك: صفحات «ملاعبي» و«الجدول» و«الإعدادات» كلّها ownerOnly،
-- وهي بالضبط ما جاء الدعم ليصلحه. فبدون هذا السطر تبقى الميزة بلا موضوع.
create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select public.support_session_tenant() is not null
      or exists (
           select 1 from public.profiles
            where id = auth.uid() and role = 'owner'
         )
$$;

revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;


-- ═══ ٤) الأبواب المقفلة ════════════════════════════════════════════════
-- ما يُمنع على الدعم داخل الجلسة ليس ما «قد يُخطئ فيه» بل ما لا يملك أحدٌ أن
-- يأذن به نيابةً: المال، والهوية، وحياة الحساب. مالكٌ وافق على «ساعدني أعدّل
-- الوقت» لم يوافق على أن يُشترى باسمه أو يُبدَّل جوّاله.
--
-- والمنع في القاعدة لا في الواجهة: إخفاء الزرّ يحمي من الخطأ لا من التجاوز.
create or replace function public.support_blocked()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.support_session_tenant() is not null then
    raise exception 'SUPPORT_FORBIDDEN' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;

-- الاشتراكات: طلبٌ أو مراجعةٌ باسم المالك = مالٌ يُلتزم به نيابةً عنه.
drop trigger if exists support_blocked_subscriptions on public.subscriptions;
create trigger support_blocked_subscriptions
  before insert or update or delete on public.subscriptions
  for each row execute function public.support_blocked();

-- العضويات: الدور والجوّال هما الهوية. من يملك تغييرهما يملك الحساب —
-- والحذف يُخرج المالك من ملعبه.
drop trigger if exists support_blocked_profiles on public.profiles;
create trigger support_blocked_profiles
  before update or delete on public.profiles
  for each row execute function public.support_blocked();

-- المنشأة: الاسم والشعار والوصف مفتوحة للدعم (هي عمله)، وأعمدة الاشتراك
-- والإيقاف مقفلة. والمشرف يملكها من لوحته بدوالّ definer لا من هنا.
create or replace function public.support_blocked_tenant_cols()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.support_session_tenant() is null then return new; end if;
  if new.subscription_status  is distinct from old.subscription_status
     or new.subscription_ends_at is distinct from old.subscription_ends_at
     or new.trial_ends_at        is distinct from old.trial_ends_at
     or new.suspended            is distinct from old.suspended
     or new.allowed_fields       is distinct from old.allowed_fields
     or new.allowed_staff        is distinct from old.allowed_staff then
    raise exception 'SUPPORT_FORBIDDEN' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists support_blocked_tenants on public.tenants;
create trigger support_blocked_tenants
  before update on public.tenants
  for each row execute function public.support_blocked_tenant_cols();


-- كنس ما سقط بالتقادم. لا وظيفة مجدولة: الوصول محسومٌ بـ expires_at في
-- support_session_tenant، وهذا الكنس تجميلٌ للحالة المعروضة فقط — يجري عند كل
-- قراءةٍ أو طلبٍ جديد، فالفهرس الفريد لا تعوقه جثّةُ جلسةٍ ماتت أمس.
create or replace function public.support_session_sweep(p_tenant_id uuid default null)
returns void language sql security definer set search_path = public as $$
  update public.support_sessions
     set status = 'expired', ended_at = coalesce(ended_at, now()),
         ended_by = coalesce(ended_by, 'expiry')
   where status in ('invited', 'pending', 'active')
     and expires_at <= now()
     and (p_tenant_id is null or tenant_id = p_tenant_id);
$$;

revoke all on function public.support_session_sweep(uuid) from public, anon;
grant execute on function public.support_session_sweep(uuid) to authenticated;


-- ═══ ٥) فتح الجلسة — طريقان، ولا ثالث ══════════════════════════════════

-- (أ) المالك يدعو: الضغطة نفسها هي الإذن. لا موافقة ثانية بعدها — من طلب
--     المساعدة لا يُسأل «أتأذن؟».
--
-- وللموظّف أن يدعو أيضاً: هو من يقف عند الكاونتر وهو من يتعثّر. لكنّ المالك
-- يُخطَر في نفس اللحظة (سطرٌ وإشعارٌ على جوّاله) وبيده أن يُلغي قبل أن يلتقطها
-- أحد — فالوكالة للموظّف، والفيتو للمالك.
--
-- ساعتان صلاحيةً للدعوة: المالك يكتب طلبه ثم ينام، ونحن في منطقةٍ زمنية أخرى.
-- أقلّ من ذلك يعني دعوةً تسقط قبل أن نراها.
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

  -- والدعوة لا تنفع إن لم يعلم بها أحد. سطرٌ لجرس اللوحة: بابٌ فُتح ولا أحد
  -- خلفه أسوأ من باب مغلق — المالك ينتظر وقد فعل ما طُلب منه.
  select name into v_tname from public.tenants where id = v_tenant;
  insert into public.notifications(audience, tenant_id, type, title, body, link, data)
  values ('admin', v_tenant, 'support_session', 'ملعب يطلب المساعدة',
          coalesce(v_tname, 'ملعب') || ' فتح لك الباب — ادخل وأصلح له',
          '/admin/tenants/' || v_tenant::text,
          jsonb_build_object('session_id', v_id, 'status', 'invited'));

  return v_id;
exception when unique_violation then
  raise exception 'SUPPORT_SESSION_EXISTS' using errcode = 'P0001';
end $$;

revoke all on function public.request_support_help(text) from public, anon;
grant execute on function public.request_support_help(text) to authenticated;


-- (ب) الدعم يطلب: لا يفتح شيئاً — يقرع الباب. الصفّ يولد 'pending'، والوصول
--     معدوم حتى يضغط المالك «موافق» على جوّاله.
create or replace function public.admin_request_support_session(p_tenant_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_reason text; v_title text; v_body text;
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

  insert into public.support_sessions(tenant_id, actor_id, origin, requested_by, reason, status, expires_at)
  values (p_tenant_id, auth.uid(), 'support_request', auth.uid(), v_reason,
          'pending', now() + interval '2 hours')
  returning id into v_id;

  v_title := 'الدعم يطلب الدخول لحسابك';
  v_body  := v_reason || ' — وافق ليعدّل نيابةً عنك، أو ارفض';
  insert into public.notifications(audience, tenant_id, type, title, body, link, data)
  values ('owner', p_tenant_id, 'support_session', v_title, v_body, '/dashboard',
          jsonb_build_object('session_id', v_id, 'status', 'pending'));
  perform public.push_owner(p_tenant_id, v_title, v_body, '/dashboard', 'support-' || v_id::text);

  perform public.admin_log_action('support_request', p_tenant_id,
    jsonb_build_object('session_id', v_id, 'reason', v_reason));
  return v_id;
exception when unique_violation then
  raise exception 'SUPPORT_SESSION_EXISTS' using errcode = 'P0001';
end $$;

revoke all on function public.admin_request_support_session(uuid, text) from public, anon;
grant execute on function public.admin_request_support_session(uuid, text) to authenticated;


-- ═══ ٦) التفعيل ════════════════════════════════════════════════════════
-- نصف ساعة، والنافذة تبدأ من لحظة التفعيل لا من لحظة الطلب. ولا تمديد: من
-- احتاج وقتاً أطول يطلب جلسةً جديدة ويوافق المالك مرّة أخرى. جلسةٌ تُمدَّد بضغطة
-- من الدعم وحده تعود بنا إلى الصلاحية الدائمة من الباب الخلفي.
create or replace function public.support_session_activate(p_id uuid, p_by uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_row public.support_sessions; v_tname text;
begin
  update public.support_sessions
     set status = 'active', approved_at = now(), approved_by = p_by,
         expires_at = now() + interval '30 minutes'
   where id = p_id
  returning * into v_row;

  insert into public.notifications(audience, tenant_id, type, title, body, link, data)
  values ('owner', v_row.tenant_id, 'support_session', 'الدعم يعدّل في حسابك الآن',
          'الجلسة تنتهي تلقائياً بعد 30 دقيقة — وبإمكانك إنهاؤها متى شئت',
          '/dashboard', jsonb_build_object('session_id', p_id, 'status', 'active'));

  select name into v_tname from public.tenants where id = v_row.tenant_id;
  insert into public.notifications(audience, tenant_id, type, title, body, link, data)
  values ('admin', v_row.tenant_id, 'support_session', 'فُتحت جلسة النيابة',
          coalesce(v_tname, 'ملعب') || ' — أمامك 30 دقيقة',
          '/admin/tenants/' || v_row.tenant_id::text,
          jsonb_build_object('session_id', p_id, 'status', 'active'));

  -- الفاعل هو المشرف صاحب الجلسة، لا من ضغط زرّ الموافقة: حين يوافق المالك
  -- على طلب الدعم يكون auth.uid() هو المالك — وadmin_log_action تقرأ منه،
  -- فكان السجلّ ينسب دخول الدعم إلى المالك نفسه. والسؤال الذي يُسأل لهذا السطر
  -- بعد شهر هو «أيّ مشرفٍ دخل هذا الحساب؟».
  insert into public.admin_audit_log(actor_id, action, tenant_id, details)
  values (v_row.actor_id, 'support_start', v_row.tenant_id,
          jsonb_build_object('session_id', p_id, 'origin', v_row.origin,
                             'reason', v_row.reason, 'approved_by', p_by));
end $$;

revoke all on function public.support_session_activate(uuid, uuid) from public, anon, authenticated;


-- المالك يحسم طلب الدعم. المالك وحده — الموظّف يدعو ولا يأذن: الحساب ليس حسابه.
create or replace function public.support_session_respond(p_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_row public.support_sessions; v_tenant uuid;
begin
  select tenant_id into v_tenant from public.profiles
   where id = auth.uid() and role = 'owner';
  if v_tenant is null then raise exception 'NOT_OWNER' using errcode = 'P0001'; end if;

  select * into v_row from public.support_sessions
   where id = p_id and tenant_id = v_tenant for update;
  if not found then raise exception 'SUPPORT_SESSION_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_row.status <> 'pending' then
    raise exception 'SUPPORT_SESSION_NOT_PENDING' using errcode = 'P0001';
  end if;
  if v_row.expires_at <= now() then
    update public.support_sessions set status = 'expired' where id = p_id;
    raise exception 'SUPPORT_SESSION_EXPIRED' using errcode = 'P0001';
  end if;

  if p_approve then
    perform public.support_session_activate(p_id, auth.uid());
  else
    update public.support_sessions
       set status = 'denied', ended_at = now(), ended_by = 'owner' where id = p_id;
    insert into public.notifications(audience, tenant_id, type, title, body, link, data)
    values ('admin', v_tenant, 'support_session', 'رُفض طلب النيابة',
            'المالك رفض الدخول — راسِله قبل أن تعيد الطلب',
            '/admin/tenants/' || v_tenant::text,
            jsonb_build_object('session_id', p_id, 'status', 'denied'));
    insert into public.admin_audit_log(actor_id, action, tenant_id, details)
    values (v_row.actor_id, 'support_denied', v_tenant,
            jsonb_build_object('session_id', p_id, 'reason', v_row.reason));
  end if;
end $$;

revoke all on function public.support_session_respond(uuid, boolean) from public, anon;
grant execute on function public.support_session_respond(uuid, boolean) to authenticated;


-- الدعم يلتقط دعوة المالك. الالتقاط ينسب الجلسة لمشرفٍ بعينه — فما يُفعل فيها
-- يُقرأ باسمه في السجلّ، لا باسم «الدعم».
create or replace function public.admin_claim_support_session(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_row public.support_sessions;
begin
  if not public.is_super_admin() then
    raise exception 'NOT_SUPER_ADMIN' using errcode = 'P0001';
  end if;
  select * into v_row from public.support_sessions where id = p_id for update;
  if not found then raise exception 'SUPPORT_SESSION_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_row.status <> 'invited' then
    raise exception 'SUPPORT_SESSION_NOT_INVITED' using errcode = 'P0001';
  end if;
  if v_row.expires_at <= now() then
    update public.support_sessions set status = 'expired' where id = p_id;
    raise exception 'SUPPORT_SESSION_EXPIRED' using errcode = 'P0001';
  end if;

  update public.support_sessions set actor_id = auth.uid() where id = p_id;
  perform public.support_session_activate(p_id, v_row.requested_by);
end $$;

revoke all on function public.admin_claim_support_session(uuid) from public, anon;
grant execute on function public.admin_claim_support_session(uuid) to authenticated;


-- ═══ ٧) الإنهاء ════════════════════════════════════════════════════════
-- السكّين مشترك: المالك، وأي موظّف عنده، والمشرف صاحب الجلسة. وسّعناها للموظّف
-- عمداً — الشريط ظاهرٌ على شاشته أيضاً، وزرٌّ ظاهرٌ لا يعمل أسوأ من غيابه.
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
    insert into public.notifications(audience, tenant_id, type, title, body, link, data)
    values ('owner', v_row.tenant_id, 'support_session', 'انتهت جلسة الدعم',
            'استمرّت ' || v_mins || ' دقيقة — وكل ما جرى فيها مسجّل باسم الدعم',
            '/dashboard', jsonb_build_object('session_id', p_id, 'status', 'ended'));
    insert into public.admin_audit_log(actor_id, action, tenant_id, details)
    values (v_row.actor_id, 'support_end', v_row.tenant_id,
            jsonb_build_object('session_id', p_id, 'minutes', v_mins, 'ended_by', v_by));
  end if;
end $$;

revoke all on function public.support_session_end(uuid) from public, anon;
grant execute on function public.support_session_end(uuid) to authenticated;


-- ═══ ٨) ما تقرؤه الواجهة ═══════════════════════════════════════════════
-- صفٌّ واحد يكفي الشريطَين معاً: شريط المالك («الدعم يعدّل الآن») وشريط الدعم
-- («أنت داخل حساب فلان»). ونُرجِع الدور معه — الشريط لا يعرف من ينظر إليه.
create or replace function public.support_session_current()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.support_sessions; v_tenant uuid; v_admin boolean; v_name text;
begin
  if auth.uid() is null then return null; end if;
  v_admin := public.is_super_admin();
  select tenant_id into v_tenant from public.profiles where id = auth.uid();

  perform public.support_session_sweep(v_tenant);

  -- المشرف داخل جلسة يراها أوّلاً: هو في حساب غيره الآن، وهذا أهمّ ما يُعرض له
  if v_admin then
    select * into v_row from public.support_sessions
     where actor_id = auth.uid() and status = 'active' and expires_at > now()
     order by approved_at desc limit 1;
  end if;

  if v_row.id is null and v_tenant is not null then
    select * into v_row from public.support_sessions
     where tenant_id = v_tenant and status in ('invited', 'pending', 'active')
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
    -- الدور: 'support' لمن يعدّل نيابةً، 'member' لأهل الملعب
    'viewer', case when v_admin and v_row.actor_id = auth.uid() and v_row.status = 'active'
                   then 'support' else 'member' end,
    'can_respond', (v_row.status = 'pending' and exists (
       select 1 from public.profiles
        where id = auth.uid() and role = 'owner' and tenant_id = v_row.tenant_id))
  );
end $$;

revoke all on function public.support_session_current() from public, anon;
grant execute on function public.support_session_current() to authenticated;


-- ما يعرضه المشرف في صفحة الملعب: الجلسة الحيّة إن وُجدت، وآخر خمسٍ للسياق.
create or replace function public.admin_support_sessions(p_tenant_id uuid)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v jsonb;
begin
  if not public.is_super_admin() then raise exception 'NOT_SUPER_ADMIN' using errcode = 'P0001'; end if;
  select coalesce(jsonb_agg(x order by ord desc), '[]'::jsonb) into v
  from (
    select jsonb_build_object(
      'id', s.id, 'status', s.status, 'origin', s.origin, 'reason', s.reason,
      'requested_at', s.requested_at, 'approved_at', s.approved_at,
      'ended_at', s.ended_at, 'ended_by', s.ended_by, 'expires_at', s.expires_at,
      'is_live', (s.status in ('invited','pending','active') and s.expires_at > now()),
      'is_mine', (s.actor_id = auth.uid()),
      'actor', coalesce(u.raw_user_meta_data->>'display_name',
                        u.raw_user_meta_data->>'full_name', u.email)
    ) as x, s.requested_at as ord
    from public.support_sessions s
    left join auth.users u on u.id = s.actor_id
    where s.tenant_id = p_tenant_id
    order by s.requested_at desc
    limit 5
  ) t;
  return v;
end $$;

revoke all on function public.admin_support_sessions(uuid) from public, anon;
grant execute on function public.admin_support_sessions(uuid) to authenticated;


-- ═══ ٩) حذف الحساب — ولماذا لا سطر هنا ═══════════════════════════════
-- purge_my_account لا تُعدَّل، وتريجر profiles أعلاه يكفيها: الحذف يمرّ حتماً
-- بصفّ العضوية فيرتدّ بـ SUPPORT_FORBIDDEN.
--
-- ويبقى مسارٌ واحد لا يمرّ به — حين لا صفّ عضوية للمنادي أصلاً (وهذه حال
-- المشرف بالتصميم): تحذف الدالّة أجهزةَ المنادي نفسه وتنصرف. وهي بيانات
-- المشرف لا بيانات المالك، لأن الدالّة تقرأ auth.uid() لا get_my_tenant_id —
-- فهي عمياء عن النيابة أصلاً، ولا يبلغها أثرها.
