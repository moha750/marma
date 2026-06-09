-- تعطيل/تفعيل مع سبب اختياري يُسجَّل في سجلّ الإجراءات (details.reason عند التعطيل)
drop function if exists public.admin_set_tenant_active(uuid, boolean);
create or replace function public.admin_set_tenant_active(p_tenant_id uuid, p_active boolean, p_reason text default null)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_details jsonb := '{}'::jsonb;
begin
  if not public.is_super_admin() then raise exception 'NOT_SUPER_ADMIN' using errcode = 'P0001'; end if;
  update public.tenants set suspended = not p_active where id = p_tenant_id;
  if not found then raise exception 'الملعب غير موجود' using errcode = 'P0001'; end if;
  if not p_active and coalesce(btrim(p_reason), '') <> '' then
    v_details := jsonb_build_object('reason', btrim(p_reason));
  end if;
  perform public.admin_log_action(
    case when p_active then 'activate' else 'suspend' end, p_tenant_id, v_details);
end;
$function$;
