-- سعرٌ ثابت يُحدِّد سعر المواعيد المفتوحة (null = عند التواصل)؛ النسبة تحتاج سعرًا أصليًّا فتُتجاهَل هناك.
-- يبني على 20260610090000: يبقى السقف (لا رفع للسعر) للمواعيد المسعّرة، ويُضيف تطبيق السعر الثابت على المفتوحة.
create or replace function public.offer_for_slot(p_tenant_id uuid, p_field_id uuid, p_slot_start timestamptz, p_base numeric)
 returns jsonb language plpgsql stable security definer
 set search_path to 'public' set "TimeZone" to 'Asia/Riyadh'
as $function$
declare v_eff numeric; v_label text;
begin
  select o.label,
         case when p_base is null then greatest(0, o.fixed_price)
              else least(p_base, greatest(0, case when o.fixed_price is not null then o.fixed_price
                                                  else round(p_base * (1 - o.discount_percent/100.0), 2) end))
         end
    into v_label, v_eff
  from public.field_offers o
  where o.tenant_id = p_tenant_id and o.active
    and (o.fixed_price is not null or p_base is not null)   -- النسبة تحتاج سعرًا أصليًّا
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
  order by case when p_base is null then greatest(0, o.fixed_price)
                else least(p_base, greatest(0, case when o.fixed_price is not null then o.fixed_price
                                                    else round(p_base * (1 - o.discount_percent/100.0), 2) end))
           end asc
  limit 1;
  if v_eff is null then return jsonb_build_object('price', p_base, 'label', null); end if;
  return jsonb_build_object('price', v_eff, 'label', v_label);
end;
$function$;
