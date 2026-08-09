-- الولاء بموافقة: البطاقة بيد العميل، والختم بيد الملعب.
--
-- النموذج قبل اليوم كان آلياً طرفيه: البطاقة تُصدَر وحدها مع أول حجز، والختم
-- يُمنح وحده عند اكتماله. والقرار الجديد يقلب الطرفين:
--
--   ١) لا تُصدَر بطاقةٌ إلا بيد العميل من موقع الحجز. من لعب ألف مباراة ولم
--      يُصدرها فلا بطاقة له ولا شيء يتراكم في الخفاء.
--   ٢) اكتمال الحجز لا يمنح ختماً — يُنشئ **طلباً معلّقاً** لا يمسّ الرصيد.
--      يوافق عليه المالك أو الموظف أو يرفضه: من الماسح، أو بالرمز، أو من
--      التبويب بعد إشعار.
--
-- ولذلك يبقى التريجر والمكنسة على حالهما: هما عين النظام على «انتهى الحجز
-- وسُدِّد»، وما تغيّر أن ثمرتهما طلبٌ لا ختم. ويبقى تريجر الرصيد والقسائم
-- بلا لمس: الموافقة تُدخل الحركة، والحركة تفعل ما كانت تفعله دائماً.

-- ═══ ١) جدول الطلبات المعلّقة ═══════════════════════════════════════════
create table if not exists public.loyalty_pending_stamps (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id)       on delete cascade,
  card_id     uuid not null references public.loyalty_cards(id) on delete cascade,
  -- حجزٌ واحد = طلبٌ واحد أبداً. القيد هو الحارس لا منطق الدالّة:
  -- التريجر والمكنسة قد يلتقيان على الحجز نفسه في اللحظة نفسها.
  booking_id  uuid not null references public.bookings(id)      on delete cascade unique,
  delta       numeric(12,2) not null default 1,
  status      text not null default 'pending'
              check (status in ('pending','approved','rejected')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  uuid references auth.users(id) on delete set null
);
create index if not exists idx_loy_pending_tenant
  on public.loyalty_pending_stamps(tenant_id, status, created_at desc);
create index if not exists idx_loy_pending_card
  on public.loyalty_pending_stamps(card_id, status);

alter table public.loyalty_pending_stamps enable row level security;

drop policy if exists "loy_pending_select_own_tenant" on public.loyalty_pending_stamps;
create policy "loy_pending_select_own_tenant"
  on public.loyalty_pending_stamps for select to authenticated
  using (tenant_id = public.get_my_tenant_id());

