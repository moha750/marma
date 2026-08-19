-- الإهداء: مسارٌ ثانٍ للختم، بابه المالك لا الحجز.
--
-- المسار الأول (الحجز ⇐ طلب معلّق ⇐ موافقة) يبقى كما هو حرفياً — هو عين
-- النظام على «حضر ولعب وسدّد»، ولا يجوز أن يلمسه شيء.
--
-- وما تغيّر أن «التعديل» انقسم قصداً إلى إجراءين لا واحد:
--
--   إهداء  — موجبٌ فقط، بمناسبة تُسجَّل، وإشعارٌ يقول للعميل إنها هدية.
--            هذا هو ما يفعله المالك تسعاً وتسعين مرة من مئة.
--   تصحيح  — loyalty_adjust كما هو (± بلا مساس)، لتدارك خطأ.
--
-- لماذا الفصل؟ لأن حقلاً واحداً يقبل ‎+٣ و ‎−٣ يجعل الإهداء والتراجعَ عنه
-- الشيء نفسه في عين الواجهة وفي عين الدفتر. وحين يسأل العميل «ليش نقص
-- رصيدي؟» يكون الجواب في السبب لا في إشارة الرقم. ولذلك سببٌ جديد في الدفتر
-- (gift) لا ملاحظةٌ نصّية على 'manual' — النصّ لا يُستعلَم عنه ولا يُعرَض بلونه.
--
-- والصلاحية للمالك وحده كما كان التعديل: الموظف يوافق على أختام الحجوزات —
-- تلك شهادةٌ على واقعة حدثت — أما الإهداء فقرارٌ ماليّ بلا حجزٍ يقابله.

-- ═══ ١) سببٌ جديد في الدفتر ═════════════════════════════════════════════
alter table public.loyalty_transactions
  drop constraint if exists loyalty_transactions_reason_check;
alter table public.loyalty_transactions
  add constraint loyalty_transactions_reason_check check (reason in
    ('booking','manual','reward_issued','reward_void','expiry','adjust',
     'signup_bonus','gift'));


-- ═══ ٢) الإهداء ═════════════════════════════════════════════════════════
-- صورةٌ من loyalty_adjust بفارقين: الموجب وحده، والسبب 'gift'. وما عداهما
-- واحد — الحركة تُدخَل في الدفتر، والتريجر القائم يحرّك الرصيد ويُصدر القسيمة
-- عند العتبة ويُخطر المحفظة. مسار الرصيد واحدٌ لا اثنان.
create or replace function public.loyalty_gift(
  p_card_id uuid, p_delta numeric, p_note text default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_tenant uuid; v_card record;
begin
  v_tenant := public.get_my_tenant_id();
  if v_tenant is null then raise exception 'غير مصرّح' using errcode = 'P0001'; end if;
  if not public.is_owner() then
    raise exception 'الإهداء متاح للمالك فقط' using errcode = 'P0001';
  end if;
  if not public.is_my_tenant_active() then
    raise exception 'TENANT_INACTIVE' using errcode = 'P0001';
  end if;
  if p_delta is null or p_delta <= 0 then
    raise exception 'عدد الأختام المُهداة يجب أن يكون أكبر من صفر' using errcode = 'P0001';
  end if;
  -- سقفٌ يمنع الخطأ المطبعي (٥٠ بدل ٥) من إغراق بطاقةٍ بقسائم لا رجعة فيها
  if p_delta > 50 then
    raise exception 'أقصى إهداء ٥٠ ختماً في المرة' using errcode = 'P0001';
  end if;

  select * into v_card from loyalty_cards where id = p_card_id and tenant_id = v_tenant;
  if not found then raise exception 'البطاقة غير موجودة' using errcode = 'P0001'; end if;
  if v_card.status <> 'active' then
    raise exception 'البطاقة موقوفة — لا يمكن الإهداء إليها' using errcode = 'P0001';
  end if;

  insert into loyalty_transactions(tenant_id, card_id, delta, reason, note, created_by)
  values (v_tenant, p_card_id, p_delta, 'gift', nullif(btrim(p_note),''), auth.uid());

  return public.loyalty_card_detail(p_card_id);
end $$;

revoke all on function public.loyalty_gift(uuid, numeric, text) from public, anon;
grant execute on function public.loyalty_gift(uuid, numeric, text) to authenticated;


-- ═══ ٣) الإهداء يخضع لانتهاء الصلاحية كغيره ════════════════════════════
-- لولا هذا السطر لبقيت الأختام المُهداة أبديةً بينما تنتهي أختام من حضر ولعب
-- — وهي مفارقةٌ لا يقصدها أحد. القوائم الثلاث تُذكر بحرفها لأن إغفال واحدة
-- يخلق تسرّباً صامتاً: تُوسم كمنتهية ولا تُخصم، أو تُخصم ولا تُوسم فتُخصم ثانيةً.
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
       and t.reason in ('booking','manual','signup_bonus','gift')
       and t.created_at < now() - make_interval(days => r.points_expire_days);

    continue when v_due <= 0;

    update loyalty_transactions set expired_at = now()
     where card_id = r.card_id and delta > 0 and expired_at is null
       and reason in ('booking','manual','signup_bonus','gift')
       and created_at < now() - make_interval(days => r.points_expire_days);

    v_amount := least(v_due, r.balance);
    if v_amount > 0 then
      insert into loyalty_transactions(tenant_id, card_id, delta, reason, note)
      values (r.tenant_id, r.card_id, -v_amount, 'expiry', 'انتهاء صلاحية أختام');
    end if;
  end loop;

  return v_count;
end $$;
