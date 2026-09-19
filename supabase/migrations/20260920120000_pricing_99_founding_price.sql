-- السعر الموحّد: ٢٠٠ + ٥٠ لكل وحدة → ٩٩ ر.س/شهر شامل كل شيء بلا حدود.
--
-- لماذا: التسعير بالوحدات كان يعاقب النمو — صاحب ملعبين وموظفَين يدفع ٣٥٠،
-- فيؤجّل إضافة أرضية أو يسجّل موظفيه تحت حساب واحد. والرقم المعلن (٢٠٠) كان
-- يُقرأ حاجزاً عند أول لقاء، قبل أن يرى أحدٌ قيمة النظام. سعرٌ واحد صريح
-- يزيل المساومة الداخلية كلّها: تُضيف أرضية أو موظفاً متى احتجت، بلا فاتورة
-- جديدة وبلا حساب.
--
-- ما يتغيّر في request_subscription — وهي الدالة الوحيدة التي تسعّر:
--   ١. v_unit_price = 0 (كان ٥٠). فالترقية الفورية تصير بصفر دائماً، وحساب
--      التجديد يصير v_base_price وحده مهما بلغت الأرضيات والموظفون. حرّاس
--      السلامة (BELOW_CURRENT_USAGE / DOWNGRADE_NOT_ALLOWED_ACTIVE) تبقى كما
--      هي: الحدود ما زالت تُطلب وتُعتمد، لكنها لم تعد تُسعَّر.
--   ٢. v_base_price لم يعد ثابتاً في كود الدالة — يُقرأ من tenants.monthly_price
--      لهذا المستأجر تحديداً، مع سقوط لطيف إلى ٩٩.
--
-- قرار التجميد (سعر التأسيس): أول عشرة عملاء يُضبط monthly_price لهم على ٦٦،
-- ولا يرتفع إذا ارتفع السعر المعلن لاحقاً. هم يدخلون على منتج لم يُجرَّب بعد،
-- ويتحمّلون عيوبه الأولى ويصنعون شهاداته — والثبات هو مقابل ذلك، لا خصمٌ
-- مؤقّت. لذلك يعيش السعر عموداً على صفّ المستأجر لا ثابتاً في الدالة: رفع
-- المعلن غداً يمسّ من ينضمّ بعده فقط، ولا يلمس صفوفاً مضبوطة على ٦٦.
--
-- الضبط يدوي بقرار المالك (لا يفعله هذا الملف):
--   update public.tenants set monthly_price = 66 where id = '<tenant_uuid>';
--
-- الأثر على القائم: الاشتراكات المعلّقة (pending) تحتفظ بمبلغها المحسوب وقت
-- الطلب — amount عمود مخزَّن، والموافقة لا تعيد حسابه. أول طلب بعد الهجرة هو
-- أول ما يأخذ السعر الجديد.
--
-- ملاحظة: ثوابت الواجهة في src/features/subscriptions/pricing.js تقابل هذا
-- (BASE_PRICE = 99، UNIT_PRICE = 0) — الملفّان يجب أن يبقيا متطابقَين.

-- ─── ١) عمود السعر الشهري لكل مستأجر ─────────────────────────────────
alter table public.tenants add column if not exists monthly_price numeric not null default 99;
comment on column public.tenants.monthly_price is 'السعر الشهري لهذا المستأجر. الافتراضي ٩٩ (السعر المعلن). عملاء التأسيس العشرة الأوائل يُضبطون على ٦٦ ولا يرتفع سعرهم إذا ارتفع المعلن.';

-- ─── ٢) request_subscription: سعر الوحدة صفر، والأساس من صفّ المستأجر ──
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
  v_base_price      numeric;
  v_unit_price      constant numeric := 0;
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

  -- السعر الأساسي لهذا المستأجر (٦٦ لعملاء التأسيس، ٩٩ للبقية) — قبل أي حساب لـ v_amount
  select coalesce(monthly_price, 99) into v_base_price from public.tenants where id = v_tenant.id;

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
