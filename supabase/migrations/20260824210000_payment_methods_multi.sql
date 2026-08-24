-- بوابات الدفع: من عمودٍ واحد إلى قائمة.
--
-- الحقيقة التي كسرت الأعمدة: للمالك حسابان في بنكين، ورقما محفظةٍ مختلفان،
-- ومنهم من يقبض نقدًا عند الملعب. عمودٌ واحد لكلٍّ يفرض عليه أن يختار أيّها
-- «الحقيقي» ويُخفي البقية. فصارت كلُّ طريقةٍ صفًّا، وللمالك أن يضيف ما شاء.
--
-- ثلاثة أنواع: bank (أيبان)، wallet (رقم جوال + المحافظ التي تستقبل عليه)،
-- cash (الدفع عند الاستلام — لا بيانات، سطرٌ للعميل فقط).

create table if not exists public.tenant_payment_methods (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  kind          text not null check (kind in ('bank', 'wallet', 'cash')),
  title         text,                                -- اسم البنك (bank) أو تسمية حرّة
  iban          text,
  phone         text,
  wallets       text[] not null default '{}',
  note          text,                                -- سطرٌ يقرأه العميل تحت الطريقة
  is_active     boolean not null default true,
  display_order int not null default 0,
  created_at    timestamptz not null default now(),

  -- شكلُ كلّ نوع محسومٌ هنا لا في الواجهة: صفٌّ نصفُ ممتلئ يعني خانةً عوراء
  -- في هاتف العميل، والقاعدة أوثق حارسٍ من نموذجٍ يُعاد كتابته كلّ موسم.
  -- الشروط تبدأ بـ is not null: القيد يسقط على FALSE لا على NULL، و«NULL ~ نمط»
  -- تساوي NULL — فصفٌّ بنكيٌّ بلا أيبان كان يمرّ لولاها.
  constraint tenant_payment_methods_shape check (
    case kind
      when 'bank'   then iban is not null and iban ~ '^SA[0-9]{22}$'
                         and phone is null and wallets = '{}'
      when 'wallet' then phone is not null and phone ~ '^05[0-9]{8}$' and iban is null
                         and coalesce(array_length(wallets, 1), 0) > 0
      when 'cash'   then iban is null and phone is null and wallets = '{}'
      else false
    end
  ),
  -- قائمة مغلقة: الواجهة تترجم المفتاح إلى اسم، فمفتاحٌ مجهول خانةٌ فارغة.
  -- (بنوك D360 و stc bank بنوكٌ لها أيبان لا محافظ — مكانها النوع bank)
  constraint tenant_payment_methods_wallets_known check (
    wallets <@ array['stcpay', 'urpay', 'barq', 'tiqmo', 'alinmapay']::text[]
  ),
  constraint tenant_payment_methods_title_len check (title is null or char_length(title) <= 60),
  constraint tenant_payment_methods_note_len  check (note  is null or char_length(note)  <= 140)
);

comment on table public.tenant_payment_methods is
  'طرق الدفع التي يعرضها الملعب لعميله عند تأكيد الحجز — لكلٍّ صفّ مستقلّ.';

create index if not exists idx_payment_methods_tenant
  on public.tenant_payment_methods (tenant_id, display_order, created_at);

-- تكرارُ الأيبان أو الرقم غلطُ نسخٍ لا نيّة، و«عند الاستلام» طريقةٌ واحدة
-- بطبعها. القاعدة تردّها، والواجهة تترجم 23505 إلى جملةٍ مفهومة.
create unique index if not exists uq_payment_methods_bank
  on public.tenant_payment_methods (tenant_id, iban) where kind = 'bank';
create unique index if not exists uq_payment_methods_wallet
  on public.tenant_payment_methods (tenant_id, phone) where kind = 'wallet';
create unique index if not exists uq_payment_methods_cash
  on public.tenant_payment_methods (tenant_id) where kind = 'cash';

alter table public.tenant_payment_methods enable row level security;

drop policy if exists "payment_methods_select_own_tenant" on public.tenant_payment_methods;
create policy "payment_methods_select_own_tenant"
  on public.tenant_payment_methods for select to authenticated
  using (tenant_id = public.get_my_tenant_id());

-- الكتابة للمالك وحده: حسابُ القبض حسابه لا حساب موظّفه.
drop policy if exists "payment_methods_write_owner" on public.tenant_payment_methods;
create policy "payment_methods_write_owner"
  on public.tenant_payment_methods for all to authenticated
  using (tenant_id = public.get_my_tenant_id() and public.is_owner())
  with check (tenant_id = public.get_my_tenant_id() and public.is_owner());

-- ─── ترحيل ما كُتب في الأعمدة القديمة ───
insert into public.tenant_payment_methods (tenant_id, kind, title, iban, is_active, display_order)
select t.id, 'bank', t.payment_bank_name, t.payment_iban, coalesce(t.payment_bank_enabled, false), 0
  from public.tenants t
 where t.payment_iban is not null
on conflict do nothing;

