-- طلب الاشتراك بإيصال (صورة/PDF) بدل رقم تحويل نصّي غير مُثبَت.
-- 1) عمود receipt_path + جعل payment_reference اختياريًّا (توافق خلفي مع الطلبات القديمة).
-- 2) bucket خاص payment-receipts (صور + PDF، حد 5MB) + سياسات: المالك يرفع/يرى إيصاله، المشرف يرى الكل.
-- 3) تحديث request_subscription لقبول receipt_path (متوافق خلفيًّا: يقبل مرجعًا أو إيصالًا).
-- 4) قوائم العرض (المالك + المشرف) تُرجع receipt_path.

alter table public.subscriptions add column if not exists receipt_path text;
alter table public.subscriptions alter column payment_reference drop not null;

-- ── bucket خاص ─────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-receipts', 'payment-receipts', false, 5242880,
        array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── سياسات التخزين — المسار: {tenant_id}/{uuid}.{ext} ──
drop policy if exists "receipts_owner_insert" on storage.objects;
create policy "receipts_owner_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'payment-receipts'
    and (storage.foldername(name))[1] = (
      select p.tenant_id::text from public.profiles p
      where p.id = auth.uid() and p.role = 'owner'
    )
  );

drop policy if exists "receipts_owner_select" on storage.objects;
create policy "receipts_owner_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'payment-receipts'
    and (storage.foldername(name))[1] = (
      select p.tenant_id::text from public.profiles p where p.id = auth.uid()
    )
  );

drop policy if exists "receipts_admin_select" on storage.objects;
create policy "receipts_admin_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'payment-receipts' and public.is_super_admin());

drop policy if exists "receipts_owner_delete" on storage.objects;
create policy "receipts_owner_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'payment-receipts'
    and (storage.foldername(name))[1] = (
      select p.tenant_id::text from public.profiles p
      where p.id = auth.uid() and p.role = 'owner'
    )
  );

-- ── request_subscription: يقبل receipt_path (متوافق خلفيًّا) ──
drop function if exists public.request_subscription(uuid, integer, integer, text, text);
create function public.request_subscription(
  p_plan_id uuid, p_fields integer, p_staff integer,
  p_reference text default null, p_note text default null, p_receipt_path text default null
) returns uuid
 language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_tenant_id uuid := public.get_my_tenant_id();
  v_user_id   uuid := auth.uid();
  v_plan      record;
  v_clean_ref     text := btrim(coalesce(p_reference, ''));
  v_clean_receipt text := btrim(coalesce(p_receipt_path, ''));
  v_id        uuid;
  v_amount    numeric;
  v_base_price      constant numeric := 200;
  v_unit_price      constant numeric := 50;
  v_included_fields constant int     := 1;
  v_included_staff  constant int     := 1;
begin
  if v_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.is_owner() then raise exception 'NOT_OWNER' using errcode = 'P0001'; end if;
  -- دليل الدفع مطلوب: إيصال (الجديد) أو مرجع نصّي (توافق خلفي)
  if v_clean_receipt = '' and v_clean_ref = '' then
    raise exception 'PAYMENT_PROOF_REQUIRED' using errcode = 'P0001';
  end if;
  -- الإيصال يجب أن يكون ضمن مجلّد منشأة المستأجر (تحصين ضد تمرير مسار غريب)
  if v_clean_receipt <> '' and v_clean_receipt not like (v_tenant_id::text || '/%') then
    raise exception 'INVALID_RECEIPT_PATH' using errcode = 'P0001';
  end if;
  if p_fields is null or p_fields < 1 or p_staff is null or p_staff < 1 then
    raise exception 'INVALID_UNIT_COUNT' using errcode = 'P0001';
  end if;

  select id, name, duration_days, is_active into v_plan
  from public.plans where id = p_plan_id;
  if not found or not v_plan.is_active then
    raise exception 'PLAN_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.subscriptions where tenant_id = v_tenant_id and status = 'pending'
  ) then
    raise exception 'SUBSCRIPTION_PENDING_EXISTS' using errcode = 'P0001';
  end if;

  v_amount := v_base_price
            + greatest(0, p_fields - v_included_fields) * v_unit_price
            + greatest(0, p_staff  - v_included_staff)  * v_unit_price;

  insert into public.subscriptions (
    tenant_id, plan_id, status, amount, payment_reference, receipt_path, note,
    requested_fields, requested_staff, created_by
  ) values (
    v_tenant_id, p_plan_id, 'pending', v_amount,
    nullif(v_clean_ref, ''), nullif(v_clean_receipt, ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    p_fields, p_staff, v_user_id
  ) returning id into v_id;

  return v_id;
end;
$function$;

-- ── list_my_subscriptions: + receipt_path ──
drop function if exists public.list_my_subscriptions();
create function public.list_my_subscriptions()
 returns table(id uuid, status text, amount numeric, payment_reference text, receipt_path text, note text,
   period_start timestamptz, period_end timestamptz, reviewed_at timestamptz, reject_reason text,
   created_at timestamptz, plan_name text, requested_fields integer, requested_staff integer)
 language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_tenant_id uuid := public.get_my_tenant_id();
begin
  if v_tenant_id is null then return; end if;
  return query
  select s.id, s.status, s.amount, s.payment_reference, s.receipt_path, s.note,
         s.period_start, s.period_end, s.reviewed_at, s.reject_reason,
         s.created_at, p.name, s.requested_fields, s.requested_staff
  from public.subscriptions s
  join public.plans p on p.id = s.plan_id
  where s.tenant_id = v_tenant_id
  order by s.created_at desc;
end;
$function$;

-- ── admin_list_pending_subscriptions: + receipt_path ──
drop function if exists public.admin_list_pending_subscriptions();
create function public.admin_list_pending_subscriptions()
 returns table(id uuid, tenant_id uuid, tenant_name text, plan_name text, amount numeric,
   payment_reference text, receipt_path text, note text, requested_fields integer, requested_staff integer,
   created_at timestamptz)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then raise exception 'NOT_SUPER_ADMIN' using errcode = 'P0001'; end if;
  return query
  select s.id, s.tenant_id, t.name, p.name, s.amount, s.payment_reference, s.receipt_path, s.note,
         s.requested_fields, s.requested_staff, s.created_at
  from public.subscriptions s
  join public.tenants t on t.id = s.tenant_id
  join public.plans   p on p.id = s.plan_id
  where s.status = 'pending'
  order by s.created_at asc;
end;
$function$;

-- ── admin_list_subscriptions: + receipt_path ──
drop function if exists public.admin_list_subscriptions(text);
create function public.admin_list_subscriptions(p_status text default null)
 returns table(id uuid, tenant_id uuid, tenant_name text, status text, amount numeric,
   requested_fields integer, requested_staff integer, payment_reference text, receipt_path text, note text,
   period_start timestamptz, period_end timestamptz, created_at timestamptz, reviewed_at timestamptz, reject_reason text)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then raise exception 'NOT_SUPER_ADMIN' using errcode = 'P0001'; end if;
  return query
  select s.id, s.tenant_id, t.name, s.status, s.amount, s.requested_fields, s.requested_staff,
         s.payment_reference, s.receipt_path, s.note, s.period_start, s.period_end, s.created_at, s.reviewed_at, s.reject_reason
  from public.subscriptions s
  join public.tenants t on t.id = s.tenant_id
  where (p_status is null or s.status = p_status)
  order by s.created_at desc
  limit 500;
end;
$function$;