-- ═══ ٢) الإسناد صار طلباً ═══════════════════════════════════════════════
-- تغييران عن السابق: لا إصدار تلقائي (من لا بطاقة له يُتجاوز)، ولا حركة على
-- الرصيد (طلبٌ معلّق + إشعار). وما عداهما كما كان حرفياً.
create or replace function public.loyalty_award_booking(p_booking_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_b record; v_prog record; v_card record; v_delta numeric; v_updated int;
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

  -- لا بطاقة = لا شيء. لا إصدار تلقائي بعد اليوم مهما بلغت حجوزاته.
  select c.* into v_card from loyalty_cards c
   where c.program_id = v_prog.id and c.customer_id = v_b.customer_id
     and c.status = 'active';
  if not found then return; end if;

  v_delta := case v_prog.kind when 'points'
               then round(coalesce(v_b.total_price,0) * v_prog.earn_per_currency, 2)
               else v_prog.earn_per_booking end;
  if v_delta <= 0 then return; end if;

  -- علّم الحجز أولاً: من يفوز بالتعليم يُنشئ الطلب، ومن يخسر ينصرف
  update bookings set loyalty_awarded_at = now()
   where id = p_booking_id and loyalty_awarded_at is null;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then return; end if;

  insert into loyalty_pending_stamps(tenant_id, card_id, booking_id, delta)
  values (v_b.tenant_id, v_card.id, p_booking_id, v_delta)
  on conflict (booking_id) do nothing;

  insert into notifications(audience, tenant_id, type, title, body, link, data)
  values ('owner', v_b.tenant_id, 'loyalty_stamp_pending',
          'ختم بانتظار موافقتك',
          (select full_name from customers where id = v_b.customer_id)
            || ' أكمل حجزه — وافق على ختمه أو ارفضه',
          '/loyalty/stamps',
          jsonb_build_object('booking_id', p_booking_id, 'card_id', v_card.id));
end $$;

-- ═══ ٣) القرار: موافقة أو رفض ═══════════════════════════════════════════
-- الموافقة تُدخل الحركة، والحركة تحرّك الرصيد وتُصدر القسيمة عند العتبة
-- بتريجرات قائمة لم تُمسّ. فمسار الرصيد واحدٌ لا اثنان.
create or replace function public.loyalty_decide_stamp(p_id uuid, p_approve boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_tenant uuid; v_row record;
begin
  v_tenant := public.get_my_tenant_id();
  if v_tenant is null then raise exception 'غير مصرّح' using errcode = 'P0001'; end if;
  if not public.is_my_tenant_active() then
    raise exception 'TENANT_INACTIVE' using errcode = 'P0001';
  end if;

  select * into v_row from loyalty_pending_stamps
   where id = p_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'الطلب غير موجود' using errcode = 'P0001';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'هذا الطلب حُسم من قبل' using errcode = 'P0001';
  end if;

  update loyalty_pending_stamps set
    status     = case when p_approve then 'approved' else 'rejected' end,
    decided_at = now(),
    decided_by = auth.uid()
  where id = p_id;

  if p_approve then
    insert into loyalty_transactions(tenant_id, card_id, delta, reason, booking_id, note)
    values (v_tenant, v_row.card_id, v_row.delta, 'booking', v_row.booking_id, 'ختم بموافقة');
  end if;

  return jsonb_build_object('ok', true, 'approved', p_approve);
end $$;

-- قائمة الطلبات المعلّقة للوحة — مع ما يكفي لعرضها بلا نداءٍ ثانٍ
create or replace function public.loyalty_pending_stamps_list(p_limit int default 100)
returns table (
  id uuid, card_id uuid, serial text, customer_name text, customer_phone text,
  delta numeric, balance numeric, threshold numeric,
  booking_id uuid, booking_start timestamptz, field_name text, created_at timestamptz
) language sql stable security definer set search_path to 'public' as $$
  select ps.id, ps.card_id, c.serial, cu.full_name, cu.phone,
         ps.delta, c.balance, p.reward_threshold,
         ps.booking_id, b.start_time, f.name, ps.created_at
    from loyalty_pending_stamps ps
    join loyalty_cards    c  on c.id  = ps.card_id
    join customers        cu on cu.id = c.customer_id
    join loyalty_programs p  on p.id  = c.program_id
    join bookings         b  on b.id  = ps.booking_id
    join fields           f  on f.id  = b.field_id
   where ps.tenant_id = public.get_my_tenant_id()
     and ps.status = 'pending'
   order by ps.created_at
   limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

-- ═══ ٤) الإصدار الذاتي من موقع الحجز ════════════════════════════════════
-- يُعيد إحدى ثلاث: بطاقة، أو طلبَ اسمٍ لمن ليس عميلاً بعد، أو خطأً مفهوماً.
-- الاسم يُطلب فقط عند الحاجة — فمن حجز عندك من قبل يكفيه رقمه.
create or replace function public.loyalty_self_issue(
  p_tenant_id uuid,
  p_phone     text,
  p_name      text default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_phone text; v_name text; v_cust record; v_prog record;
  v_tenant record; v_count int; v_card_id uuid;
begin
  v_phone := btrim(coalesce(p_phone, ''));
  v_name  := nullif(btrim(coalesce(p_name, '')), '');
  if v_phone = '' then
    raise exception 'PHONE_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_tenant from tenants where id = p_tenant_id;
  if not found or not coalesce(v_tenant.loyalty_enabled, false) then
    raise exception 'LOYALTY_NOT_IN_PLAN' using errcode = 'P0001';
  end if;

  select * into v_prog from loyalty_programs
   where tenant_id = p_tenant_id and is_active;
  if not found then
    raise exception 'برنامج الولاء غير مفعّل في هذا الملعب' using errcode = 'P0001';
  end if;

  select * into v_cust from customers
   where tenant_id = p_tenant_id and phone = v_phone;

  -- ليس عميلاً بعد: اطلب اسمه ثم عُد. لا نُنشئ عميلاً بلا اسم.
  if not found then
    if v_name is null then
      return jsonb_build_object('need_name', true);
    end if;
    insert into customers(tenant_id, full_name, phone)
    values (p_tenant_id, v_name, v_phone)
    returning * into v_cust;
  end if;

  if v_cust.loyalty_opt_out_at is not null then
    raise exception 'هذا الرقم ألغى اشتراكه في برنامج الولاء' using errcode = 'P0001';
  end if;

  select id into v_card_id from loyalty_cards
   where program_id = v_prog.id and customer_id = v_cust.id;

  if v_card_id is null then
    select count(*) into v_count from loyalty_cards where tenant_id = p_tenant_id;
    if v_count >= coalesce(v_tenant.allowed_loyalty_cards, 0) then
      raise exception 'LOYALTY_CARD_LIMIT_REACHED' using errcode = 'P0001';
    end if;

    insert into loyalty_cards(tenant_id, program_id, customer_id, redeem_pin)
    values (p_tenant_id, v_prog.id, v_cust.id,
            lpad((floor(random() * 10000))::int::text, 4, '0'))
    returning id into v_card_id;

    if v_prog.signup_bonus > 0 then
      insert into loyalty_transactions(tenant_id, card_id, delta, reason, note)
      values (p_tenant_id, v_card_id, v_prog.signup_bonus, 'signup_bonus', 'مكافأة انضمام');
    end if;
  end if;

  -- الشكل نفسه الذي تُرجعه loyalty_card_by_phone — فترسمه الواجهة بلا فرع ثانٍ
  return (select jsonb_build_object(
    'serial',            c.serial,
    'balance',           c.balance,
    'threshold',         v_prog.reward_threshold,
    'rewards_available', (select count(*) from loyalty_rewards
                           where card_id = c.id and status = 'available'),
    'program', jsonb_build_object(
      'name',        v_prog.name,
      'reward',      v_prog.reward_label,
      'template',    v_prog.template,
      'brand_bg',    v_prog.brand_bg,
      'brand_fg',    v_prog.brand_fg,
      'brand_label', v_prog.brand_label,
      'logo_url',    v_prog.logo_url
    )) from loyalty_cards c where c.id = v_card_id);
end $$;

-- ═══ ٥) الصلاحيات ═══════════════════════════════════════════════════════
revoke all on function public.loyalty_decide_stamp(uuid, boolean)   from public, anon;
revoke all on function public.loyalty_pending_stamps_list(int)      from public, anon;
revoke all on function public.loyalty_self_issue(uuid, text, text)  from public;
grant execute on function public.loyalty_decide_stamp(uuid, boolean)  to authenticated;
grant execute on function public.loyalty_pending_stamps_list(int)     to authenticated;
grant execute on function public.loyalty_self_issue(uuid, text, text) to anon, authenticated;

-- ═══ ٦) auto_enroll يسقط ════════════════════════════════════════════════
-- لم يعد له معنى: الإصدار صار بيد العميل وحده. وإبقاؤه عموداً ميتاً في
-- الجدول يُغري من يقرأ الكود لاحقاً بأن الإصدار التلقائي ما زال ممكناً.
alter table public.loyalty_programs drop column if exists auto_enroll;

-- إعادة تعريف الحافظ بلا auto_enroll — نسخة 20260730221702 ناقصةً سطرَيه
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
    earn_per_booking, earn_per_currency, min_booking_amount, signup_bonus,
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
    signup_bonus = excluded.signup_bonus,
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

-- ═══ ٧) عدّاد المعلّقة في إحصاءات اللوحة ════════════════════════════════
-- نسخة 20260730221702 + سطرٌ واحد: العدّاد الذي يحمل شارة التبويب.
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
    'pending_stamps',    (select count(*) from loyalty_pending_stamps
                           where tenant_id = v_tenant and status = 'pending'),
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
