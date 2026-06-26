-- عروض/خصومات زمنية فوق السعر الأساسي للفترات
create table if not exists public.field_offers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  field_id  uuid references public.fields(id) on delete cascade,   -- null = كل الأرضيات
  label text not null,
  discount_percent numeric,        -- إمّا نسبة خصم
  fixed_price numeric,             -- أو سعر/ساعة ثابت بديل
  start_date date,                 -- مدى تواريخ (null = بلا حد)
  end_date date,
  weekday int,                     -- 0-6 (null = أي يوم)
  start_time time,                 -- مدى وقت اليوم (null = كل اليوم)
  end_time time,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint offer_has_effect check (discount_percent is not null or fixed_price is not null),
  constraint offer_percent_range check (discount_percent is null or (discount_percent > 0 and discount_percent <= 100)),
  constraint offer_fixed_pos check (fixed_price is null or fixed_price >= 0),
  constraint offer_weekday check (weekday is null or (weekday between 0 and 6))
);
create index if not exists idx_offers_tenant on public.field_offers(tenant_id);
create index if not exists idx_offers_field on public.field_offers(field_id);

alter table public.field_offers enable row level security;
create policy offers_select on public.field_offers for select
  using (tenant_id = public.get_my_tenant_id());
create policy offers_insert on public.field_offers for insert
  with check (tenant_id = public.get_my_tenant_id() and public.is_owner());
create policy offers_update on public.field_offers for update
  using (tenant_id = public.get_my_tenant_id() and public.is_owner())
  with check (tenant_id = public.get_my_tenant_id() and public.is_owner());
create policy offers_delete on public.field_offers for delete
  using (tenant_id = public.get_my_tenant_id() and public.is_owner());

-- دالة: أفضل عرض مطابق لموعد (تُرجع السعر/ساعة الفعّال + وسم العرض)
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
    and (o.weekday    is null or o.weekday = extract(dow from p_slot_start)::int)
    and (o.start_time is null or p_slot_start::time >= o.start_time)
    and (o.end_time   is null or p_slot_start::time <  o.end_time)
  order by greatest(0, case when o.fixed_price is not null then o.fixed_price
                            else round(p_base * (1 - o.discount_percent/100.0), 2) end) asc
  limit 1;
  if v_eff is null then return jsonb_build_object('price', p_base, 'label', null); end if;
  return jsonb_build_object('price', v_eff, 'label', v_label);
end;
$function$;
