-- متابعة العملاء المحتملين (leads) — دفتر المشرف الذي يسبق الاشتراك.
--
-- قبل هذا الجدول كانت المتابعة في رأس المشرف وفي واتساب: مَن كُلّم؟ ومتى؟
-- وماذا قال؟ فيضيع العميل بين رسالتين. هنا يصير لكل عميلٍ محتملٍ صفٌّ واحد
-- وخطٌّ زمنيٌّ لا يُمحى.
--
-- ثلاثة جداول لا حقلٌ واحد:
--   leads       — الصفّ نفسه: مَن، أي ملعب، أي رقم، وأين هو من السلسلة.
--   lead_notes  — الخطّ الزمني: كل ملاحظةٍ وكل انتقالِ حالة، باسم صاحبه ووقته.
--                 وحقل ملاحظاتٍ واحد كان سيمحو ما قبله في كل تحديث.
--   lead_access — مَن يرى الدفتر غير المشرفين. المنح لشخصٍ بعينه، وسحبه فوريّ،
--                 وكلاهما يدخل سجلّ نشاط المشرف.
--
-- والوصول كلّه عبر دوال SECURITY DEFINER: RLS مُفعَّل بلا سياسةٍ واحدة، فلا
-- يبلغ الجدولَ متصفّحٌ إلا من بابٍ نعرفه (نفس نمط admin_audit_log).

-- ─── ١) الجداول ──────────────────────────────────────────────────────────
create table if not exists public.leads (
  id             uuid primary key default gen_random_uuid(),
  customer_name  text not null,
  -- نصّ حرّ عمداً: الملعب قد لا يكون مسجّلاً بعد — وهذا أصل الفكرة. و
  -- tenant_id يُربط لاحقاً متى سُجّل، فينفتح التحقّق من التحوّل الحقيقي.
  venue_name     text not null,
  tenant_id      uuid references public.tenants(id) on delete set null,
  phone          text not null,
  status         text not null default 'new',
  source         text,
  next_follow_up date,
  -- أختامٌ للانتقالات المهمّة — يُشتقّ منها معدّل التحويل بلا عملٍ إضافي.
  first_contact_at timestamptz,
  trialed_at       timestamptz,
  subscribed_at    timestamptz,
  last_contact_at  timestamptz,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint leads_phone_saudi_format check (phone ~ '^05[0-9]{8}$'),
  constraint leads_status_valid check (status in
    ('new','contacted','no_answer','interested','trialed','subscribed','lost'))
);

-- رقمٌ واحدٌ لعميلٍ واحد: التكرار في دفتر المتابعة يعني مكالمتين متضاربتين.
create unique index if not exists idx_leads_phone on public.leads(phone);
create index if not exists idx_leads_status  on public.leads(status, created_at desc);
create index if not exists idx_leads_created on public.leads(created_at desc);
create index if not exists idx_leads_tenant  on public.leads(tenant_id);

create table if not exists public.lead_notes (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.leads(id) on delete cascade,
  -- 'note' كلامُ صاحبِ المتابعة، و'status' انتقالٌ يُسجَّل تلقائياً. كلاهما في
  -- خطٍّ واحد لأن القارئ يقرأ القصّة لا الجدولين.
  kind       text not null default 'note',
  body       text,
  meta       jsonb not null default '{}'::jsonb,
  author_id  uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint lead_notes_kind_valid check (kind in ('note','status'))
);
create index if not exists idx_lead_notes_lead on public.lead_notes(lead_id, created_at desc);

create table if not exists public.lead_access (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.leads       enable row level security;
alter table public.lead_notes  enable row level security;
alter table public.lead_access enable row level security;
-- لا سياسات → لا وصول مباشر. الأبواب كلّها أدناه.

-- ─── ٢) البوّاب ──────────────────────────────────────────────────────────
-- المشرف العام، أو مَن مُنح الوصول صراحةً. لا دورَ ثالث.
create or replace function public.can_access_leads()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_super_admin()
      or exists (select 1 from public.lead_access where user_id = auth.uid())
