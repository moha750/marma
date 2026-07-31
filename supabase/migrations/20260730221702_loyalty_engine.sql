-- ═══════════════════════════════════════════════════════════════════════════
-- برنامج الولاء — المحرّك (المرحلة ١)
-- ----------------------------------------------------------------------------
-- المرجع الكامل: docs/LOYALTY-WALLET-METHODOLOGY.md
--
-- هذه الهجرة تبني برنامج الولاء عاملاً بالكامل **بلا أي طبقة محافظ**: الأختام
-- تُمنح على حجوزات حقيقية، والقسائم تُصدَر وتُصرف وتُخصم من فواتير الحجوزات.
-- طبقة Apple/Google Wallet تأتي في هجرات لاحقة وتقرأ من نفس هذه الجداول.
--
-- ثلاث قرارات تحكم كل ما يلي:
--
--  ١) «الحجز المكتمل» في هذا النظام حالة **مُشتقّة في الواجهة ولا تُخزَّن**
--     (effectiveBookingStatus في src/core/utils.js): الصف يبقى status='confirmed'
--     إلى الأبد. فالاستحقاق هنا مرآة حرفية لتلك الدالة، ولأن أحد أطرافه مرور
--     الوقت فلا يكفي تريجر — معه مكنسة مجدولة كل ١٥ دقيقة.
--
--  ٢) عدم الازدواجية من bookings.loyalty_awarded_at عبر
--     UPDATE ... WHERE loyalty_awarded_at IS NULL (ذرّي بقفل الصف)، لا من قيد
--     فريد على الدفتر — لأن التراجع عن وسم «لم يحضر» يجب أن يُعيد منح الختم،
--     وهذا ما يمنعه القيد الفريد.
--
--  ٣) بلوغ العتبة يخصم الأختام فوراً ويُصدر **قسيمة** لها رمز وحالة ولقطة من
--     قواعد البرنامج وقت الإصدار — فتغيير المالك للقواعد غداً لا يمسّ قسيمة
--     بيد عميل اليوم.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- ١) الجداول
-- ═══════════════════════════════════════════════════════════════════════════

-- برنامج واحد لكل ملعب
create table if not exists public.loyalty_programs (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null unique references public.tenants(id) on delete cascade,
  name               text not null,
  kind               text not null default 'stamps' check (kind in ('stamps','points')),
  is_active          boolean not null default false,

  -- قواعد الكسب
  earn_per_booking   numeric(10,2) not null default 1  check (earn_per_booking  > 0),
  earn_per_currency  numeric(10,4) not null default 0  check (earn_per_currency >= 0),
  min_booking_amount numeric(10,2) not null default 0  check (min_booking_amount >= 0),
  auto_enroll        boolean not null default true,
  signup_bonus       numeric(10,2) not null default 0  check (signup_bonus >= 0),

  -- المكافأة — كلها من اختيار المالك
  reward_threshold   numeric(10,2) not null default 10
                       check (reward_threshold between 2 and 50),
  reward_kind        text not null default 'free_booking' check (reward_kind in
                       ('free_booking','percent_discount','amount_discount','free_item')),
  reward_value       numeric(10,2),
  reward_max_value   numeric(10,2) check (reward_max_value is null or reward_max_value > 0),
  reward_label       text not null default 'حجز مجاني',
  reward_valid_days  integer check (reward_valid_days is null or reward_valid_days > 0),
  reward_excludes_offers boolean not null default true,
  reward_terms       text,
  points_expire_days integer check (points_expire_days is null or points_expire_days > 0),
  redeem_pin_enabled boolean not null default true,

  -- الهوية البصرية
  template    text not null default 'classic' check (template in ('classic','photo','stamps')),
  brand_bg    text not null default '#0F3D2E' check (brand_bg    ~ '^#[0-9A-Fa-f]{6}$'),
  brand_fg    text not null default '#FFFFFF' check (brand_fg    ~ '^#[0-9A-Fa-f]{6}$'),
  brand_label text not null default '#C9D6CF' check (brand_label ~ '^#[0-9A-Fa-f]{6}$'),
  logo_url text,
  hero_url text,
  icon_url text,

  google_class_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- بطاقة لكل عميل
create table if not exists public.loyalty_cards (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  program_id    uuid not null references public.loyalty_programs(id) on delete cascade,
  customer_id   uuid not null references public.customers(id) on delete cascade,

  serial        text not null unique default encode(gen_random_bytes(12),'hex'),
  balance           numeric(12,2) not null default 0,
  lifetime_earned   numeric(12,2) not null default 0,
  rewards_available integer not null default 0,
  rewards_redeemed  integer not null default 0,
  redeem_pin    text,
  status        text not null default 'active' check (status in ('active','blocked')),
  token_version integer not null default 1,

  google_object_id text,
  pass_updated_at  timestamptz not null default now(),
  last_synced_at   timestamptz,
  created_at       timestamptz not null default now(),
  unique (program_id, customer_id)
);
create index if not exists idx_loyalty_cards_tenant   on public.loyalty_cards(tenant_id, created_at desc);
create index if not exists idx_loyalty_cards_customer on public.loyalty_cards(customer_id);

-- دفتر الحركات — append-only، وهو المصدر الوحيد لصحّة الرصيد
create table if not exists public.loyalty_transactions (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  card_id    uuid not null references public.loyalty_cards(id) on delete cascade,
  delta      numeric(12,2) not null,
  reason     text not null check (reason in
               ('booking','manual','reward_issued','reward_void','expiry','adjust','signup_bonus')),
  booking_id uuid references public.bookings(id) on delete set null,
  note       text,
  created_by uuid references auth.users(id) on delete set null,
  expired_at timestamptz,          -- وُسمت كمنتهية الصلاحية في loyalty_expire_run
  created_at timestamptz not null default now()
);
create index if not exists idx_loyalty_tx_card    on public.loyalty_transactions(card_id, created_at desc);
create index if not exists idx_loyalty_tx_booking on public.loyalty_transactions(booking_id)
  where booking_id is not null;

-- القسائم — لقطة من قواعد البرنامج وقت الإصدار
create table if not exists public.loyalty_rewards (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  card_id     uuid not null references public.loyalty_cards(id) on delete cascade,
  code        text not null,
  kind        text not null check (kind in
                ('free_booking','percent_discount','amount_discount','free_item')),
  value       numeric(10,2),
  max_value   numeric(10,2),
  label       text not null,
  status      text not null default 'available'
                check (status in ('available','redeemed','expired','void')),
  issued_at   timestamptz not null default now(),
  expires_at  timestamptz,
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users(id) on delete set null,
  booking_id  uuid references public.bookings(id) on delete set null,
  unique (tenant_id, code)
);
create unique index if not exists loyalty_reward_one_per_booking
  on public.loyalty_rewards(booking_id) where booking_id is not null;
create index if not exists idx_loyalty_rewards_card on public.loyalty_rewards(card_id, status);

-- طابور المزامنة مع المحافظ — يُملأ من الآن ويُستهلك في المرحلة ٤
create table if not exists public.wallet_sync_queue (
  id         bigserial primary key,
  card_id    uuid not null references public.loyalty_cards(id) on delete cascade,
  target     text not null check (target in ('apple','google')),
  attempts   integer not null default 0,
  last_error text,
  done_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_wallet_sync_pending
  on public.wallet_sync_queue(created_at) where done_at is null;


-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) توسعة الجداول القائمة
-- ═══════════════════════════════════════════════════════════════════════════

-- loyalty_awarded_at: مفتاح عدم الازدواجية (انظر القرار ٢ أعلاه)
alter table public.bookings
  add column if not exists loyalty_reward_id  uuid
    references public.loyalty_rewards(id) on delete set null,
  add column if not exists discount_amount    numeric(10,2) not null default 0,
  add column if not exists loyalty_awarded_at timestamptz;

create index if not exists idx_bookings_loyalty_pending
  on public.bookings(end_time) where loyalty_awarded_at is null and customer_id is not null;

-- سجل الموافقة على البرنامج
alter table public.customers
  add column if not exists loyalty_consent_at  timestamptz,
  add column if not exists loyalty_consent_src text,
  add column if not exists loyalty_consent_ver text,
  add column if not exists loyalty_opt_out_at  timestamptz;

-- حدود الخطة — الميزة حصرية للخطة الأعلى
alter table public.plans
  add column if not exists loyalty_included boolean not null default false;

alter table public.tenants
  add column if not exists loyalty_enabled       boolean not null default false,
  add column if not exists allowed_loyalty_cards integer not null default 0;


-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) RLS — القراءة داخل الملعب فقط، وكل كتابة تمرّ عبر RPC
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.loyalty_programs     enable row level security;
alter table public.loyalty_cards        enable row level security;
alter table public.loyalty_transactions enable row level security;
alter table public.loyalty_rewards      enable row level security;
alter table public.wallet_sync_queue    enable row level security;

