-- التصحيح بلا سببٍ مكتوب لا يُصحّح شيئاً.
--
-- الملاحظة كانت اختيارية: nullif(btrim(p_note),'') يبتلع الفراغ ويمضي. فيبقى
-- في الدفتر سطرٌ يقول «‎−٣ · تسوية» بلا كلمة. وحين يسأل العميل بعد شهر «ليش
-- نقص رصيدي؟» لا جواب عند المالك ولا في النظام — وهذا أسوأ من ألّا يُخصم أصلاً،
-- لأن الخصم وقع والثقة راحت معه.
--
-- ولماذا يُفرض هنا لا في الواجهة وحدها؟ لأن الواجهة تُلتفّ حولها بنداءٍ مباشر
-- على الـ RPC، والدفتر append-only لا يُصلَح بأثر رجعي: سطرٌ بلا سبب يبقى بلا
-- سبب إلى الأبد. فالحارس عند الباب لا عند الشاشة.
--
-- والإهداء يبقى سببه اختيارياً عمداً: زيادةٌ لا يعترض عليها أحد، ومناسبتها
-- تُستحسن ولا تُشترط. الفرق ليس في الإشارة بل في من يسأل لاحقاً.

create or replace function public.loyalty_adjust(
  p_card_id uuid, p_delta numeric, p_note text default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_tenant uuid; v_card record; v_note text;
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

  -- ثلاثة أحرف: تمنع الفراغ والنقطة والشرطة، ولا تُرهق من يكتب «خطأ»
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is null or length(v_note) < 3 then
    raise exception 'اكتب سبب التصحيح — يبقى في سجلّ البطاقة' using errcode = 'P0001';
  end if;

  select * into v_card from loyalty_cards where id = p_card_id and tenant_id = v_tenant;
  if not found then raise exception 'البطاقة غير موجودة' using errcode = 'P0001'; end if;
  if v_card.balance + p_delta < 0 then
    raise exception 'الرصيد لا يكفي لهذا الخصم' using errcode = 'P0001';
  end if;

  insert into loyalty_transactions(tenant_id, card_id, delta, reason, note, created_by)
  values (v_tenant, p_card_id, p_delta, 'manual', v_note, auth.uid());

  return public.loyalty_card_detail(p_card_id);
end $$;
