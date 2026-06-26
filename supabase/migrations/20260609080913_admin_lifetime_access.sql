-- وصول دائم (ألماسي): حساب مفتوح مدى الحياة بكل المميزات بلا حدود
alter table public.tenants add column if not exists lifetime boolean not null default false;

-- 1) بوابة النشاط العامة (صفحة الحجز وغيرها): الدائم نشط دائمًا ما لم يُعطَّل
create or replace function public.is_tenant_active(p_tenant_id uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select exists (
    select 1 from public.tenants
    where id = p_tenant_id
      and not coalesce(suspended, false)
      and (
        coalesce(lifetime, false)
        or now() < case
          when subscription_ends_at is not null then subscription_ends_at + interval '3 days'
          when trial_ends_at        is not null then trial_ends_at
          else 'epoch'::timestamptz
        end
      )
  )
$function$;

-- 2) تجاوز حدّ الأرضيات للحساب الدائم
create or replace function public.enforce_field_limit()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_allowed int; v_current int; v_lifetime boolean;
begin
  if TG_OP = 'INSERT' or (TG_OP = 'UPDATE' and NEW.is_active and not OLD.is_active) then
    select allowed_fields, coalesce(lifetime, false) into v_allowed, v_lifetime
    from public.tenants where id = NEW.tenant_id;
    if v_lifetime then return NEW; end if;           -- دائم ⇒ بلا حدّ
    if v_allowed is null then return NEW; end if;
    select count(*) into v_current
    from public.fields
    where tenant_id = NEW.tenant_id and is_active
      and id <> coalesce(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
    if v_current >= v_allowed then
      raise exception 'FIELD_LIMIT_REACHED' using errcode = 'P0001';
    end if;
  end if;
  return NEW;
end;
$function$;

-- 3) تجاوز حدّ الموظفين للحساب الدائم
create or replace function public.enforce_staff_limit()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_allowed int; v_current_staff int; v_pending_invites int; v_lifetime boolean;
begin
  select allowed_staff, coalesce(lifetime, false) into v_allowed, v_lifetime
  from public.tenants where id = NEW.tenant_id;
  if v_lifetime then return NEW; end if;             -- دائم ⇒ بلا حدّ
  if v_allowed is null then return NEW; end if;
  select count(*) into v_current_staff
  from public.profiles where tenant_id = NEW.tenant_id and role = 'staff';
  select count(*) into v_pending_invites
  from public.staff_invitations
  where tenant_id = NEW.tenant_id and used_at is null and expires_at > now()
    and id <> coalesce(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
  if v_current_staff + v_pending_invites >= v_allowed then
    raise exception 'STAFF_LIMIT_REACHED' using errcode = 'P0001';
  end if;
  return NEW;
end;
$function$;

-- 4) منح/إلغاء الوصول الدائم (مع تسجيل)
create or replace function public.admin_grant_lifetime(p_tenant_id uuid, p_reason text default null)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_details jsonb := '{}'::jsonb;
begin
  if not public.is_super_admin() then raise exception 'NOT_SUPER_ADMIN' using errcode = 'P0001'; end if;
  update public.tenants set lifetime = true, suspended = false where id = p_tenant_id;
  if not found then raise exception 'الملعب غير موجود' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_reason), '') <> '' then v_details := jsonb_build_object('reason', btrim(p_reason)); end if;
  perform public.admin_log_action('grant_lifetime', p_tenant_id, v_details);
end;
$function$;

create or replace function public.admin_revoke_lifetime(p_tenant_id uuid, p_reason text default null)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_details jsonb := '{}'::jsonb;
begin
  if not public.is_super_admin() then raise exception 'NOT_SUPER_ADMIN' using errcode = 'P0001'; end if;
  update public.tenants set lifetime = false where id = p_tenant_id;
  if not found then raise exception 'الملعب غير موجود' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_reason), '') <> '' then v_details := jsonb_build_object('reason', btrim(p_reason)); end if;
  perform public.admin_log_action('revoke_lifetime', p_tenant_id, v_details);
end;
$function$;