drop policy if exists "loyalty_programs_select_own_tenant" on public.loyalty_programs;
create policy "loyalty_programs_select_own_tenant"
  on public.loyalty_programs for select to authenticated
  using (tenant_id = public.get_my_tenant_id());

drop policy if exists "loyalty_cards_select_own_tenant" on public.loyalty_cards;
create policy "loyalty_cards_select_own_tenant"
  on public.loyalty_cards for select to authenticated
  using (tenant_id = public.get_my_tenant_id());

drop policy if exists "loyalty_tx_select_own_tenant" on public.loyalty_transactions;
create policy "loyalty_tx_select_own_tenant"
  on public.loyalty_transactions for select to authenticated
  using (tenant_id = public.get_my_tenant_id());

drop policy if exists "loyalty_rewards_select_own_tenant" on public.loyalty_rewards;
create policy "loyalty_rewards_select_own_tenant"
  on public.loyalty_rewards for select to authenticated
  using (tenant_id = public.get_my_tenant_id());

-- wallet_sync_queue: بلا أي سياسة عمداً ⇒ service_role فقط


-- ═══════════════════════════════════════════════════════════════════════════
-- ٤) دوال مساعدة
-- ═══════════════════════════════════════════════════════════════════════════

-- رمز قسيمة من ٦ خانات بأبجدية بلا أحرف ملتبسة (0/O و1/I مستبعدة)
create or replace function public.loyalty_gen_code(p_tenant_id uuid)
returns text language plpgsql volatile security definer set search_path to 'public' as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_code text;
  v_try  int := 0;
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (
      select 1 from loyalty_rewards where tenant_id = p_tenant_id and code = v_code);
    v_try := v_try + 1;
    if v_try > 40 then
      raise exception 'تعذّر توليد رمز قسيمة' using errcode = 'P0001';
    end if;
  end loop;
  return v_code;
end $$;

-- تسمية المكافأة تلقائياً من نوعها وقيمتها
create or replace function public.loyalty_reward_label(
  p_kind text, p_value numeric, p_custom text
) returns text language sql immutable as $$
  select case
    when nullif(btrim(coalesce(p_custom,'')),'') is not null then btrim(p_custom)
    when p_kind = 'free_booking' and p_value is null then 'حجز مجاني'
    when p_kind = 'free_booking'      then 'حجز مجاني ' || trim(to_char(p_value,'FM999')) || ' دقيقة'
    when p_kind = 'percent_discount'  then 'خصم ' || trim(to_char(p_value,'FM999')) || '٪'
    when p_kind = 'amount_discount'   then 'خصم ' || trim(to_char(p_value,'FM999999.99')) || ' ريال'
    else 'مكافأة'
  end
$$;

-- قيمة الخصم بالريال. free_booking يُحتسب تناسبياً مع مدة الحجز:
-- «حجز مجاني ٦٠ دقيقة» على حجز ١٢٠ دقيقة = نصف السعر، لا كلّه.
create or replace function public.loyalty_discount_for(
  p_kind text, p_value numeric, p_max numeric,
  p_total numeric, p_duration_min numeric
) returns numeric language sql immutable as $$
  select case
    when p_total is null or p_total <= 0 then 0
    else least(
      case
        when p_kind = 'free_booking' then
          case when p_value is null or p_duration_min is null or p_duration_min <= 0
               then p_total
               else round(p_total * least(p_value, p_duration_min) / p_duration_min, 2) end
        when p_kind = 'percent_discount' then round(p_total * coalesce(p_value,0) / 100.0, 2)
        when p_kind = 'amount_discount'  then coalesce(p_value,0)
        else 0
      end,
      p_total,
      coalesce(p_max, p_total)
    )
  end
$$;

-- هل على فترة هذا الحجز عرض سعري نشط؟ (نفس منطق المطابقة في resolve_offer_price)
create or replace function public.loyalty_slot_has_offer(
  p_tenant_id uuid, p_field_id uuid, p_slot_start timestamptz
) returns boolean
language sql stable security definer
set search_path to 'public' set "TimeZone" to 'Asia/Riyadh' as $$
  select exists (
    select 1 from public.field_offers o
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
  )