insert into public.tenant_payment_methods (tenant_id, kind, phone, wallets, is_active, display_order)
select t.id, 'wallet', t.payment_wallet_phone,
       array(select w from unnest(t.payment_wallets) w
              where w = any (array['stcpay','urpay','barq','tiqmo','alinmapay'])),
       coalesce(t.payment_wallet_enabled, false), 1
  from public.tenants t
 where t.payment_wallet_phone is not null
   and exists (select 1 from unnest(t.payment_wallets) w
                where w = any (array['stcpay','urpay','barq','tiqmo','alinmapay']))
on conflict do nothing;

-- الأعمدة القديمة تبقى ولا تُقرأ: عميلٌ عالقٌ في كاش نسخةٍ سابقة يطلبها في
-- select، وحذفها اليوم يكسر تحميل حسابه. تُحذف في تنظيفٍ لاحق.
comment on column public.tenants.payment_iban is 'مهجور — انظر tenant_payment_methods.';
comment on column public.tenants.payment_bank_enabled is 'مهجور — انظر tenant_payment_methods.';
comment on column public.tenants.payment_bank_name is 'مهجور — انظر tenant_payment_methods.';
comment on column public.tenants.payment_wallet_enabled is 'مهجور — انظر tenant_payment_methods.';
comment on column public.tenants.payment_wallet_phone is 'مهجور — انظر tenant_payment_methods.';
comment on column public.tenants.payment_wallets is 'مهجور — انظر tenant_payment_methods.';

-- ─── الدالة العامة: payment.methods مصفوفةً مرتّبة ───
CREATE OR REPLACE FUNCTION public.get_public_tenant_info(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant    record;
  v_fields    jsonb;
  v_is_active boolean;
  v_loyalty   boolean;
  v_methods   jsonb := '[]'::jsonb;
  v_bank      jsonb;
  v_wallet    jsonb;
BEGIN
  SELECT id, name, description, cover_image_url, logo_url, show_manage_banner,
         subscription_status, loyalty_enabled
    INTO v_tenant
  FROM public.tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_is_active := public.is_tenant_active(p_tenant_id);

  v_loyalty := COALESCE(v_tenant.loyalty_enabled, false) AND EXISTS (
    SELECT 1 FROM public.loyalty_programs p
     WHERE p.tenant_id = p_tenant_id AND p.is_active
  );

  -- طرق الدفع للملاعب النشطة فقط: صفحة الملعب الموقوف لا تعرض شيئًا أصلًا،
  -- فلا يُسرَّب حسابٌ بنكيّ ولا رقمُ محفظةٍ بنداءٍ مباشر للدالة.
  IF v_is_active THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'kind',    m.kind,
      'title',   m.title,
      'iban',    m.iban,
      'phone',   m.phone,
      'wallets', to_jsonb(m.wallets),
      'note',    m.note
    ) ORDER BY m.display_order, m.created_at), '[]'::jsonb) INTO v_methods
    FROM public.tenant_payment_methods m
    WHERE m.tenant_id = p_tenant_id AND m.is_active;

    -- مفاتيح قديمة يقرأها عميلٌ عالقٌ في كاش نسخةٍ سابقة — أوّل حسابٍ وأوّل محفظة
    SELECT jsonb_build_object('iban', m.iban, 'bank_name', m.title) INTO v_bank
      FROM public.tenant_payment_methods m
     WHERE m.tenant_id = p_tenant_id AND m.is_active AND m.kind = 'bank'
     ORDER BY m.display_order, m.created_at LIMIT 1;

    SELECT jsonb_build_object('phone', m.phone, 'providers', to_jsonb(m.wallets)) INTO v_wallet
      FROM public.tenant_payment_methods m
     WHERE m.tenant_id = p_tenant_id AND m.is_active AND m.kind = 'wallet'
     ORDER BY m.display_order, m.created_at LIMIT 1;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',           f.id,
    'name',         f.name,
    'city',         f.city,
    'phone',        f.phone,
    'location_url', f.location_url,
    'latitude',     f.latitude,
    'longitude',    f.longitude,
    'image_urls',   COALESCE(f.image_urls, '{}'),
    'description',  f.description,
    'surface_type', f.surface_type,
    'amenities',    COALESCE(f.amenities, '{}')
  ) ORDER BY f.display_order, f.name), '[]'::jsonb) INTO v_fields
  FROM public.fields f
  WHERE f.tenant_id = p_tenant_id AND f.is_active = true;

  RETURN jsonb_build_object(
    'id',                  v_tenant.id,
    'name',                v_tenant.name,
    'description',         v_tenant.description,
    'cover_image_url',     v_tenant.cover_image_url,
    'logo_url',            v_tenant.logo_url,
    'show_manage_banner',  COALESCE(v_tenant.show_manage_banner, true),
    'loyalty_active',      v_loyalty,
    'payment',             jsonb_build_object('methods', v_methods, 'bank', v_bank, 'wallet', v_wallet),
    'payment_iban',        v_bank->>'iban',
    'is_active',           v_is_active,
    'subscription_status', v_tenant.subscription_status,
    'fields',              v_fields
  );
END;
$function$;
