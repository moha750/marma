-- إشعارات التطبيق الأصلي (APNs لأبل، FCM لأندرويد)
-- ============================================================================
-- الإشعارات الحالية Web Push بمفاتيح VAPID، وهي لا تعمل داخل قوقعة التطبيق:
-- WKWebView على iOS لا يملك Push API إطلاقاً، و WebView على أندرويد كذلك.
-- فبلا هذا الجزء يبقى زرّ «تفعيل الإشعارات» في التطبيق زرًّا لا يفعل شيئاً —
-- وهو أسوأ من غيابه، لأن المالك يظنّ أنه سيُنبَّه لحجزٍ جديد فلا يُنبَّه.
--
-- الجهاز الأصلي يعطينا **رمزاً** (device token) لا endpoint/keys. نُعيد استخدام
-- الجدول نفسه بدل جدولٍ ثانٍ: العزل (RLS) وربط الملعب وتنظيف الأجهزة الميتة
-- ومسار الحذف — كلها مبنيّة هنا ومختبَرة، ونسخُها لجدولٍ موازٍ يعني نسخَ عيوبها
-- مرّتين. الرمز يسكن عمود endpoint (فريدٌ أصلاً)، ويميّزه عمود platform.

-- ─── عمود المنصّة ───────────────────────────────────────────────────────────
alter table public.push_subscriptions
  add column if not exists platform text not null default 'web';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'push_subscriptions_platform_chk'
  ) then
    alter table public.push_subscriptions
      add constraint push_subscriptions_platform_chk
      check (platform in ('web', 'ios', 'android'));
  end if;
end $$;

-- مفاتيح التعمية خاصة بـ Web Push وحده؛ الرمز الأصلي لا يحملها.
alter table public.push_subscriptions alter column p256dh_key drop not null;
alter table public.push_subscriptions alter column auth_key   drop not null;

-- شرطٌ يحمي التكامل: صفّ الويب يلزمه مفتاحاه، وصفّ الجهاز الأصلي لا. بلا هذا
-- الشرط يمكن أن يُدرَج صفُّ ويبٍ بلا مفاتيح فيفشل إرساله صامتاً عند أول إشعار.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'push_subscriptions_keys_chk'
  ) then
    alter table public.push_subscriptions
      add constraint push_subscriptions_keys_chk
      check (
        (platform = 'web'  and p256dh_key is not null and auth_key is not null)
        or
        (platform <> 'web')
      );
  end if;
end $$;

-- الإرسال يقرأ بحسب الملعب والمنصّة معاً (كل منصّة لها قناة إرسال مختلفة)
create index if not exists idx_push_sub_tenant_platform
  on public.push_subscriptions(tenant_id, platform);

comment on column public.push_subscriptions.platform is
  'web = Web Push (endpoint + مفاتيح) · ios = رمز جهاز APNs في endpoint · android = رمز FCM في endpoint';

-- ─── تسجيل رمز الجهاز الأصلي ────────────────────────────────────────────────
-- نظير claim_push_subscription للويب. السبب نفسه: رمز الجهاز واحدٌ على مستوى
-- الجهاز، فلو بدّل المالك حسابه على جوّاله بقي الجهاز يستقبل إشعارات الحساب
-- الأول للأبد. الدالة تنقل الملكية بدل أن تفشل بصمت أمام RLS.
create or replace function public.claim_native_push_token(
  p_token    text,
  p_platform text,
  p_device   text default null
) returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_uid    uuid;
  v_tenant uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_token is null or length(p_token) < 10 then
    return;   -- رمز ناقص → تجاهل صامت (الإشعارات كمالية ولا تعطّل الإقلاع)
  end if;
  if p_platform not in ('ios', 'android') then
    return;
  end if;

  select tenant_id into v_tenant from public.profiles where id = v_uid;
  if v_tenant is null then
    -- حساب بلا ملعب (مشرف عام): لا إشعارات له — نظّف أي صف قديم لهذا الجهاز
    delete from public.push_subscriptions where endpoint = p_token;
    return;
  end if;

  delete from public.push_subscriptions
  where endpoint = p_token and user_id <> v_uid;

  insert into public.push_subscriptions
    (user_id, tenant_id, endpoint, platform, p256dh_key, auth_key, user_agent)
  values
    (v_uid, v_tenant, p_token, p_platform, null, null, left(p_device, 300))
  on conflict (endpoint) do update set
    user_id      = excluded.user_id,
    tenant_id    = excluded.tenant_id,
    platform     = excluded.platform,
    user_agent   = excluded.user_agent,
    last_used_at = now(),
    failed_count = 0;
end;
$$;

revoke all on function public.claim_native_push_token(text, text, text) from public, anon;
grant execute on function public.claim_native_push_token(text, text, text) to authenticated;

comment on function public.claim_native_push_token(text, text, text) is
  'يسجّل رمز جهاز APNs/FCM لصاحب الجلسة وينقل ملكيته عند تبديل الحسابات على الجهاز نفسه.';
