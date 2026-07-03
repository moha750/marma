-- تمكين التخفيض عند التجديد بعد انتهاء الدورة، مع حرّاس السلامة:
--   1) لا يُطلب أقلّ من الاستخدام الفعلي (أرضيات/موظفون مُنشأون).
--   2) لا خفض مبكّر ضمن دورة مدفوعة نشطة (now < subscription_ends_at).
--   3) approve للتجديد يضبط allowed = المطلوب (بأرضية الاستخدام)، بدل GREATEST — فيسمح بالخفض.

create or replace function public.request_subscription(
  p_plan_id uuid, p_fields integer, p_staff integer,
  p_reference text default null, p_note text default null, p_receipt_path text default null,
  p_kind text default 'renew'
) returns uuid
 language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_tenant    record;
  v_user_id   uuid := auth.uid();
  v_plan      record;
  v_clean_ref     text := btrim(coalesce(p_reference, ''));
  v_clean_receipt text := btrim(coalesce(p_receipt_path, ''));
  v_kind      text := lower(coalesce(p_kind, 'renew'));
  v_id        uuid;
  v_amount    numeric;
  v_added_fields   int;
  v_added_staff    int;
  v_remaining_days int;
  v_cur_fields     int;
  v_cur_staff      int;
  v_base_price      constant numeric := 200;
  v_unit_price      constant numeric := 50;
  v_included_fields constant int     := 1;
  v_included_staff  constant int     := 1;
