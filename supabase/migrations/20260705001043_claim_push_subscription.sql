-- نقل ملكية اشتراك Push للمستخدم الحالي — يصلح تبديل الحسابات على نفس الجهاز.
-- ----------------------------------------------------------------------------
-- المشكلة: اشتراك المتصفح (endpoint) واحد على مستوى الجهاز، لكن صفّه في
-- push_subscriptions مربوط بالمستخدم الذي فعّله أولًا. عند دخول حساب آخر كان
-- upsert العميل يفشل بصمت (سياسة RLS تمنع تعديل صف مستخدم آخر)، فيبقى الجهاز
-- يستقبل إشعارات الحساب الأول للأبد.
--
-- الحل: دالة DEFINER تُعيد تسجيل الـendpoint باسم auth.uid() الحالي وملعبه —
-- تحذف أي صف قديم لمستخدم آخر ثم تدرج/تحدّث. مستخدم بلا ملعب (مشرف) → لا شيء.
create or replace function public.claim_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
) returns void
language plpgsql volatile security definer set search_path to 'public' as $$
declare
  v_uid uuid;
  v_tenant uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if p_endpoint is null or length(p_endpoint) < 10 or p_p256dh is null or p_auth is null then
    return; -- مدخلات ناقصة → تجاهل صامت (لا نكسر تدفق الدخول أبدًا)
  end if;

  select tenant_id into v_tenant from public.profiles where id = v_uid;
  if v_tenant is null then
    -- حساب بلا ملعب (مشرف عام): لا اشتراكات push له — نظّف أي صف قديم للجهاز
    delete from public.push_subscriptions where endpoint = p_endpoint;
    return;
  end if;

  -- أزل ملكية أي مستخدم سابق لهذا الجهاز ثم سجّله للمستخدم الحالي
  delete from public.push_subscriptions
  where endpoint = p_endpoint and user_id <> v_uid;

  insert into public.push_subscriptions (user_id, tenant_id, endpoint, p256dh_key, auth_key, user_agent)
  values (v_uid, v_tenant, p_endpoint, left(p_p256dh, 300), left(p_auth, 300), left(p_user_agent, 300))
  on conflict (endpoint) do update set
    user_id = excluded.user_id,
    tenant_id = excluded.tenant_id,
    p256dh_key = excluded.p256dh_key,
    auth_key = excluded.auth_key,
    user_agent = excluded.user_agent,
    last_used_at = now(),
    failed_count = 0;
end;
$$;

revoke all on function public.claim_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.claim_push_subscription(text, text, text, text) to authenticated;
