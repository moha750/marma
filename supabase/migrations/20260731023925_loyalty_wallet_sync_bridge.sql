-- جسر تحديث المحافظ: من دفتر الحركات إلى جهاز العميل.
--
-- خنق التدفّق: إصدار قسيمة واحدة يُنتج ٣ كتابات (حركة كسب + حركة إصدار + صف
-- القسيمة)، وكل واحدة كانت ستُطلق نبضة. الفهرس الفريد الجزئي يجعل الطابور
-- يحمل صفاً معلّقاً واحداً لكل (بطاقة، هدف)، فتنهار الدفعة إلى نبضة واحدة —
-- والنداء الشبكي لا يُطلق إلا إن أُدرج صفّ فعلاً.
create unique index if not exists wallet_sync_pending_once
  on public.wallet_sync_queue(card_id, target) where done_at is null;

create or replace function public.loyalty_notify_sync(p_card_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_inserted int;
  v_url text;
  v_secret text;
begin
  insert into public.wallet_sync_queue(card_id, target)
  values (p_card_id, 'apple'), (p_card_id, 'google')
  on conflict do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return; end if;   -- نبضة معلّقة أصلاً

  v_url    := public._get_vault_secret('PROJECT_URL');
  v_secret := public._get_vault_secret('INTERNAL_HOOK_SECRET');
  if v_url is null or v_secret is null then return; end if;

  -- best-effort: فشل الإخطار لا يُفشل الحركة المالية أبداً، والـ cron يلتقط الباقي
  begin
    perform net.http_post(
      url     := v_url || '/functions/v1/wallet-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_secret
      ),
      body    := jsonb_build_object('card_id', p_card_id::text)
    );
  exception when others then
    raise warning 'wallet-sync call failed: %', sqlerrm;
  end;
end $$;

revoke all on function public.loyalty_notify_sync(uuid) from public, anon, authenticated;

-- شبكة الأمان: تصريف ما فشل أو ما لم يصله نداء
create or replace function public.wallet_sync_drain()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_url text; v_secret text; v_pending int;
begin
  select count(*) into v_pending
    from public.wallet_sync_queue
   where done_at is null and attempts < 5;
  if v_pending = 0 then return; end if;

  v_url    := public._get_vault_secret('PROJECT_URL');
  v_secret := public._get_vault_secret('INTERNAL_HOOK_SECRET');
  if v_url is null or v_secret is null then return; end if;

  perform net.http_post(
    url     := v_url || '/functions/v1/wallet-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body    := jsonb_build_object('drain', true)
  );
end $$;

revoke all on function public.wallet_sync_drain() from public, anon, authenticated;
grant execute on function public.wallet_sync_drain() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'wallet-sync-drain') then
    perform cron.unschedule('wallet-sync-drain');
  end if;
end $$;

select cron.schedule('wallet-sync-drain', '*/5 * * * *',
                     $$select public.wallet_sync_drain()$$);
