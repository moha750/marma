-- إنهاء التجربة فورًا (إلغاء تمديد بالخطأ أو إنهاء مبكر)
create or replace function public.admin_end_trial(p_tenant_id uuid, p_reason text default null)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_details jsonb := '{}'::jsonb;
begin
  if not public.is_super_admin() then raise exception 'NOT_SUPER_ADMIN' using errcode = 'P0001'; end if;
  update public.tenants set trial_ends_at = now() where id = p_tenant_id;
  if not found then raise exception 'الملعب غير موجود' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_reason), '') <> '' then v_details := jsonb_build_object('reason', btrim(p_reason)); end if;
  perform public.admin_log_action('end_trial', p_tenant_id, v_details);
end;
$function$;

-- إنهاء الاشتراك فورًا (إلغاء منحة): يُزال تاريخ نهاية الاشتراك فيعود الملعب لمنطق التجربة
create or replace function public.admin_end_subscription(p_tenant_id uuid, p_reason text default null)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_details jsonb := '{}'::jsonb;
begin
  if not public.is_super_admin() then raise exception 'NOT_SUPER_ADMIN' using errcode = 'P0001'; end if;
  update public.tenants
  set subscription_ends_at = null, subscription_status = 'expired'
  where id = p_tenant_id;
  if not found then raise exception 'الملعب غير موجود' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_reason), '') <> '' then v_details := jsonb_build_object('reason', btrim(p_reason)); end if;
  perform public.admin_log_action('end_subscription', p_tenant_id, v_details);
end;
$function$;
