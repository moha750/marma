-- create_pending_booking: تطبيق العرض على السعر النهائي
create or replace function public.create_pending_booking(p_tenant_id uuid, p_field_id uuid, p_start_time timestamptz, p_customer_name text, p_customer_phone text, p_notes text default null)
 returns jsonb language plpgsql security definer set search_path to 'public' set "TimeZone" to 'Asia/Riyadh'
as $function$
declare
  v_field record; v_customer record; v_customer_id uuid; v_customer_input_name text;
  v_total_price numeric; v_end_time timestamptz; v_booking_id uuid;
  v_clean_name text; v_clean_phone text;
  v_target_date date; v_target_time time; v_target_dow int;
  v_period record; v_day_start timestamptz; v_delta_seconds numeric;
  v_slot_seconds int; v_matched_duration int; v_matched_price numeric; v_matched boolean := false;
  v_offer jsonb; v_eff_hourly numeric;
begin
  if not public.is_tenant_active(p_tenant_id) then raise exception 'TENANT_INACTIVE' using errcode = 'P0001'; end if;
  v_clean_name := btrim(p_customer_name);
  v_clean_phone := btrim(p_customer_phone);
  if v_clean_name is null or v_clean_name = '' then raise exception 'اسم العميل مطلوب' using errcode = 'P0001'; end if;
  if v_clean_phone is null or v_clean_phone = '' then raise exception 'رقم الجوال مطلوب' using errcode = 'P0001'; end if;

  select id, tenant_id, name, is_active into v_field
  from public.fields where id = p_field_id and tenant_id = p_tenant_id;
  if not found then raise exception 'الأرضية غير موجودة' using errcode = 'P0001'; end if;
  if not v_field.is_active then raise exception 'هذه الأرضية غير متاحة للحجز حالياً' using errcode = 'P0001'; end if;
  if p_start_time < now() + interval '1 hour' then raise exception 'يجب الحجز قبل ساعة على الأقل من الموعد' using errcode = 'P0001'; end if;

  v_target_date := p_start_time::date;
  v_target_time := p_start_time::time;
  v_target_dow := extract(dow from v_target_date)::int;

  for v_period in
    select wp.open_time, wp.close_time, wp.slot_duration_minutes as duration, wp.hourly_price as price
    from public.working_periods wp
    where wp.field_id = p_field_id and wp.day_of_week = v_target_dow
  loop
    v_slot_seconds := v_period.duration * 60;
    if v_period.close_time > v_period.open_time then
      if v_target_time >= v_period.open_time and v_target_time < v_period.close_time then
        v_day_start := (v_target_date::text || ' ' || v_period.open_time::text)::timestamptz;
        v_delta_seconds := extract(epoch from (p_start_time - v_day_start));
        if v_delta_seconds >= 0 and (v_delta_seconds::int % v_slot_seconds) = 0
           and p_start_time + make_interval(mins => v_period.duration) <=
               (v_target_date::text || ' ' || v_period.close_time::text)::timestamptz then
          v_matched_duration := v_period.duration; v_matched_price := v_period.price; v_matched := true; exit;
        end if;
      end if;
    else
      if v_target_time >= v_period.open_time then
        v_day_start := (v_target_date::text || ' ' || v_period.open_time::text)::timestamptz;
        v_delta_seconds := extract(epoch from (p_start_time - v_day_start));
        if v_delta_seconds >= 0 and (v_delta_seconds::int % v_slot_seconds) = 0
           and p_start_time + make_interval(mins => v_period.duration) <=
               ((v_target_date + 1)::text || ' ' || v_period.close_time::text)::timestamptz then
          v_matched_duration := v_period.duration; v_matched_price := v_period.price; v_matched := true; exit;
        end if;
      end if;
    end if;
  end loop;

  if not v_matched then
    for v_period in
      select wp.open_time, wp.close_time, wp.slot_duration_minutes as duration, wp.hourly_price as price
      from public.working_periods wp
      where wp.field_id = p_field_id
        and wp.day_of_week = ((v_target_dow - 1 + 7) % 7)
        and wp.close_time <= wp.open_time
    loop
      v_slot_seconds := v_period.duration * 60;
      if v_target_time < v_period.close_time then
        v_day_start := ((v_target_date - 1)::text || ' ' || v_period.open_time::text)::timestamptz;
        v_delta_seconds := extract(epoch from (p_start_time - v_day_start));
        if v_delta_seconds >= 0 and (v_delta_seconds::int % v_slot_seconds) = 0
           and p_start_time + make_interval(mins => v_period.duration) <=
               (v_target_date::text || ' ' || v_period.close_time::text)::timestamptz then
          v_matched_duration := v_period.duration; v_matched_price := v_period.price; v_matched := true; exit;
        end if;
      end if;
    end loop;
  end if;

  if not v_matched then raise exception 'الموعد المختار غير صالح حسب فترات العمل' using errcode = 'P0001'; end if;

  v_end_time := p_start_time + make_interval(mins => v_matched_duration);
  -- تطبيق العرض على السعر/ساعة (إن وُجد)
  v_offer := public.offer_for_slot(p_tenant_id, p_field_id, p_start_time, v_matched_price);
  v_eff_hourly := nullif(v_offer->>'price', '')::numeric;
  v_total_price := case when v_eff_hourly is null then null
                        else round((v_matched_duration / 60.0) * v_eff_hourly, 2) end;

  select id, full_name into v_customer
  from public.customers where tenant_id = p_tenant_id and phone = v_clean_phone;
  if found then
    v_customer_id := v_customer.id;
    if btrim(v_customer.full_name) <> v_clean_name then v_customer_input_name := v_clean_name; end if;
  else
    insert into public.customers (tenant_id, full_name, phone)
    values (p_tenant_id, v_clean_name, v_clean_phone) returning id into v_customer_id;
  end if;

  begin
    insert into public.bookings (
      tenant_id, field_id, customer_id, start_time, end_time,
      total_price, paid_amount, status, notes, customer_input_name, created_by
    ) values (
      p_tenant_id, p_field_id, v_customer_id, p_start_time, v_end_time,
      v_total_price, 0, 'pending', nullif(btrim(coalesce(p_notes, '')), ''), v_customer_input_name, null
    ) returning id into v_booking_id;
  exception when exclusion_violation then
    raise exception 'هذا الموعد محجوز بالفعل على نفس الأرضية' using errcode = 'P0001';
  end;

  return jsonb_build_object(
    'booking_id', v_booking_id, 'total_price', v_total_price,
    'end_time', v_end_time, 'message', 'تم استلام طلب الحجز بنجاح'
  );
end;
$function$;
