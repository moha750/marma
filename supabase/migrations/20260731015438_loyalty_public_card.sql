-- صفحة البطاقة العامة — ما يفتحه العميل من رابط واتساب.
--
-- لماذا بلا تحقّق من توقيع HMAC هنا؟
-- الرقم التسلسلي ‎24 خانة سداسية عشرية = ‎96 بت عشوائية من gen_random_bytes.
-- تخمينه مستحيل عملياً، فهو نفسه بمثابة مفتاح الوصول. والتوقيع في الرابط يُتحقَّق
-- منه في Edge Function عند تنزيل ‎.pkpass حيث السرّ موجود أصلاً. إضافة تحقّق ثانٍ
-- هنا كانت ستفرض تخزين السرّ في vault بلا مكسب أمني حقيقي — الخانات الست
-- والتسعون هي الحارس، لا التوقيع.
--
-- نقبل الحمولة بصورتيها: «serial» أو «serial.signature» — فالرابط الواحد يخدم
-- الصفحة وزر التنزيل معاً.

create or replace function public.loyalty_public_card(p_payload text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_serial text;
  v_card record;
  v_prog record;
  v_tenant record;
  v_reward record;
begin
  v_serial := lower(split_part(btrim(coalesce(p_payload, '')), '.', 1));

  -- شكل صارم قبل أي استعلام: يمنع الفحص العشوائي ويقطع أي محاولة حقن
  if v_serial !~ '^[0-9a-f]{24}$' then
    raise exception 'رابط البطاقة غير صالح' using errcode = 'P0001';
  end if;

  select * into v_card from loyalty_cards where serial = v_serial;
  if not found then
    raise exception 'البطاقة غير موجودة' using errcode = 'P0001';
  end if;

  select * into v_prog   from loyalty_programs where id = v_card.program_id;
  select * into v_tenant from tenants          where id = v_card.tenant_id;

  select code, label, expires_at into v_reward
    from loyalty_rewards
   where card_id = v_card.id and status = 'available'
   order by issued_at limit 1;

  return jsonb_build_object(
    'serial',      v_card.serial,
    'status',      v_card.status,
    'balance',     v_card.balance,
    'threshold',   v_prog.reward_threshold,
    'member',      (select full_name from customers where id = v_card.customer_id),
    'redeem_pin',  case when v_prog.redeem_pin_enabled then v_card.redeem_pin else null end,
    'opted_out',   (select loyalty_opt_out_at is not null from customers where id = v_card.customer_id),
    'program', jsonb_build_object(
      'name',        v_prog.name,
      'is_active',   v_prog.is_active,
      'reward',      v_prog.reward_label,
      'terms',       v_prog.reward_terms,
      'template',    v_prog.template,
      'brand_bg',    v_prog.brand_bg,
      'brand_fg',    v_prog.brand_fg,
      'brand_label', v_prog.brand_label,
      'logo_url',    v_prog.logo_url,
      'hero_url',    v_prog.hero_url
    ),
    'tenant', jsonb_build_object(
      'id',   v_tenant.id,
      'name', v_tenant.name,
      'logo', v_tenant.logo_url
    ),
    'reward', case when v_reward.code is null then null else jsonb_build_object(
      'code',       v_reward.code,
      'label',      v_reward.label,
      'expires_at', v_reward.expires_at
    ) end
  );
end $$;

-- إلغاء الاشتراك بضغطة — شرط صحّة نموذج «الموافقة بالإشعار» (§11.4)
create or replace function public.loyalty_public_opt_out(p_payload text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_serial text; v_card record;
begin
  v_serial := lower(split_part(btrim(coalesce(p_payload, '')), '.', 1));
  if v_serial !~ '^[0-9a-f]{24}$' then
    raise exception 'رابط البطاقة غير صالح' using errcode = 'P0001';
  end if;

  select * into v_card from loyalty_cards where serial = v_serial;
  if not found then
    raise exception 'البطاقة غير موجودة' using errcode = 'P0001';
  end if;

  update customers set loyalty_opt_out_at = now() where id = v_card.customer_id;
  update loyalty_cards set status = 'blocked', pass_updated_at = now() where id = v_card.id;

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.loyalty_public_card(text)    from public;
revoke all on function public.loyalty_public_opt_out(text) from public;
grant execute on function public.loyalty_public_card(text)    to anon, authenticated;
grant execute on function public.loyalty_public_opt_out(text) to anon, authenticated;