$$;

-- سؤال الواجهة: أُظهر التبويب أم لا؟ (يُستدعى عند تركيب لوحة المالك)
create or replace function public.leads_can_access()
returns boolean
language sql stable security definer set search_path = public
as $$ select public.can_access_leads() $$;

create or replace function public.leads_assert_access()
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.can_access_leads() then
    raise exception 'NO_LEADS_ACCESS' using errcode = 'P0001';
  end if;
end;
$$;

-- اسمٌ يُعرض لكاتب الملاحظة: المالك من ملفّه، والمشرف من بيانات حسابه.
create or replace function public.leads_actor_name(p_user_id uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select p.full_name from public.profiles p where p.id = p_user_id),
    (select nullif(btrim(coalesce(au.raw_user_meta_data->>'display_name',
                                  au.raw_user_meta_data->>'full_name', '')), '')
       from auth.users au where au.id = p_user_id),
    (select au.email::text from auth.users au where au.id = p_user_id),
    'غير معروف'
  )
$$;

-- ─── ٣) القراءة ──────────────────────────────────────────────────────────
create or replace function public.leads_list()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare v_rows jsonb;
begin
  perform public.leads_assert_access();
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'id',               l.id,
      'customer_name',    l.customer_name,
      'venue_name',       l.venue_name,
      'tenant_id',        l.tenant_id,
      'tenant_name',      t.name,
      'phone',            l.phone,
      'status',           l.status,
      'source',           l.source,
      'next_follow_up',   l.next_follow_up,
      'last_contact_at',  l.last_contact_at,
      'first_contact_at', l.first_contact_at,
      'trialed_at',       l.trialed_at,
      'subscribed_at',    l.subscribed_at,
      'created_at',       l.created_at,
      'created_by_name',  public.leads_actor_name(l.created_by),
      'notes_count',      (select count(*) from public.lead_notes n
                            where n.lead_id = l.id and n.kind = 'note'),
      'last_note',        (select n.body from public.lead_notes n
                            where n.lead_id = l.id and n.kind = 'note'
                            order by n.created_at desc limit 1)
    ) as x
    from public.leads l
    left join public.tenants t on t.id = l.tenant_id
  ) s;
  return v_rows;
end;
$$;

create or replace function public.lead_notes_list(p_lead_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare v_rows jsonb;
begin
  perform public.leads_assert_access();
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',          n.id,
    'kind',        n.kind,
    'body',        n.body,
    'meta',        n.meta,
    'author_name', public.leads_actor_name(n.author_id),
    'created_at',  n.created_at
  ) order by n.created_at desc), '[]'::jsonb) into v_rows
  from public.lead_notes n where n.lead_id = p_lead_id;
  return v_rows;
end;
$$;

