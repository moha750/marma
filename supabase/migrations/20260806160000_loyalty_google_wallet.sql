-- تفعيل طبقة Google Wallet — وصلت موافقة نشر حساب المُصدِر (٢٠٢٦-٠٨-٠٦).
--
-- الحقلان google_class_id (على البرنامج) و google_object_id (على البطاقة)
-- موجودان منذ 20260730221702_loyalty_engine.sql ولم يكن يكتبهما أحد. ما ينقص
-- هو ختم زمني يقول «متى آخر مرة طابقت فئةُ جوجل هويةَ البرنامج؟».
--
-- لماذا ختم زمني لا تريجر ولا طابور ثالث؟
-- loyalty_upsert_program يرفع updated_at عند كل حفظ. فمقارنة
-- google_synced_at < updated_at داخل دالة الحافة تكفي وحدها لاكتشاف أن الهوية
-- تغيّرت (شعار، لون، اسم برنامج) ⇒ تُحدَّث الفئة عند أول بطاقة تُلمس بعد الحفظ.
-- المسار يُصلح نفسه بلا بنية إضافية، وفشل التحديث لا يخلّف صفّاً معلّقاً.
--
-- ملاحظة: كائنات جوجل لا تُنشأ من طرفنا لكل البطاقات القائمة. الكائن يُنشأ عند
-- ضغط العميل «أضف إلى Google Wallet»، والمزامنة تُحدّث ما حُفظ فعلاً فقط.

alter table public.loyalty_programs
  add column if not exists google_synced_at timestamptz;

comment on column public.loyalty_programs.google_synced_at is
  'آخر مزامنة لفئة Google Wallet. أقدم من updated_at ⇒ الفئة قديمة وتُحدَّث.';


-- ═══════════════════════════════════════════════════════════════════════════
-- إلغاء الاشتراك يجب أن يصل إلى المحفظة — لا أن يقف عند قاعدتنا
-- ═══════════════════════════════════════════════════════════════════════════
--
-- المساران اللذان يوقفان بطاقة (إلغاء العميل من صفحة البطاقة، وتسجيل الإلغاء
-- من اللوحة) كانا يضبطان status='blocked' و pass_updated_at بلا إخطار مزامنة.
--
-- على آبل كان الأثر مؤجَّلاً لا غائباً: الجهاز يسأل عن البطاقة دورياً فيلتقط
-- الإيقاف متأخّراً. على جوجل الأثر غياب كامل: لا أحد يسأل — نحن من يكتب، وما
-- لا نكتبه لا يحدث. فتبقى بطاقةٌ ألغى صاحبها اشتراكها ظاهرةً فعّالة إلى الأبد.
--
-- §11.4 يشترط «إلغاء بضغطة واحدة» ⇒ state: EXPIRED في جوجل. هذا ما يُحقّقه.

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

  perform public.loyalty_notify_sync(v_card.id);

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.loyalty_public_opt_out(text) from public;
grant execute on function public.loyalty_public_opt_out(text) to anon, authenticated;


create or replace function public.loyalty_set_consent(
  p_customer_id uuid, p_src text, p_ver text, p_opt_out boolean default false
) returns void language plpgsql security definer set search_path to 'public' as $$
declare v_card_id uuid;
begin
  if p_opt_out then
    update customers set loyalty_opt_out_at = now() where id = p_customer_id;
    update loyalty_cards set status = 'blocked', pass_updated_at = now()
     where customer_id = p_customer_id;

    -- العميل الواحد قد يحمل بطاقة في أكثر من ملعب — كلّها تُخطَر
    for v_card_id in
      select id from loyalty_cards where customer_id = p_customer_id
    loop
      perform public.loyalty_notify_sync(v_card_id);
    end loop;
  else
    update customers set
      loyalty_consent_at  = coalesce(loyalty_consent_at, now()),
      loyalty_consent_src = coalesce(loyalty_consent_src, p_src),
      loyalty_consent_ver = coalesce(loyalty_consent_ver, p_ver),
      loyalty_opt_out_at  = null
    where id = p_customer_id;
  end if;
end $$;
