-- إشعار «ختم بانتظار موافقتك» يصل جوال المالك، لا جرس اللوحة وحده.
--
-- الطلب المعلّق لا يمنح ختماً حتى يُحسم، فبقاؤه معلّقاً يعني عميلاً حضر ولعب
-- وسدّد ولم يُختم له. وكان الإشعار يقف عند سطرٍ في notifications: من لم يفتح
-- اللوحة لا يدري. وإشعارات الحجوزات تصل الجوال منذ زمن — فالفرق لم يكن قراراً
-- بل نقصاً.
--
-- ولماذا دالّة عامّة لا توسعةٌ لـ send-booking-push؟ لأن تلك تعرف الحجوزات:
-- تأخذ booking_id وتقرأه وتصوغ نصّه من جداوله. و«ختم بانتظار موافقتك» لا حجز
-- يُقرأ له ولا نصَّ يُشتقّ. فصارت send-owner-push تأخذ النصّ جاهزاً، ونواة
-- الإرسال (ثلاث قنوات: ويب وأبل وأندرويد) مشتركةٌ بينهما في _shared/push.ts.
--
-- والنصّ يُكتب مرّة واحدة هنا: نفس العنوان والنصّ يذهبان إلى سطر notifications
-- وإلى الجوال. صياغتان لحدثٍ واحد تفترقان بمرور الوقت لا محالة.

-- ═══ ١) الجسر إلى الدالّة ═══════════════════════════════════════════════
-- الفشل لا يُسقط المعاملة أبداً: الختم المعلّق أهمّ من إشعاره، وحجزٌ يفشل
-- لأن الإشعار لم يُرسَل خسارةٌ لا تُحتمل مقابل مكسبٍ لا يُذكر.
create or replace function public.push_owner(
  p_tenant_id uuid, p_title text, p_body text,
  p_url text default '/', p_tag text default 'marma'
) returns void language plpgsql security definer set search_path to 'public' as $$
declare v_url text; v_secret text;
begin
  v_url    := public._get_vault_secret('PROJECT_URL');
  v_secret := public._get_vault_secret('INTERNAL_HOOK_SECRET');
  if v_url is null or v_secret is null then
    raise warning 'push_owner: missing vault secrets (PROJECT_URL/INTERNAL_HOOK_SECRET)';
    return;
  end if;

  perform net.http_post(
    url     := v_url || '/functions/v1/send-owner-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := jsonb_build_object(
      'tenant_id', p_tenant_id::text,
      'title', p_title,
      'body',  p_body,
      'url',   p_url,
      'tag',   p_tag
    )
  );
exception when others then
  raise warning 'push_owner failed: %', sqlerrm;
end $$;

revoke all on function public.push_owner(uuid, text, text, text, text)
  from public, anon, authenticated;


-- ═══ ٢) الطلب المعلّق يدفع ═════════════════════════════════════════════
-- نسخةٌ من 20260809140000 بإضافة النداء وحده. والوسم `loyalty-stamp-<الحجز>`
-- يجعل الطلب الواحد إشعاراً واحداً في مركز الإشعارات مهما تكرّر النداء.
create or replace function public.loyalty_award_booking(p_booking_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_b record; v_prog record; v_card record; v_delta numeric; v_updated int;
  v_name text; v_title text; v_body text;
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

  -- لا بطاقة = لا شيء. لا إصدار تلقائي مهما بلغت حجوزاته.
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

  select full_name into v_name from customers where id = v_b.customer_id;
  v_title := 'ختم بانتظار موافقتك';
  v_body  := coalesce(v_name, 'عميل') || ' أكمل حجزه — وافق على ختمه أو ارفضه';

  insert into notifications(audience, tenant_id, type, title, body, link, data)
  values ('owner', v_b.tenant_id, 'loyalty_stamp_pending', v_title, v_body,
          '/loyalty/stamps',
          jsonb_build_object('booking_id', p_booking_id, 'card_id', v_card.id));

  perform public.push_owner(v_b.tenant_id, v_title, v_body, '/loyalty/stamps',
                            'loyalty-stamp-' || p_booking_id::text);
end $$;
