-- اسم العميل اختياري، واسم الملعب هو المطلوب.
--
-- الواقع أن الملعب يُعرف قبل صاحبه: تمرّ بالملعب أو يصلك اسمه، والاسم الشخصي
-- قد لا يُعرف إلا في المكالمة الأولى. وإلزام ما لا يُعلم يدفع إلى كتابة
-- «مالك الملعب» في الخانة — سطرٌ لا يحمل خبراً. فالخانة تُترك فارغةً بشرف،
-- والدفتر يعرض الملعب حين لا يجد اسماً.

alter table public.leads alter column customer_name drop not null;

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
  if btrim(coalesce(p_venue_name, '')) = '' then
    raise exception 'اسم الملعب مطلوب' using errcode = 'P0001'; end if;
  if v_phone !~ '^05[0-9]{8}$' then
    raise exception 'رقم الجوال يجب أن يبدأ بـ 05 ويتكوّن من ١٠ أرقام' using errcode = 'P0001'; end if;
  if exists (select 1 from public.leads where phone = v_phone) then
    raise exception 'هذا الرقم مُسجَّل في المتابعة مسبقاً' using errcode = 'P0001'; end if;

  insert into public.leads(customer_name, venue_name, phone, source, tenant_id,
                           next_follow_up, created_by)
  values (nullif(btrim(coalesce(p_customer_name, '')), ''), btrim(p_venue_name), v_phone,
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
  if btrim(coalesce(p_venue_name, '')) = '' then
    raise exception 'اسم الملعب مطلوب' using errcode = 'P0001'; end if;
  if v_phone !~ '^05[0-9]{8}$' then
    raise exception 'رقم الجوال يجب أن يبدأ بـ 05 ويتكوّن من ١٠ أرقام' using errcode = 'P0001'; end if;
  if exists (select 1 from public.leads where phone = v_phone and id <> p_lead_id) then
    raise exception 'هذا الرقم مُسجَّل في المتابعة مسبقاً' using errcode = 'P0001'; end if;

  update public.leads set
    customer_name  = nullif(btrim(coalesce(p_customer_name, '')), ''),
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
