-- العرض لا يرفع السعر أبدًا: السعر الفعّال مقيَّد بسقف السعر الأصلي للموعد.
-- لو وضع المالك سعرًا ثابتًا أعلى من سعر فترةٍ ما، يبقى السعر الأصلي ولا يُطبَّق العرض هناك.
create or replace function public.offer_for_slot(p_tenant_id uuid, p_field_id uuid, p_slot_start timestamptz, p_base numeric)
 returns jsonb language plpgsql stable security definer
 set search_path to 'public' set "TimeZone" to 'Asia/Riyadh'
as $function$
declare v_eff numeric; v_label text;
begin
  if p_base is null then return jsonb_build_object('price', null, 'label', null); end if;
  select o.label,
         least(p_base, greatest(0, case when o.fixed_price is not null then o.fixed_price
                                        else round(p_base * (1 - o.discount_percent/100.0), 2) end))
    into v_label, v_eff
  from public.field_offers o
  where o.tenant_id = p_tenant_id and o.active
    and (o.start_date is null or p_slot_start::date >= o.start_date)
    and (o.end_date   is null or p_slot_start::date <= o.end_date)
    and (
      not exists (select 1 from public.offer_targets t where t.offer_id = o.id)
      or exists (
        select 1 from public.offer_targets t
        where t.offer_id = o.id
          and (t.field_id   is null or t.field_id = p_field_id)
          and (t.weekday    is null or t.weekday = extract(dow from p_slot_start)::int)
          and (t.start_time is null or p_slot_start::time >= t.start_time)
          and (t.end_time   is null or p_slot_start::time <  t.end_time)
      )
    )
  order by least(p_base, greatest(0, case when o.fixed_price is not null then o.fixed_price
                                          else round(p_base * (1 - o.discount_percent/100.0), 2) end)) asc
  limit 1;
  if v_eff is null then return jsonb_build_object('price', p_base, 'label', null); end if;
  return jsonb_build_object('price', v_eff, 'label', v_label);
end;
$function$;
