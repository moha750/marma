-- تحصين برنامج الولاء — إغلاق ملاحظات فاحص أمان Supabase بعد المهاجرة الأساسية.
--
-- ١) search_path ثابت على الدوال النقيّة الثلاث: كانت الوحيدة في المشروع كلّه
--    التي تحمل search_path قابلاً للتغيير حسب الدور. لا تلمس جداول، فالخطر نظري،
--    لكن تثبيته مجاني ويُبقي لوحة الفاحص نظيفة فلا تُخفي ملاحظة حقيقية لاحقاً.
--
-- ٢) سحب صلاحية التنفيذ من anon و PUBLIC عن كل دوال الولاء. الحماية الفعلية
--    قائمة أصلاً (كل RPC يبدأ بـ get_my_tenant_id() فيرفض غير المصدَّق)، لكن
--    ترك المنفذ مفتوحاً على /rest/v1/rpc بلا داعٍ مخالف لمبدأ الامتياز الأدنى.
--    دوال التريجر تُسحب من الجميع: تُنفَّذ بصلاحية مالك الجدول ولا معنى لندائها.

-- ═══ ١) تثبيت search_path ══════════════════════════════════════════════

create or replace function public.loyalty_reward_label(
  p_kind text, p_value numeric, p_custom text
) returns text language sql immutable set search_path to '' as $$
  select case
    when nullif(btrim(coalesce(p_custom,'')),'') is not null then btrim(p_custom)
    when p_kind = 'free_booking' and p_value is null then 'حجز مجاني'
    when p_kind = 'free_booking'      then 'حجز مجاني ' || trim(to_char(p_value,'FM999')) || ' دقيقة'
    when p_kind = 'percent_discount'  then 'خصم ' || trim(to_char(p_value,'FM999')) || '٪'
    when p_kind = 'amount_discount'   then 'خصم ' || trim(to_char(p_value,'FM999999.99')) || ' ريال'
    else 'مكافأة'
  end
$$;

create or replace function public.loyalty_discount_for(
  p_kind text, p_value numeric, p_max numeric,
  p_total numeric, p_duration_min numeric
) returns numeric language sql immutable set search_path to '' as $$
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

-- pg_catalog.now() صراحةً لأن search_path فارغ
create or replace function public.loyalty_booking_qualifies(
  p_status text, p_no_show_at timestamptz, p_end_time timestamptz,
  p_total numeric, p_paid numeric
) returns boolean language sql stable set search_path to '' as $$
  select p_status = 'confirmed'
     and p_no_show_at is null
     and p_end_time < pg_catalog.now()
     and p_total is not null
     and (p_total <= 0 or coalesce(p_paid,0) >= p_total)
$$;

-- ═══ ٢) الامتياز الأدنى ════════════════════════════════════════════════

-- دوال التريجر: لا تُنادى مباشرةً أبداً
revoke all on function public.tg_loyalty_apply_tx()          from public, anon, authenticated;
revoke all on function public.tg_loyalty_count_rewards()     from public, anon, authenticated;
revoke all on function public.tg_loyalty_booking_change()    from public, anon, authenticated;
revoke all on function public.tg_loyalty_release_on_cancel() from public, anon, authenticated;

-- دوال مساعِدة تُستدعى من داخل دوال SECURITY DEFINER فقط
revoke all on function public.loyalty_reward_label(text, numeric, text)             from public, anon, authenticated;
revoke all on function public.loyalty_discount_for(text, numeric, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function public.loyalty_booking_qualifies(text, timestamptz, timestamptz, numeric, numeric) from public, anon, authenticated;
revoke all on function public.loyalty_slot_has_offer(uuid, uuid, timestamptz)       from public, anon, authenticated;

-- واجهة اللوحة: للمستخدم المصدَّق حصراً — لا PUBLIC ولا anon
revoke all on function public.loyalty_get_program()                             from public, anon;
revoke all on function public.loyalty_upsert_program(jsonb)                     from public, anon;
revoke all on function public.loyalty_enroll(uuid)                              from public, anon;
revoke all on function public.loyalty_list_cards(text, int, int)                from public, anon;
revoke all on function public.loyalty_card_detail(uuid)                         from public, anon;
revoke all on function public.loyalty_scan_lookup(text)                         from public, anon;
revoke all on function public.loyalty_adjust(uuid, numeric, text)               from public, anon;
revoke all on function public.loyalty_apply_reward(text, uuid, text)            from public, anon;
revoke all on function public.loyalty_redeem(text, text)                        from public, anon;
revoke all on function public.loyalty_release_reward(text)                      from public, anon;
revoke all on function public.loyalty_set_consent(uuid, text, text, boolean)    from public, anon;

grant execute on function public.loyalty_get_program()                          to authenticated;
grant execute on function public.loyalty_upsert_program(jsonb)                  to authenticated;
grant execute on function public.loyalty_enroll(uuid)                           to authenticated;
grant execute on function public.loyalty_list_cards(text, int, int)             to authenticated;
grant execute on function public.loyalty_card_detail(uuid)                      to authenticated;
grant execute on function public.loyalty_scan_lookup(text)                      to authenticated;
grant execute on function public.loyalty_adjust(uuid, numeric, text)            to authenticated;
grant execute on function public.loyalty_apply_reward(text, uuid, text)         to authenticated;
grant execute on function public.loyalty_redeem(text, text)                     to authenticated;
grant execute on function public.loyalty_release_reward(text)                   to authenticated;
grant execute on function public.loyalty_set_consent(uuid, text, text, boolean)  to authenticated;