$$;

-- خطّاف مزامنة المحافظ. في المرحلة ١ لا شيء يستهلك الطابور بعد؛ تُستبدل هذه
-- الدالة في المرحلة ٤ بنداء pg_net إلى wallet-sync دون لمس أي تريجر.
create or replace function public.loyalty_notify_sync(p_card_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.wallet_sync_queue(card_id, target)
  values (p_card_id, 'apple'), (p_card_id, 'google');
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- ٥) المحرّك — الاستحقاق، الإسناد، السحب، إصدار القسائم
-- ═══════════════════════════════════════════════════════════════════════════

-- مرآة حرفية لـ effectiveBookingStatus في src/core/utils.js
-- total_price = NULL يعني «السعر عند التواصل» ⇒ ماليّته غير محسومة ⇒ لا يُكافأ.
create or replace function public.loyalty_booking_qualifies(
  p_status text, p_no_show_at timestamptz, p_end_time timestamptz,
  p_total numeric, p_paid numeric
) returns boolean language sql stable as $$
  select p_status = 'confirmed'
     and p_no_show_at is null
     and p_end_time < now()
     and p_total is not null
     and (p_total <= 0 or coalesce(p_paid,0) >= p_total)
$$;

-- تطبيق كل حركة على الرصيد + إصدار القسائم عند بلوغ العتبة
create or replace function public.tg_loyalty_apply_tx()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_prog record; v_balance numeric;
begin
  select p.* into v_prog
    from loyalty_programs p
    join loyalty_cards c on c.program_id = p.id
   where c.id = new.card_id;

  update loyalty_cards set
    balance         = balance + new.delta,
    lifetime_earned = lifetime_earned + greatest(new.delta, 0),
    pass_updated_at = now()
  where id = new.card_id
  returning balance into v_balance;

  -- الإصدار التلقائي. الحركتان reward_issued (خصم عند الإصدار) و reward_void
  -- (إرجاع عند إلغاء قسيمة) تتخطّيان فحص العتبة — وإلا لأعاد الإرجاعُ الإصدارَ
  -- فوراً فتدور الحلقة بلا طائل.
  if new.reason not in ('reward_issued','reward_void') and v_prog.id is not null then
    while v_balance >= v_prog.reward_threshold loop
      insert into loyalty_rewards(tenant_id, card_id, code, kind, value, max_value,
                                  label, expires_at)
      values (new.tenant_id, new.card_id, public.loyalty_gen_code(new.tenant_id),
              v_prog.reward_kind, v_prog.reward_value, v_prog.reward_max_value,
              v_prog.reward_label,
              case when v_prog.reward_valid_days is null then null
                   else now() + make_interval(days => v_prog.reward_valid_days) end);

      insert into loyalty_transactions(tenant_id, card_id, delta, reason, note)
      values (new.tenant_id, new.card_id, -v_prog.reward_threshold,
              'reward_issued', v_prog.reward_label);

      select balance into v_balance from loyalty_cards where id = new.card_id;
    end loop;
  end if;

  perform public.loyalty_notify_sync(new.card_id);
  return null;
end $$;

drop trigger if exists trg_loyalty_apply_tx on public.loyalty_transactions;
create trigger trg_loyalty_apply_tx
  after insert on public.loyalty_transactions
  for each row execute function public.tg_loyalty_apply_tx();

-- عدّادات القسائم على البطاقة
create or replace function public.tg_loyalty_count_rewards()
returns trigger language plpgsql security definer set search_path to 'public' as $$
-- التريجر AFTER INSERT OR UPDATE فقط (بلا DELETE) ⇒ NEW موجود دائماً.
-- قراءة OLD هنا كانت ستنفجر على INSERT بـ «record old is not assigned yet».
declare v_card uuid := new.card_id;
begin
  update loyalty_cards c set
    rewards_available = (select count(*) from loyalty_rewards r
                          where r.card_id = c.id and r.status = 'available'),
    rewards_redeemed  = (select count(*) from loyalty_rewards r
                          where r.card_id = c.id and r.status = 'redeemed'),
    pass_updated_at   = now()
  where c.id = v_card;
  perform public.loyalty_notify_sync(v_card);
  return null;
end $$;

drop trigger if exists trg_loyalty_count_rewards on public.loyalty_rewards;
create trigger trg_loyalty_count_rewards
  after insert or update of status on public.loyalty_rewards
  for each row execute function public.tg_loyalty_count_rewards();