begin
  if v_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.is_owner() then raise exception 'NOT_OWNER' using errcode = 'P0001'; end if;
  if v_kind not in ('new', 'renew', 'upgrade') then v_kind := 'renew'; end if;
  if v_clean_receipt = '' and v_clean_ref = '' then
    raise exception 'PAYMENT_PROOF_REQUIRED' using errcode = 'P0001';
  end if;
  if p_fields is null or p_fields < 1 or p_staff is null or p_staff < 1 then
    raise exception 'INVALID_UNIT_COUNT' using errcode = 'P0001';
  end if;

  select t.* into v_tenant from public.tenants t where t.id = public.get_my_tenant_id() for update;
  if not found then raise exception 'TENANT_NOT_FOUND' using errcode = 'P0001'; end if;

  if v_clean_receipt <> '' and v_clean_receipt not like (v_tenant.id::text || '/%') then
    raise exception 'INVALID_RECEIPT_PATH' using errcode = 'P0001';
  end if;

  select id, name, duration_days, is_active into v_plan from public.plans where id = p_plan_id;
  if not found or not v_plan.is_active then
    raise exception 'PLAN_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.subscriptions where tenant_id = v_tenant.id and status = 'pending') then
    raise exception 'SUBSCRIPTION_PENDING_EXISTS' using errcode = 'P0001';
  end if;

  -- الاستخدام الفعلي (لحرّاس السلامة)
  select count(*)::int into v_cur_fields from public.fields   where tenant_id = v_tenant.id and is_active;
  select count(*)::int into v_cur_staff  from public.profiles where tenant_id = v_tenant.id and role = 'staff';

  if v_kind = 'upgrade' then
    -- الترقية الفورية تتطلّب اشتراكاً مدفوعاً نشطاً بتاريخ انتهاء مستقبلي
    if not public.is_tenant_active(v_tenant.id)
       or v_tenant.subscription_ends_at is null
       or v_tenant.subscription_ends_at <= now() then
      raise exception 'UPGRADE_NOT_ALLOWED' using errcode = 'P0001';
    end if;
    v_added_fields := p_fields - coalesce(v_tenant.allowed_fields, v_included_fields);
    v_added_staff  := p_staff  - coalesce(v_tenant.allowed_staff,  v_included_staff);
    if v_added_fields < 0 or v_added_staff < 0 then
      raise exception 'INVALID_UNIT_COUNT' using errcode = 'P0001';
    end if;
    if (v_added_fields + v_added_staff) <= 0 then
      raise exception 'NO_UNITS_ADDED' using errcode = 'P0001';
    end if;
    v_remaining_days := greatest(0, ceil(extract(epoch from (v_tenant.subscription_ends_at - now())) / 86400.0)::int);
    v_amount := round((v_added_fields + v_added_staff) * v_unit_price * v_remaining_days::numeric / v_plan.duration_days);
  else
    -- تجديد/جديد: شهر كامل بالوحدات المختارة
    -- حارس 1: لا تطلب أقلّ من استخدامك الفعلي (وإلا وحدات مُنشأة تتجاوز الحدّ)
    if p_fields < v_cur_fields or p_staff < v_cur_staff then
      raise exception 'BELOW_CURRENT_USAGE' using errcode = 'P0001';
    end if;
    -- حارس 2: لا خفض مبكّر ضمن دورة مدفوعة نشطة (now < subscription_ends_at)
    if v_tenant.subscription_ends_at is not null and v_tenant.subscription_ends_at > now() then
      if p_fields < coalesce(v_tenant.allowed_fields, v_included_fields)
         or p_staff < coalesce(v_tenant.allowed_staff, 0) then
        raise exception 'DOWNGRADE_NOT_ALLOWED_ACTIVE' using errcode = 'P0001';
      end if;
    end if;
    v_amount := v_base_price
              + greatest(0, p_fields - v_included_fields) * v_unit_price
              + greatest(0, p_staff  - v_included_staff)  * v_unit_price;
  end if;

  insert into public.subscriptions (
    tenant_id, plan_id, status, amount, payment_reference, receipt_path, note,
    requested_fields, requested_staff, created_by, kind
  ) values (
    v_tenant.id, p_plan_id, 'pending', v_amount,
    nullif(v_clean_ref, ''), nullif(v_clean_receipt, ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    p_fields, p_staff, v_user_id, v_kind
  ) returning id into v_id;

  return v_id;
end;
$function$;

-- approve: الترقية ترفع الحدود بلا تمديد؛ التجديد يضبط الحدّ = المطلوب (بأرضية الاستخدام) ويمدّد
create or replace function public.approve_subscription(p_subscription_id uuid)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_sub record; v_plan record; v_tenant record;
  v_period_start timestamptz; v_period_end timestamptz;
  v_cur_fields int; v_cur_staff int;
begin
  if not public.is_super_admin() then raise exception 'NOT_SUPER_ADMIN' using errcode = 'P0001'; end if;
  select * into v_sub from public.subscriptions where id = p_subscription_id for update;
  if not found then raise exception 'SUBSCRIPTION_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_sub.status <> 'pending' then raise exception 'SUBSCRIPTION_ALREADY_REVIEWED' using errcode = 'P0001'; end if;
  select * into v_plan from public.plans where id = v_sub.plan_id;
  if not found then raise exception 'PLAN_NOT_AVAILABLE' using errcode = 'P0001'; end if;
  select * into v_tenant from public.tenants where id = v_sub.tenant_id for update;

  if v_sub.kind = 'upgrade' then
    v_period_start := now();
    v_period_end   := v_tenant.subscription_ends_at;
    update public.subscriptions
      set status = 'approved', period_start = v_period_start, period_end = v_period_end,
          reviewed_by = auth.uid(), reviewed_at = now()
      where id = p_subscription_id;
    update public.tenants
      set allowed_fields = greatest(allowed_fields, coalesce(v_sub.requested_fields, allowed_fields)),
          allowed_staff  = greatest(allowed_staff,  coalesce(v_sub.requested_staff,  allowed_staff))
      where id = v_sub.tenant_id;
  else
    -- تجديد/جديد: اضبط الحدّ = المطلوب، لكن لا تنزل أبداً تحت الاستخدام الفعلي
    select count(*)::int into v_cur_fields from public.fields   where tenant_id = v_tenant.id and is_active;
    select count(*)::int into v_cur_staff  from public.profiles where tenant_id = v_tenant.id and role = 'staff';
    v_period_start := greatest(
      now(),
      coalesce(v_tenant.subscription_ends_at, '-infinity'::timestamptz),
      coalesce(v_tenant.trial_ends_at,        '-infinity'::timestamptz)
    );
    v_period_end := v_period_start + make_interval(days => v_plan.duration_days);
    update public.subscriptions
      set status = 'approved', period_start = v_period_start, period_end = v_period_end,
          reviewed_by = auth.uid(), reviewed_at = now()
      where id = p_subscription_id;
    update public.tenants
      set subscription_ends_at = v_period_end,
          subscription_status  = 'active',
          allowed_fields = greatest(coalesce(v_sub.requested_fields, allowed_fields), v_cur_fields),
          allowed_staff  = greatest(coalesce(v_sub.requested_staff,  allowed_staff),  v_cur_staff)
      where id = v_sub.tenant_id;
  end if;

  return jsonb_build_object(
    'subscription_id', p_subscription_id,
    'kind',            v_sub.kind,
    'period_start',    v_period_start,
    'period_end',      v_period_end
  );
end;
$function$;
