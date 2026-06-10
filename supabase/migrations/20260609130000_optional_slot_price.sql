-- سعر اختياري للفترات: NULL = «السعر عند التواصل»، 0 = مجاني، >0 = سعر عادي
alter table public.working_periods alter column hourly_price drop not null;
alter table public.bookings        alter column total_price  drop not null;

-- set_day_periods: لا تُجبر السعر على 0؛ اسمح بـ NULL (عند التواصل)
create or replace function public.set_day_periods(p_field_id uuid, p_day_of_week integer, p_periods jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_tenant_id uuid;
  v_field record;
  v_period jsonb;
  v_count int := 0;
begin
  v_tenant_id := public.get_my_tenant_id();
  if v_tenant_id is null then raise exception 'غير مصرّح' using errcode = 'P0001'; end if;
  if not public.is_owner() then raise exception 'هذه العملية متاحة للمالك فقط' using errcode = 'P0001'; end if;
  if not public.is_my_tenant_active() then raise exception 'TENANT_INACTIVE' using errcode = 'P0001'; end if;
  if p_day_of_week < 0 or p_day_of_week > 6 then raise exception 'يوم غير صحيح' using errcode = 'P0001'; end if;

  select id, tenant_id into v_field
  from public.fields where id = p_field_id and tenant_id = v_tenant_id;
  if not found then raise exception 'الأرضية غير موجودة' using errcode = 'P0001'; end if;

  delete from public.working_periods
  where field_id = p_field_id and day_of_week = p_day_of_week;

  if p_periods is null or jsonb_typeof(p_periods) <> 'array' then
    return jsonb_build_object('inserted', 0);
  end if;

  for v_period in select * from jsonb_array_elements(p_periods)
  loop
    insert into public.working_periods (
      tenant_id, field_id, day_of_week, open_time, close_time,
      slot_duration_minutes, hourly_price
    )
    values (
      v_tenant_id, p_field_id, p_day_of_week,
      (v_period->>'open')::time,
      (v_period->>'close')::time,
      coalesce((v_period->>'duration')::int, 60),
      (v_period->>'price')::numeric      -- NULL مسموح = عند التواصل
    );
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('inserted', v_count);
end;
$function$;
