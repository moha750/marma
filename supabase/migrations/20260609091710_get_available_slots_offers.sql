-- get_available_slots: تطبيق العرض + إرجاع السعر الأصلي ووسم العرض
drop function if exists public.get_available_slots(uuid, uuid, date);
create function public.get_available_slots(p_tenant_id uuid, p_field_id uuid, p_date date)
 returns table(slot_start timestamptz, slot_end timestamptz, is_available boolean, is_past boolean,
   slot_duration_minutes integer, slot_price numeric, original_price numeric, offer_label text)
 language plpgsql stable security definer set search_path to 'public' set "TimeZone" to 'Asia/Riyadh'
as $function$
declare
  v_field record; v_period record; v_target_dow int;
  v_day_start timestamptz; v_day_end timestamptz;
  v_slot_start timestamptz; v_slot_end timestamptz; v_min_future timestamptz;
  v_offer jsonb; v_eff_hourly numeric;
begin
  if not public.is_tenant_active(p_tenant_id) then return; end if;
  select id, tenant_id, is_active into v_field
  from public.fields where id = p_field_id and tenant_id = p_tenant_id and is_active = true;
  if not found then return; end if;

  v_target_dow := extract(dow from p_date)::int;
  v_min_future := now() + interval '1 hour';

  for v_period in
    select wp.open_time, wp.close_time, wp.slot_duration_minutes as duration, wp.hourly_price as price
    from public.working_periods wp
    where wp.field_id = p_field_id and wp.day_of_week = v_target_dow
    order by wp.open_time
  loop
    v_day_start := (p_date::text || ' ' || v_period.open_time::text)::timestamptz;
    if v_period.close_time <= v_period.open_time then
      v_day_end := ((p_date + 1)::text || ' ' || v_period.close_time::text)::timestamptz;
    else
      v_day_end := (p_date::text || ' ' || v_period.close_time::text)::timestamptz;
    end if;

    v_slot_start := v_day_start;
    while v_slot_start < v_day_end loop
      v_slot_end := v_slot_start + make_interval(mins => v_period.duration);
      exit when v_slot_end > v_day_end;

      slot_start := v_slot_start;
      slot_end := v_slot_end;
      slot_duration_minutes := v_period.duration;
      original_price := case when v_period.price is null then null
                             else round((v_period.duration / 60.0) * v_period.price, 2) end;
      v_offer := public.offer_for_slot(p_tenant_id, p_field_id, v_slot_start, v_period.price);
      v_eff_hourly := nullif(v_offer->>'price', '')::numeric;
      slot_price := case when v_eff_hourly is null then null
                         else round((v_period.duration / 60.0) * v_eff_hourly, 2) end;
      offer_label := case when (v_offer->>'label') is not null
                            and slot_price is not null and original_price is not null
                            and slot_price < original_price
                          then v_offer->>'label' else null end;
      is_past := v_slot_start < v_min_future;
      is_available := not is_past and not exists (
        select 1 from public.bookings b
        where b.field_id = p_field_id
          and b.status in ('pending', 'confirmed', 'completed', 'blocked')
          and tstzrange(b.start_time, b.end_time, '[)') && tstzrange(v_slot_start, v_slot_end, '[)')
      );
      return next;
      v_slot_start := v_slot_end;
    end loop;
  end loop;
end;
$function$;