-- ─── ٤) الكتابة ──────────────────────────────────────────────────────────
-- الإضافة والتحديث والحالة والملاحظة: لكل مَن يملك الوصول — فمَن يتواصل
-- فعلاً هو مَن يكتب، ودفترٌ لا يُكتب فيه عرضٌ لا متابعة.
create or replace function public.lead_create(
  p_customer_name  text,
  p_venue_name     text,
  p_phone          text,
  p_source         text default null,
  p_tenant_id      uuid default null,
  p_next_follow_up date default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id    uuid;
  v_phone text := btrim(coalesce(p_phone, ''));
begin
  perform public.leads_assert_access();
  if btrim(coalesce(p_customer_name, '')) = '' then
    raise exception 'اسم العميل مطلوب' using errcode = 'P0001'; end if;
  if btrim(coalesce(p_venue_name, '')) = '' then
    raise exception 'اسم الملعب مطلوب' using errcode = 'P0001'; end if;
  if v_phone !~ '^05[0-9]{8}$' then
    raise exception 'رقم الجوال يجب أن يبدأ بـ 05 ويتكوّن من ١٠ أرقام' using errcode = 'P0001'; end if;
  if exists (select 1 from public.leads where phone = v_phone) then
    raise exception 'هذا الرقم مُسجَّل في المتابعة مسبقاً' using errcode = 'P0001'; end if;

  insert into public.leads(customer_name, venue_name, phone, source, tenant_id,
                           next_follow_up, created_by)
  values (btrim(p_customer_name), btrim(p_venue_name), v_phone,
          nullif(btrim(coalesce(p_source, '')), ''), p_tenant_id,
          p_next_follow_up, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.lead_update(
  p_lead_id        uuid,
  p_customer_name  text,
  p_venue_name     text,
  p_phone          text,
  p_source         text default null,
  p_tenant_id      uuid default null,
  p_next_follow_up date default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare v_phone text := btrim(coalesce(p_phone, ''));
begin
  perform public.leads_assert_access();
  if v_phone !~ '^05[0-9]{8}$' then
    raise exception 'رقم الجوال يجب أن يبدأ بـ 05 ويتكوّن من ١٠ أرقام' using errcode = 'P0001'; end if;
  if exists (select 1 from public.leads where phone = v_phone and id <> p_lead_id) then
    raise exception 'هذا الرقم مُسجَّل في المتابعة مسبقاً' using errcode = 'P0001'; end if;

  update public.leads set
    customer_name  = btrim(p_customer_name),
    venue_name     = btrim(p_venue_name),
    phone          = v_phone,
    source         = nullif(btrim(coalesce(p_source, '')), ''),
    tenant_id      = p_tenant_id,
    next_follow_up = p_next_follow_up,
    updated_at     = now()
  where id = p_lead_id;
  if not found then raise exception 'العميل غير موجود' using errcode = 'P0001'; end if;
end;
$$;

create or replace function public.lead_add_note(p_lead_id uuid, p_body text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.leads_assert_access();
  if btrim(coalesce(p_body, '')) = '' then
    raise exception 'الملاحظة فارغة' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.leads where id = p_lead_id) then
    raise exception 'العميل غير موجود' using errcode = 'P0001'; end if;

  insert into public.lead_notes(lead_id, kind, body, author_id)
  values (p_lead_id, 'note', btrim(p_body), auth.uid());
  update public.leads set updated_at = now() where id = p_lead_id;
end;
$$;

-- الحالة والملاحظة معاً: أغلب الانتقالات تصحبها كلمة («ما ردّ»، «طلب مهلة»)،
-- وفصلهما في خطوتين يجعل نصفها يضيع.
create or replace function public.lead_set_status(
  p_lead_id uuid,
  p_status  text,
  p_note    text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare v_old text;
begin
  perform public.leads_assert_access();
  if p_status not in ('new','contacted','no_answer','interested','trialed','subscribed','lost') then
    raise exception 'حالة غير معروفة' using errcode = 'P0001'; end if;

  select status into v_old from public.leads where id = p_lead_id;
  if v_old is null then raise exception 'العميل غير موجود' using errcode = 'P0001'; end if;

  update public.leads set
    status = p_status,
    -- «تم التواصل» فما بعدها تعني أن أحداً كلّمه فعلاً.
    last_contact_at  = case when p_status in ('contacted','no_answer','interested','trialed','subscribed','lost')
                            then now() else last_contact_at end,
    first_contact_at = case when first_contact_at is null
                             and p_status in ('contacted','interested','trialed','subscribed')
                            then now() else first_contact_at end,
    trialed_at       = case when trialed_at is null and p_status in ('trialed','subscribed')
                            then now() else trialed_at end,
    subscribed_at    = case when subscribed_at is null and p_status = 'subscribed'
                            then now() else subscribed_at end,
    updated_at = now()
  where id = p_lead_id;

  if v_old is distinct from p_status then
    insert into public.lead_notes(lead_id, kind, body, meta, author_id)
    values (p_lead_id, 'status', nullif(btrim(coalesce(p_note, '')), ''),
            jsonb_build_object('from', v_old, 'to', p_status), auth.uid());
  elsif btrim(coalesce(p_note, '')) <> '' then
    insert into public.lead_notes(lead_id, kind, body, author_id)
    values (p_lead_id, 'note', btrim(p_note), auth.uid());
  end if;
end;
$$;

-- الحذف للمشرف وحده: المشاركة تعاونٌ في المتابعة لا سلطةٌ على الدفتر.
create or replace function public.lead_delete(p_lead_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'NOT_SUPER_ADMIN' using errcode = 'P0001'; end if;
  delete from public.leads where id = p_lead_id;
end;
$$;

-- ─── ٥) المشاركة ─────────────────────────────────────────────────────────
-- المنح لشخصٍ بعينه بالبريد (نفس نمط admin_add_admin)، والسحب فوريّ، وكلاهما
-- في سجلّ النشاط — لأن ما يُشارَك هنا أرقامُ عملاءَ وملاحظاتٌ عنهم.
create or replace function public.leads_access_list()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare v_rows jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'NOT_SUPER_ADMIN' using errcode = 'P0001'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id',     a.user_id,
    'email',       au.email::text,
    'name',        public.leads_actor_name(a.user_id),
    'tenant_name', t.name,
    'created_at',  a.created_at
  ) order by a.created_at), '[]'::jsonb) into v_rows
  from public.lead_access a
  join auth.users au on au.id = a.user_id
  left join public.profiles p on p.id = a.user_id
  left join public.tenants  t on t.id = p.tenant_id;
  return v_rows;
end;
$$;

create or replace function public.leads_access_grant(p_email text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_uid uuid;
begin
  if not public.is_super_admin() then
    raise exception 'NOT_SUPER_ADMIN' using errcode = 'P0001'; end if;
  select id into v_uid from auth.users where lower(email) = lower(btrim(p_email)) limit 1;
  if v_uid is null then
    raise exception 'لا يوجد مستخدم مسجّل بهذا البريد (يجب أن يملك حساباً أولاً)' using errcode = 'P0001';
  end if;

  insert into public.lead_access(user_id, granted_by)
  select v_uid, auth.uid()
  where not exists (select 1 from public.lead_access where user_id = v_uid);

  perform public.admin_log_action('leads_access_grant', null,
    jsonb_build_object('user_id', v_uid, 'email', lower(btrim(p_email))));
end;
$$;

create or replace function public.leads_access_revoke(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'NOT_SUPER_ADMIN' using errcode = 'P0001'; end if;
  delete from public.lead_access where user_id = p_user_id;
  perform public.admin_log_action('leads_access_revoke', null,
    jsonb_build_object('user_id', p_user_id));
end;
$$;

-- ─── ٦) الصلاحيات ────────────────────────────────────────────────────────
revoke all on function public.can_access_leads()      from public, anon, authenticated;
revoke all on function public.leads_assert_access()   from public, anon, authenticated;
revoke all on function public.leads_actor_name(uuid)  from public, anon, authenticated;
grant execute on function public.leads_can_access()   to authenticated;
grant execute on function public.leads_list()         to authenticated;
grant execute on function public.lead_notes_list(uuid) to authenticated;
grant execute on function public.lead_create(text, text, text, text, uuid, date) to authenticated;
grant execute on function public.lead_update(uuid, text, text, text, text, uuid, date) to authenticated;
grant execute on function public.lead_add_note(uuid, text)          to authenticated;
grant execute on function public.lead_set_status(uuid, text, text)  to authenticated;
grant execute on function public.lead_delete(uuid)                  to authenticated;
grant execute on function public.leads_access_list()                to authenticated;
grant execute on function public.leads_access_grant(text)           to authenticated;
grant execute on function public.leads_access_revoke(uuid)          to authenticated;
