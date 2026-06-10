-- أهداف العرض: عدّة فترات (يوم+وقت) لكل عرض. لا أهداف = ينطبق على كل المواعيد.
-- (نسخة أولى — يضيف لها 20260609135000 عمود field_id لكل هدف)
create table if not exists public.offer_targets (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.field_offers(id) on delete cascade,
  weekday int,
  start_time time,
  end_time time,
  constraint ot_weekday check (weekday is null or (weekday between 0 and 6))
);
create index if not exists idx_offer_targets_offer on public.offer_targets(offer_id);

alter table public.offer_targets enable row level security;
create policy ot_select on public.offer_targets for select
  using (exists (select 1 from public.field_offers o where o.id = offer_id and o.tenant_id = public.get_my_tenant_id()));
create policy ot_write on public.offer_targets for all
  using (exists (select 1 from public.field_offers o where o.id = offer_id and o.tenant_id = public.get_my_tenant_id() and public.is_owner()))
  with check (exists (select 1 from public.field_offers o where o.id = offer_id and o.tenant_id = public.get_my_tenant_id() and public.is_owner()));

-- رحّل الأهداف المضمّنة سابقًا (إن وُجدت) ثم أزل الأعمدة المضمّنة من field_offers
insert into public.offer_targets(offer_id, weekday, start_time, end_time)
select id, weekday, start_time, end_time from public.field_offers
where weekday is not null or start_time is not null or end_time is not null;

alter table public.field_offers drop column if exists weekday;
alter table public.field_offers drop column if exists start_time;
alter table public.field_offers drop column if exists end_time;

-- offer_for_slot تعتمد الأهداف (تطابق أي هدف، أو لا أهداف = الكل)
create or replace function public.offer_for_slot(p_tenant_id uuid, p_field_id uuid, p_slot_start timestamptz, p_base numeric)
 returns jsonb language plpgsql stable security definer
 set search_path to 'public' set "TimeZone" to 'Asia/Riyadh'
as $function$
declare v_eff numeric; v_label text;
begin
  if p_base is null then return jsonb_build_object('price', null, 'label', null); end if;
  select o.label,
         greatest(0, case when o.fixed_price is not null then o.fixed_price
                          else round(p_base * (1 - o.discount_percent/100.0), 2) end)
    into v_label, v_eff
  from public.field_offers o
  where o.tenant_id = p_tenant_id and o.active
    and (o.field_id is null or o.field_id = p_field_id)
    and (o.start_date is null or p_slot_start::date >= o.start_date)
    and (o.end_date   is null or p_slot_start::date <= o.end_date)
    and (
      not exists (select 1 from public.offer_targets t where t.offer_id = o.id)
      or exists (
        select 1 from public.offer_targets t
        where t.offer_id = o.id
          and (t.weekday    is null or t.weekday = extract(dow from p_slot_start)::int)
          and (t.start_time is null or p_slot_start::time >= t.start_time)
          and (t.end_time   is null or p_slot_start::time <  t.end_time)
      )
    )
  order by greatest(0, case when o.fixed_price is not null then o.fixed_price
                            else round(p_base * (1 - o.discount_percent/100.0), 2) end) asc
  limit 1;
  if v_eff is null then return jsonb_build_object('price', p_base, 'label', null); end if;
  return jsonb_build_object('price', v_eff, 'label', v_label);
end;
$function$;

-- حفظ عرض + أهدافه ذرّيًّا (نسخة أولى — الملعب على العرض)
create or replace function public.save_offer(
  p_id uuid, p_field_id uuid, p_label text, p_discount numeric, p_fixed numeric,
  p_start_date date, p_end_date date, p_targets jsonb)
 returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare v_tenant uuid := public.get_my_tenant_id(); v_id uuid; v_t jsonb;
begin
  if v_tenant is null or not public.is_owner() then
    raise exception 'هذه العملية متاحة للمالك فقط' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_label), '') = '' then raise exception 'اسم العرض مطلوب' using errcode = 'P0001'; end if;
  if p_discount is null and p_fixed is null then raise exception 'حدّد خصمًا أو سعرًا ثابتًا' using errcode = 'P0001'; end if;

  if p_id is null then
    insert into public.field_offers(tenant_id, field_id, label, discount_percent, fixed_price, start_date, end_date)
    values (v_tenant, p_field_id, btrim(p_label), p_discount, p_fixed, p_start_date, p_end_date)
    returning id into v_id;
  else
    update public.field_offers
      set field_id = p_field_id, label = btrim(p_label), discount_percent = p_discount,
          fixed_price = p_fixed, start_date = p_start_date, end_date = p_end_date
      where id = p_id and tenant_id = v_tenant
      returning id into v_id;
    if v_id is null then raise exception 'العرض غير موجود' using errcode = 'P0001'; end if;
    delete from public.offer_targets where offer_id = v_id;
  end if;

  if p_targets is not null and jsonb_typeof(p_targets) = 'array' then
    for v_t in select * from jsonb_array_elements(p_targets) loop
      insert into public.offer_targets(offer_id, weekday, start_time, end_time)
      values (v_id,
        nullif(v_t->>'weekday','')::int,
        nullif(v_t->>'start_time','')::time,
        nullif(v_t->>'end_time','')::time);
    end loop;
  end if;
  return v_id;
end;
$function$;