-- إنشاء بطاقة — النسخة الداخلية بلا فحص هوية المستدعي.
-- يستدعيها التريجر والمكنسة حيث لا يوجد auth.uid() أصلاً؛ ولذلك هي **محظورة**
-- على anon/authenticated (انظر قسم الصلاحيات) والمدخل العام هو loyalty_enroll.
create or replace function public.loyalty_enroll_internal(p_customer_id uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_cust record; v_prog record; v_tenant record; v_count int; v_card_id uuid;
begin
  select * into v_cust from customers where id = p_customer_id;
  if not found then
    raise exception 'العميل غير موجود' using errcode = 'P0001';
  end if;
  if v_cust.loyalty_opt_out_at is not null then
    raise exception 'العميل ألغى اشتراكه في برنامج الولاء' using errcode = 'P0001';
  end if;

  select * into v_tenant from tenants where id = v_cust.tenant_id;
  if not coalesce(v_tenant.loyalty_enabled, false) then
    raise exception 'LOYALTY_NOT_IN_PLAN' using errcode = 'P0001';
  end if;

  select * into v_prog from loyalty_programs where tenant_id = v_cust.tenant_id;
  if not found then
    raise exception 'لا يوجد برنامج ولاء لهذا الملعب' using errcode = 'P0001';
  end if;

  select id into v_card_id from loyalty_cards
   where program_id = v_prog.id and customer_id = p_customer_id;
  if v_card_id is not null then return v_card_id; end if;

  select count(*) into v_count from loyalty_cards where tenant_id = v_cust.tenant_id;
  if v_count >= coalesce(v_tenant.allowed_loyalty_cards, 0) then
    raise exception 'LOYALTY_CARD_LIMIT_REACHED' using errcode = 'P0001';
  end if;

  insert into loyalty_cards(tenant_id, program_id, customer_id, redeem_pin)
  values (v_cust.tenant_id, v_prog.id, p_customer_id,
          lpad((floor(random() * 10000))::int::text, 4, '0'))
  returning id into v_card_id;

  if v_prog.signup_bonus > 0 then
    insert into loyalty_transactions(tenant_id, card_id, delta, reason, note)
    values (v_cust.tenant_id, v_card_id, v_prog.signup_bonus, 'signup_bonus', 'مكافأة انضمام');
  end if;

  return v_card_id;
end $$;

-- المدخل العام: يفرض أن العميل من ملعب المستدعي قبل أي شيء.
-- بدون هذا الفحص يستطيع أي مستخدم مصدَّق إنشاء بطاقة لعميل ملعب آخر.
create or replace function public.loyalty_enroll(p_customer_id uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_tenant uuid;
begin
  v_tenant := public.get_my_tenant_id();
  if v_tenant is null then raise exception 'غير مصرّح' using errcode = 'P0001'; end if;
  if not public.is_my_tenant_active() then
    raise exception 'TENANT_INACTIVE' using errcode = 'P0001';
  end if;
  if not exists (select 1 from customers
                  where id = p_customer_id and tenant_id = v_tenant) then
    raise exception 'العميل غير موجود' using errcode = 'P0001';
  end if;
  return public.loyalty_enroll_internal(p_customer_id);
end $$;

-- روتين الإسناد الوحيد — يستدعيه التريجر والمكنسة معاً
create or replace function public.loyalty_award_booking(p_booking_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_b record; v_prog record; v_card_id uuid; v_delta numeric; v_updated int;
begin
  select * into v_b from bookings where id = p_booking_id for update;
  if not found or v_b.customer_id is null then return; end if;
  if v_b.loyalty_awarded_at is not null then return; end if;
  if not public.loyalty_booking_qualifies(v_b.status, v_b.no_show_at, v_b.end_time,
                                          v_b.total_price, v_b.paid_amount) then
    return;
  end if;

  select * into v_prog from loyalty_programs
   where tenant_id = v_b.tenant_id and is_active;
  if not found then return; end if;
  if coalesce(v_b.total_price, 0) < v_prog.min_booking_amount then return; end if;

  select id into v_card_id from loyalty_cards
   where program_id = v_prog.id and customer_id = v_b.customer_id;
  if v_card_id is null then
    if not v_prog.auto_enroll then return; end if;
    begin
      v_card_id := public.loyalty_enroll_internal(v_b.customer_id);
    exception when others then
      -- حد الخطة أو إلغاء اشتراك العميل: لا نُفشل تعديل الحجز أبداً
      raise warning 'loyalty_award_booking: enroll skipped (%)', sqlerrm;
      return;
    end;
  end if;

  v_delta := case v_prog.kind when 'points'
               then round(coalesce(v_b.total_price,0) * v_prog.earn_per_currency, 2)
               else v_prog.earn_per_booking end;
  if v_delta <= 0 then return; end if;

  update bookings set loyalty_awarded_at = now()
   where id = p_booking_id and loyalty_awarded_at is null;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then return; end if;   -- سبقنا أحد

  insert into loyalty_transactions(tenant_id, card_id, delta, reason, booking_id)
  values (v_b.tenant_id, v_card_id, v_delta, 'booking', p_booking_id);
end $$;

-- السحب عند فقدان الاستحقاق.
-- ★ المشكلة التي يحلّها: لو تحوّلت الأختام إلى قسيمة قبل السحب، فطرحها يترك
--   رصيداً سالباً على بطاقة في جيب العميل («-١ / ١٠»). فقبل الطرح نُلغي قسيمة
--   **غير مصروفة** ونُعيد أختامها بحركة reward_void. وإن كانت القسيمة صُرفت
--   فعلاً فالرصيد السالب هو السجل الأمين — ويُعرض صفراً في الواجهة.
create or replace function public.loyalty_revoke_booking(p_booking_id uuid, p_note text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_tx record; v_updated int; v_bal numeric; v_thr numeric; v_rid uuid;
begin
  update bookings set loyalty_awarded_at = null
   where id = p_booking_id and loyalty_awarded_at is not null;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then return; end if;

  select * into v_tx from loyalty_transactions
   where booking_id = p_booking_id and reason = 'booking'
   order by created_at desc limit 1;
  if not found then return; end if;

  select c.balance, p.reward_threshold into v_bal, v_thr
    from loyalty_cards c
    join loyalty_programs p on p.id = c.program_id
   where c.id = v_tx.card_id;

  while v_bal - v_tx.delta < 0 loop
    select id into v_rid from loyalty_rewards
     where card_id = v_tx.card_id and status = 'available'
     order by issued_at desc limit 1;
    exit when v_rid is null;

    update loyalty_rewards set status = 'void' where id = v_rid;
    insert into loyalty_transactions(tenant_id, card_id, delta, reason, note)
    values (v_tx.tenant_id, v_tx.card_id, v_thr, 'reward_void', 'إلغاء قسيمة إثر سحب أختام');

    select balance into v_bal from loyalty_cards where id = v_tx.card_id;
    v_rid := null;
  end loop;

  insert into loyalty_transactions(tenant_id, card_id, delta, reason, booking_id, note)
  values (v_tx.tenant_id, v_tx.card_id, -v_tx.delta, 'adjust', p_booking_id, p_note);
end $$;

-- التريجر: يلتقط تغيّر الدفع/الحالة/الغياب/الوقت/السعر
create or replace function public.tg_loyalty_booking_change()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.customer_id is null then return null; end if;

  if public.loyalty_booking_qualifies(new.status, new.no_show_at, new.end_time,
                                      new.total_price, new.paid_amount) then
    perform public.loyalty_award_booking(new.id);
  elsif new.loyalty_awarded_at is not null then
    perform public.loyalty_revoke_booking(new.id,
      case when new.no_show_at is not null then 'سحب ختم: وُسم بالغياب'
           when new.status = 'cancelled'   then 'سحب ختم: أُلغي الحجز'
           else 'سحب ختم: لم يعد مستوفياً للشرط' end);
  end if;
  return null;
end $$;

drop trigger if exists trg_loyalty_booking_change on public.bookings;
create trigger trg_loyalty_booking_change
  after insert or update of status, paid_amount, no_show_at, end_time, total_price
  on public.bookings
  for each row execute function public.tg_loyalty_booking_change();

-- المكنسة — الطرف الذي لا يُحدِثه أحد: مرور الوقت.
-- حجز مدفوع مسبقاً ينتهي وقته دون أي UPDATE ⇒ لا تريجر ⇒ تلتقطه هذه.
create or replace function public.loyalty_award_sweep()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_count int := 0;
begin
  for v_id in
    select b.id from bookings b
     join loyalty_programs p on p.tenant_id = b.tenant_id and p.is_active
    where b.loyalty_awarded_at is null
      and b.customer_id is not null
      and b.end_time < now()
      and b.end_time > now() - interval '30 days'
      and public.loyalty_booking_qualifies(b.status, b.no_show_at, b.end_time,
                                           b.total_price, b.paid_amount)
    order by b.end_time
    limit 500
  loop
    perform public.loyalty_award_booking(v_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- انتهاء صلاحية القسائم والأختام
-- الأختام تُوسم بـ expired_at على حركة الكسب نفسها (لا مطابقة هشّة بالنص)،
-- والخصم مقيَّد بالرصيد الحالي: أختام صُرفت في قسيمة سابقة لا تُخصم مرتين.
create or replace function public.loyalty_expire_run()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare r record; v_due numeric; v_amount numeric; v_count int := 0;
begin
  update loyalty_rewards set status = 'expired'
   where status = 'available' and expires_at is not null and expires_at < now();
  get diagnostics v_count = row_count;

  for r in
    select c.id as card_id, c.tenant_id, c.balance, p.points_expire_days
      from loyalty_cards c
      join loyalty_programs p on p.id = c.program_id
     where p.points_expire_days is not null and c.balance > 0
  loop
    select coalesce(sum(t.delta), 0) into v_due
      from loyalty_transactions t
     where t.card_id = r.card_id and t.delta > 0 and t.expired_at is null
       and t.reason in ('booking','manual','signup_bonus')
       and t.created_at < now() - make_interval(days => r.points_expire_days);

    continue when v_due <= 0;

    update loyalty_transactions set expired_at = now()
     where card_id = r.card_id and delta > 0 and expired_at is null
       and reason in ('booking','manual','signup_bonus')
       and created_at < now() - make_interval(days => r.points_expire_days);

    v_amount := least(v_due, r.balance);
    if v_amount > 0 then
      insert into loyalty_transactions(tenant_id, card_id, delta, reason, note)
      values (r.tenant_id, r.card_id, -v_amount, 'expiry', 'انتهاء صلاحية أختام');
    end if;
  end loop;

  return v_count;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- ٦) واجهة RPC للوحة
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.loyalty_get_program()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_tenant uuid; v_prog record; v_stats jsonb;
begin
  v_tenant := public.get_my_tenant_id();
  if v_tenant is null then raise exception 'غير مصرّح' using errcode = 'P0001'; end if;

  select * into v_prog from loyalty_programs where tenant_id = v_tenant;

  select jsonb_build_object(
    'cards',             (select count(*) from loyalty_cards where tenant_id = v_tenant),
    'active_cards',      (select count(*) from loyalty_cards
                           where tenant_id = v_tenant and status = 'active'),
    'rewards_available', (select count(*) from loyalty_rewards
                           where tenant_id = v_tenant and status = 'available'),
    'rewards_redeemed',  (select count(*) from loyalty_rewards
                           where tenant_id = v_tenant and status = 'redeemed'),
    'stamps_30d',        (select coalesce(sum(delta),0) from loyalty_transactions
                           where tenant_id = v_tenant and reason = 'booking'
                             and created_at > now() - interval '30 days'),
    'discount_30d',      (select coalesce(sum(b.discount_amount),0) from bookings b
                           where b.tenant_id = v_tenant
                             and b.loyalty_reward_id is not null
                             and b.created_at > now() - interval '30 days')
  ) into v_stats;

  return jsonb_build_object(
    'enabled', (select loyalty_enabled from tenants where id = v_tenant),
    'allowed_cards', (select allowed_loyalty_cards from tenants where id = v_tenant),
    'program', case when v_prog.id is null then null else to_jsonb(v_prog) end,
    'stats',   v_stats
  );
end $$;

create or replace function public.loyalty_upsert_program(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_tenant uuid;
  v_kind text; v_rkind text; v_value numeric; v_label text; v_threshold numeric;
begin
  v_tenant := public.get_my_tenant_id();
  if v_tenant is null then raise exception 'غير مصرّح' using errcode = 'P0001'; end if;
  if not public.is_owner() then
    raise exception 'هذه العملية متاحة للمالك فقط' using errcode = 'P0001';
  end if;
  if not public.is_my_tenant_active() then
    raise exception 'TENANT_INACTIVE' using errcode = 'P0001';
  end if;
  if not (select loyalty_enabled from tenants where id = v_tenant) then
    raise exception 'LOYALTY_NOT_IN_PLAN' using errcode = 'P0001';
  end if;

  v_kind      := coalesce(p->>'kind', 'stamps');
  v_rkind     := coalesce(p->>'reward_kind', 'free_booking');
  v_value     := nullif(p->>'reward_value','')::numeric;
  v_threshold := coalesce(nullif(p->>'reward_threshold','')::numeric, 10);

  if v_threshold < 2 or v_threshold > 50 then
    raise exception 'عدد الأختام يجب أن يكون بين ٢ و ٥٠' using errcode = 'P0001';
  end if;

  if v_rkind = 'percent_discount' and (v_value is null or v_value < 5 or v_value > 100) then
    raise exception 'نسبة الخصم يجب أن تكون بين ٥٪ و ١٠٠٪' using errcode = 'P0001';
  end if;
  if v_rkind = 'amount_discount' and (v_value is null or v_value <= 0) then
    raise exception 'مبلغ الخصم يجب أن يكون أكبر من صفر' using errcode = 'P0001';
  end if;
  if v_rkind = 'free_booking' and v_value is not null and (v_value < 15 or v_value > 300) then
    raise exception 'المدة المجانية يجب أن تكون بين ١٥ و ٣٠٠ دقيقة' using errcode = 'P0001';
  end if;
  if v_rkind = 'free_item' and nullif(btrim(coalesce(p->>'reward_label','')),'') is null then
    raise exception 'اكتب وصف المكافأة العينية' using errcode = 'P0001';
  end if;

  v_label := public.loyalty_reward_label(v_rkind, v_value, p->>'reward_label');

  insert into loyalty_programs as lp (
    tenant_id, name, kind, is_active,
    earn_per_booking, earn_per_currency, min_booking_amount, auto_enroll, signup_bonus,
    reward_threshold, reward_kind, reward_value, reward_max_value, reward_label,
    reward_valid_days, reward_excludes_offers, reward_terms,
    points_expire_days, redeem_pin_enabled,
    template, brand_bg, brand_fg, brand_label, logo_url, hero_url, icon_url
  ) values (
    v_tenant,
    coalesce(nullif(btrim(p->>'name'),''), 'بطاقة الولاء'),
    v_kind,
    coalesce((p->>'is_active')::boolean, false),
    coalesce(nullif(p->>'earn_per_booking','')::numeric, 1),
    coalesce(nullif(p->>'earn_per_currency','')::numeric, 0),
    coalesce(nullif(p->>'min_booking_amount','')::numeric, 0),
    coalesce((p->>'auto_enroll')::boolean, true),
    coalesce(nullif(p->>'signup_bonus','')::numeric, 0),
    v_threshold, v_rkind, v_value,
    nullif(p->>'reward_max_value','')::numeric,
    v_label,
    nullif(p->>'reward_valid_days','')::int,
    coalesce((p->>'reward_excludes_offers')::boolean, true),
    nullif(btrim(p->>'reward_terms'),''),
    nullif(p->>'points_expire_days','')::int,
    coalesce((p->>'redeem_pin_enabled')::boolean, true),
    coalesce(nullif(p->>'template',''), 'classic'),
    coalesce(nullif(p->>'brand_bg',''),    '#0F3D2E'),
    coalesce(nullif(p->>'brand_fg',''),    '#FFFFFF'),
    coalesce(nullif(p->>'brand_label',''), '#C9D6CF'),
    nullif(btrim(p->>'logo_url'),''),
    nullif(btrim(p->>'hero_url'),''),
    nullif(btrim(p->>'icon_url'),'')
  )
  on conflict (tenant_id) do update set
    name = excluded.name, kind = excluded.kind, is_active = excluded.is_active,
    earn_per_booking = excluded.earn_per_booking,
    earn_per_currency = excluded.earn_per_currency,
    min_booking_amount = excluded.min_booking_amount,
    auto_enroll = excluded.auto_enroll, signup_bonus = excluded.signup_bonus,
    reward_threshold = excluded.reward_threshold, reward_kind = excluded.reward_kind,
    reward_value = excluded.reward_value, reward_max_value = excluded.reward_max_value,
    reward_label = excluded.reward_label, reward_valid_days = excluded.reward_valid_days,
    reward_excludes_offers = excluded.reward_excludes_offers,
    reward_terms = excluded.reward_terms,
    points_expire_days = excluded.points_expire_days,
    redeem_pin_enabled = excluded.redeem_pin_enabled,
    template = excluded.template, brand_bg = excluded.brand_bg,
    brand_fg = excluded.brand_fg, brand_label = excluded.brand_label,
    logo_url = excluded.logo_url, hero_url = excluded.hero_url, icon_url = excluded.icon_url,
    updated_at = now();

  return public.loyalty_get_program();
end $$;

create or replace function public.loyalty_list_cards(
  p_search text default null, p_limit int default 50, p_offset int default 0
) returns table (
  id uuid, serial text, customer_id uuid, customer_name text, customer_phone text,
  balance numeric, rewards_available int, rewards_redeemed int,
  status text, created_at timestamptz
) language sql stable security definer set search_path to 'public' as $$
  select c.id, c.serial, c.customer_id, cu.full_name, cu.phone,
         c.balance, c.rewards_available, c.rewards_redeemed, c.status, c.created_at
  from loyalty_cards c
  join customers cu on cu.id = c.customer_id
  where c.tenant_id = public.get_my_tenant_id()
    and (p_search is null or btrim(p_search) = ''
         or cu.full_name ilike '%' || btrim(p_search) || '%'
         or cu.phone     ilike '%' || btrim(p_search) || '%'
         or c.serial     ilike btrim(p_search) || '%')
  order by c.created_at desc
  limit greatest(1, least(coalesce(p_limit,50), 200))
  offset greatest(0, coalesce(p_offset,0));
$$;

create or replace function public.loyalty_card_detail(p_card_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_tenant uuid; v_card record;
begin
  v_tenant := public.get_my_tenant_id();
  select * into v_card from loyalty_cards where id = p_card_id and tenant_id = v_tenant;
  if not found then raise exception 'البطاقة غير موجودة' using errcode = 'P0001'; end if;

  return jsonb_build_object(
    'card',     to_jsonb(v_card),
    'customer', (select to_jsonb(cu) from customers cu where cu.id = v_card.customer_id),
    'rewards',  (select coalesce(jsonb_agg(to_jsonb(r) order by r.issued_at desc), '[]'::jsonb)
                   from loyalty_rewards r where r.card_id = p_card_id),
    'transactions', (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb)
                   from (select * from loyalty_transactions
                          where card_id = p_card_id
                          order by created_at desc limit 50) t)
  );
end $$;

-- بحث الماسح: يقبل السيريال كاملاً أو حمولة QR كاملة (MRM1:serial:sig)
-- التحقّق من توقيع HMAC يُضاف مع طبقة المحافظ (المرحلة ٣).
create or replace function public.loyalty_scan_lookup(p_payload text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_tenant uuid; v_serial text; v_card record; v_matches int;
begin
  v_tenant := public.get_my_tenant_id();
  if v_tenant is null then raise exception 'غير مصرّح' using errcode = 'P0001'; end if;

  v_serial := lower(btrim(coalesce(p_payload, '')));
  if v_serial like 'mrm1:%' then
    v_serial := split_part(v_serial, ':', 2);
  end if;
  if length(v_serial) < 6 then
    raise exception 'أدخل ٦ خانات على الأقل من رمز البطاقة' using errcode = 'P0001';
  end if;

  -- بحث بالبادئة يقبل الإدخال اليدوي المختصر، ويرفض الالتباس بدل التخمين
  select count(*) into v_matches from loyalty_cards
   where tenant_id = v_tenant and serial like v_serial || '%';
  if v_matches = 0 then
    raise exception 'لا توجد بطاقة بهذا الرمز' using errcode = 'P0001';
  elsif v_matches > 1 then
    raise exception 'أكثر من بطاقة تطابق هذا الرمز — أدخل خانات أكثر' using errcode = 'P0001';
  end if;

  select * into v_card from loyalty_cards
   where tenant_id = v_tenant and serial like v_serial || '%';

  return public.loyalty_card_detail(v_card.id);
end $$;

create or replace function public.loyalty_adjust(
  p_card_id uuid, p_delta numeric, p_note text default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_tenant uuid; v_card record;
begin
  v_tenant := public.get_my_tenant_id();
  if v_tenant is null then raise exception 'غير مصرّح' using errcode = 'P0001'; end if;
  if not public.is_owner() then
    raise exception 'تعديل الأختام متاح للمالك فقط' using errcode = 'P0001';
  end if;
  if not public.is_my_tenant_active() then
    raise exception 'TENANT_INACTIVE' using errcode = 'P0001';
  end if;
  if p_delta is null or p_delta = 0 then
    raise exception 'أدخل قيمة تعديل' using errcode = 'P0001';
  end if;

  select * into v_card from loyalty_cards where id = p_card_id and tenant_id = v_tenant;
  if not found then raise exception 'البطاقة غير موجودة' using errcode = 'P0001'; end if;
  if v_card.balance + p_delta < 0 then
    raise exception 'الرصيد لا يكفي لهذا الخصم' using errcode = 'P0001';
  end if;

  insert into loyalty_transactions(tenant_id, card_id, delta, reason, note, created_by)
  values (v_tenant, p_card_id, p_delta, 'manual', nullif(btrim(p_note),''), auth.uid());

  return public.loyalty_card_detail(p_card_id);
end $$;

-- ربط قسيمة بحجز واحتساب الخصم
create or replace function public.loyalty_apply_reward(
  p_code text, p_booking_id uuid, p_pin text default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_tenant uuid; v_r record; v_b record; v_card record; v_prog record;
  v_duration numeric; v_discount numeric; v_new_total numeric;
begin
  v_tenant := public.get_my_tenant_id();
  if v_tenant is null then raise exception 'غير مصرّح' using errcode = 'P0001'; end if;
  if not public.is_my_tenant_active() then
    raise exception 'TENANT_INACTIVE' using errcode = 'P0001';
  end if;

  select * into v_r from loyalty_rewards
   where tenant_id = v_tenant and code = upper(btrim(p_code)) for update;
  if not found then raise exception 'لا توجد قسيمة بهذا الرمز' using errcode = 'P0001'; end if;
  if v_r.status <> 'available' then
    raise exception 'هذه القسيمة % بالفعل',
      case v_r.status when 'redeemed' then 'مصروفة' when 'expired' then 'منتهية'
                      else 'ملغاة' end using errcode = 'P0001';
  end if;
  if v_r.expires_at is not null and v_r.expires_at < now() then
    raise exception 'انتهت صلاحية هذه القسيمة' using errcode = 'P0001';
  end if;
  if v_r.kind = 'free_item' then
    raise exception 'هذه مكافأة عينية — استخدم زر الصرف المباشر' using errcode = 'P0001';
  end if;

  select * into v_card from loyalty_cards where id = v_r.card_id;
  select * into v_prog from loyalty_programs where tenant_id = v_tenant;

  if v_prog.redeem_pin_enabled and v_card.redeem_pin is not null
     and coalesce(btrim(p_pin),'') <> v_card.redeem_pin then
    raise exception 'رمز الاستبدال غير صحيح' using errcode = 'P0001';
  end if;

  select * into v_b from bookings where id = p_booking_id and tenant_id = v_tenant for update;
  if not found then raise exception 'الحجز غير موجود' using errcode = 'P0001'; end if;
  if v_b.customer_id is distinct from v_card.customer_id then
    raise exception 'هذه البطاقة تخصّ عميلاً آخر' using errcode = 'P0001';
  end if;
  if v_b.loyalty_reward_id is not null then
    raise exception 'هذا الحجز عليه مكافأة مطبّقة أصلاً' using errcode = 'P0001';
  end if;
  if v_b.status = 'cancelled' or v_b.no_show_at is not null then
    raise exception 'لا يمكن تطبيق مكافأة على حجز ملغي أو موسوم بالغياب' using errcode = 'P0001';
  end if;
  if v_b.total_price is null then
    raise exception 'سعر الحجز غير محدّد بعد' using errcode = 'P0001';
  end if;
  if v_prog.reward_excludes_offers
     and public.loyalty_slot_has_offer(v_tenant, v_b.field_id, v_b.start_time) then
    raise exception 'لا تُجمع المكافأة مع عرض سعري على نفس الفترة' using errcode = 'P0001';
  end if;

  v_duration := extract(epoch from (v_b.end_time - v_b.start_time)) / 60.0;
  v_discount := public.loyalty_discount_for(v_r.kind, v_r.value, v_r.max_value,
                                            v_b.total_price, v_duration);
  v_new_total := v_b.total_price - v_discount;

  if v_new_total < coalesce(v_b.paid_amount, 0) then
    raise exception 'المبلغ المحصَّل أكبر من السعر بعد الخصم — استرد الفرق أولاً'
      using errcode = 'P0001';
  end if;

  update bookings set
    total_price       = v_new_total,
    discount_amount   = coalesce(discount_amount,0) + v_discount,
    loyalty_reward_id = v_r.id
  where id = p_booking_id;

  update loyalty_rewards set
    status = 'redeemed', redeemed_at = now(), redeemed_by = auth.uid(),
    booking_id = p_booking_id
  where id = v_r.id;

  perform public.notify_create('owner', v_tenant, 'loyalty_redeem',
    'صرف مكافأة ولاء',
    v_r.label || ' — خصم ' || trim(to_char(v_discount,'FM999999.99')) || ' ريال',
    '/loyalty/cards',
    jsonb_build_object('reward_id', v_r.id, 'card_id', v_card.id,
                       'booking_id', p_booking_id, 'discount', v_discount));

  return jsonb_build_object('discount', v_discount, 'new_total', v_new_total,
                            'reward', to_jsonb(v_r));
end $$;

-- صرف مكافأة عينية (بلا حجز)
create or replace function public.loyalty_redeem(p_code text, p_pin text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_tenant uuid; v_r record; v_card record; v_prog record;
begin
  v_tenant := public.get_my_tenant_id();
  if v_tenant is null then raise exception 'غير مصرّح' using errcode = 'P0001'; end if;
  if not public.is_my_tenant_active() then
    raise exception 'TENANT_INACTIVE' using errcode = 'P0001';
  end if;

  select * into v_r from loyalty_rewards
   where tenant_id = v_tenant and code = upper(btrim(p_code)) for update;
  if not found then raise exception 'لا توجد قسيمة بهذا الرمز' using errcode = 'P0001'; end if;
  if v_r.status <> 'available' then
    raise exception 'هذه القسيمة غير متاحة للصرف' using errcode = 'P0001';
  end if;
  if v_r.expires_at is not null and v_r.expires_at < now() then
    raise exception 'انتهت صلاحية هذه القسيمة' using errcode = 'P0001';
  end if;

  select * into v_card from loyalty_cards where id = v_r.card_id;
  select * into v_prog from loyalty_programs where tenant_id = v_tenant;
  if v_prog.redeem_pin_enabled and v_card.redeem_pin is not null
     and coalesce(btrim(p_pin),'') <> v_card.redeem_pin then
    raise exception 'رمز الاستبدال غير صحيح' using errcode = 'P0001';
  end if;

  update loyalty_rewards set
    status = 'redeemed', redeemed_at = now(), redeemed_by = auth.uid()
  where id = v_r.id;

  perform public.notify_create('owner', v_tenant, 'loyalty_redeem',
    'صرف مكافأة ولاء', v_r.label, '/loyalty/cards',
    jsonb_build_object('reward_id', v_r.id, 'card_id', v_card.id));

  return jsonb_build_object('reward', to_jsonb(v_r));
end $$;

-- إعادة قسيمة إلى المتاح (إلغاء الحجز أو تراجع الموظف)
create or replace function public.loyalty_release_reward(p_code text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_tenant uuid; v_r record; v_b record;
begin
  v_tenant := public.get_my_tenant_id();
  if v_tenant is null then raise exception 'غير مصرّح' using errcode = 'P0001'; end if;

  select * into v_r from loyalty_rewards
   where tenant_id = v_tenant and code = upper(btrim(p_code)) for update;
  if not found then raise exception 'لا توجد قسيمة بهذا الرمز' using errcode = 'P0001'; end if;
  if v_r.status <> 'redeemed' then
    raise exception 'هذه القسيمة ليست مصروفة' using errcode = 'P0001';
  end if;

  if v_r.booking_id is not null then
    select * into v_b from bookings where id = v_r.booking_id for update;
    if found then
      update bookings set
        total_price       = coalesce(v_b.total_price, 0) + coalesce(v_b.discount_amount, 0),
        discount_amount   = 0,
        loyalty_reward_id = null
      where id = v_r.booking_id;
    end if;
  end if;

  update loyalty_rewards set
    status = 'available', redeemed_at = null, redeemed_by = null, booking_id = null
  where id = v_r.id;

  return jsonb_build_object('reward', to_jsonb(v_r));
end $$;

-- إلغاء الحجز يعيد قسيمته تلقائياً ويستعيد السعر الأصلي.
-- BEFORE عمداً: التعديل على NEW مباشرة بلا UPDATE ثانٍ على نفس الجدول — فلا
-- تتداخل مع التريجرات الأخرى على bookings ولا تُطلق إشعارات زائفة.
create or replace function public.tg_loyalty_release_on_cancel()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled'
     and old.loyalty_reward_id is not null then
    update loyalty_rewards set
      status = 'available', redeemed_at = null, redeemed_by = null, booking_id = null
    where id = old.loyalty_reward_id;

    new.total_price       := coalesce(old.total_price, 0) + coalesce(old.discount_amount, 0);
    new.discount_amount   := 0;
    new.loyalty_reward_id := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_loyalty_release_on_cancel on public.bookings;
create trigger trg_loyalty_release_on_cancel
  before update of status on public.bookings
  for each row execute function public.tg_loyalty_release_on_cancel();

-- تسجيل الموافقة / الإلغاء
create or replace function public.loyalty_set_consent(
  p_customer_id uuid, p_src text, p_ver text, p_opt_out boolean default false
) returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if p_opt_out then
    update customers set loyalty_opt_out_at = now() where id = p_customer_id;
    update loyalty_cards set status = 'blocked', pass_updated_at = now()
     where customer_id = p_customer_id;
  else
    update customers set
      loyalty_consent_at  = coalesce(loyalty_consent_at, now()),
      loyalty_consent_src = coalesce(loyalty_consent_src, p_src),
      loyalty_consent_ver = coalesce(loyalty_consent_ver, p_ver),
      loyalty_opt_out_at  = null
    where id = p_customer_id;
  end if;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- ٧) الصلاحيات
-- ═══════════════════════════════════════════════════════════════════════════

-- دوال داخلية: بلا فحص هوية المستدعي ⇒ محظورة على المستخدمين تماماً
revoke all on function public.loyalty_enroll_internal(uuid)        from public, anon, authenticated;
revoke all on function public.loyalty_award_booking(uuid)          from public, anon, authenticated;
revoke all on function public.loyalty_revoke_booking(uuid, text)   from public, anon, authenticated;
revoke all on function public.loyalty_award_sweep()                from public, anon, authenticated;
revoke all on function public.loyalty_expire_run()                 from public, anon, authenticated;
revoke all on function public.loyalty_gen_code(uuid)               from public, anon, authenticated;
revoke all on function public.loyalty_notify_sync(uuid)            from public, anon, authenticated;

grant execute on function public.loyalty_enroll_internal(uuid)     to service_role;
grant execute on function public.loyalty_award_booking(uuid)       to service_role;
grant execute on function public.loyalty_revoke_booking(uuid, text) to service_role;
grant execute on function public.loyalty_award_sweep()             to service_role;
grant execute on function public.loyalty_expire_run()              to service_role;

grant execute on function public.loyalty_get_program()                       to authenticated;
grant execute on function public.loyalty_upsert_program(jsonb)               to authenticated;
grant execute on function public.loyalty_enroll(uuid)                        to authenticated;
grant execute on function public.loyalty_list_cards(text, int, int)          to authenticated;
grant execute on function public.loyalty_card_detail(uuid)                   to authenticated;
grant execute on function public.loyalty_scan_lookup(text)                   to authenticated;
grant execute on function public.loyalty_adjust(uuid, numeric, text)         to authenticated;
grant execute on function public.loyalty_apply_reward(text, uuid, text)      to authenticated;
grant execute on function public.loyalty_redeem(text, text)                  to authenticated;
grant execute on function public.loyalty_release_reward(text)                to authenticated;
grant execute on function public.loyalty_set_consent(uuid, text, text, boolean) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- ٨) الجدولة و Realtime
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  if exists (select 1 from cron.job where jobname = 'loyalty-award-sweep') then
    perform cron.unschedule('loyalty-award-sweep');
  end if;
  if exists (select 1 from cron.job where jobname = 'loyalty-expire') then
    perform cron.unschedule('loyalty-expire');
  end if;
end $$;

select cron.schedule('loyalty-award-sweep', '*/15 * * * *',
                     $$select public.loyalty_award_sweep()$$);
select cron.schedule('loyalty-expire', '0 3 * * *',
                     $$select public.loyalty_expire_run()$$);

do $$
begin
  begin alter publication supabase_realtime add table public.loyalty_cards;        exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.loyalty_transactions; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.loyalty_rewards;      exception when duplicate_object then null; end;
end $$;
