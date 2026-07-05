-- شعار المالك (logo_url) — يظهر في صفحة الحجز العامة (رأس + favicon)،
-- ولوحة الأدمن، وشريط لوحة المالك الجانبي، وإيميلات الحجز.
-- ----------------------------------------------------------------------------
-- التخزين: نفس bucket صور الأرضيات (field-images) بمسار ${tenant_id}/_tenant/logo-*
-- فتنطبق سياساته الحالية (المجلد الأول = tenant_id). الرفع من الإعدادات بقصّ مربع.

alter table public.tenants add column if not exists logo_url text;

-- ─── الدالة العامة: أضف logo_url (النسخة الحالية من الإنتاج + سطران) ───
CREATE OR REPLACE FUNCTION public.get_public_tenant_info(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant    record;
  v_fields    jsonb;
  v_is_active boolean;
BEGIN
  SELECT id, name, description, cover_image_url, logo_url, subscription_status
    INTO v_tenant
  FROM public.tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_is_active := public.is_tenant_active(p_tenant_id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',           f.id,
    'name',         f.name,
    'city',         f.city,
    'phone',        f.phone,
    'location_url', f.location_url,
    'latitude',     f.latitude,
    'longitude',    f.longitude,
    'image_urls',   COALESCE(f.image_urls, '{}'),
    'description',  f.description,
    'surface_type', f.surface_type,
    'amenities',    COALESCE(f.amenities, '{}')
  ) ORDER BY f.display_order, f.name), '[]'::jsonb) INTO v_fields
  FROM public.fields f
  WHERE f.tenant_id = p_tenant_id AND f.is_active = true;

  RETURN jsonb_build_object(
    'id',                  v_tenant.id,
    'name',                v_tenant.name,
    'description',         v_tenant.description,
    'cover_image_url',     v_tenant.cover_image_url,
    'logo_url',            v_tenant.logo_url,
    'is_active',           v_is_active,
    'subscription_status', v_tenant.subscription_status,
    'fields',              v_fields
  );
END;
$function$;

-- ─── قائمة الملاعب للأدمن: إضافة عمود logo_url تتطلب drop (تغيير نوع الإرجاع) ───
drop function if exists public.admin_list_tenants();

CREATE OR REPLACE FUNCTION public.admin_list_tenants()
 RETURNS TABLE(id uuid, name text, logo_url text, cities text, trial_ends_at timestamp with time zone, subscription_ends_at timestamp with time zone, subscription_status text, is_active boolean, suspended boolean, lifetime boolean, created_at timestamp with time zone, last_subscription_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_super_admin() then raise exception 'NOT_SUPER_ADMIN' using errcode = 'P0001'; end if;
  return query
  select
    t.id, t.name, t.logo_url,
    (select string_agg(distinct f.city, ' · ' order by f.city)
       from public.fields f
       where f.tenant_id = t.id and f.city is not null and f.city <> '') as cities,
    t.trial_ends_at, t.subscription_ends_at, t.subscription_status,
    public.is_tenant_active(t.id) as is_active,
    coalesce(t.suspended, false) as suspended,
    coalesce(t.lifetime, false) as lifetime,
    t.created_at,
    (select max(s.reviewed_at) from public.subscriptions s
     where s.tenant_id = t.id and s.status = 'approved') as last_subscription_at
  from public.tenants t
  order by t.created_at desc;
end;
$function$;

revoke all on function public.admin_list_tenants() from public, anon;
grant execute on function public.admin_list_tenants() to authenticated;

-- ─── تفاصيل الملعب للأدمن: أضف logo_url لكائن tenant ───
CREATE OR REPLACE FUNCTION public.admin_tenant_detail(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant record;
  v_owner_name text; v_owner_email text;
  v_fields int; v_staff int; v_bookings int; v_subs jsonb; v_audit jsonb;
begin
  if not public.is_super_admin() then raise exception 'NOT_SUPER_ADMIN' using errcode = 'P0001'; end if;

  select * into v_tenant from public.tenants where id = p_tenant_id;
  if not found then raise exception 'الملعب غير موجود' using errcode = 'P0001'; end if;

  select pr.full_name, au.email into v_owner_name, v_owner_email
  from public.profiles pr join auth.users au on au.id = pr.id
  where pr.tenant_id = p_tenant_id and pr.role = 'owner'
  limit 1;

  select count(*) into v_fields   from public.fields   where tenant_id = p_tenant_id;
  select count(*) into v_staff    from public.profiles where tenant_id = p_tenant_id and role = 'staff';
  select count(*) into v_bookings from public.bookings where tenant_id = p_tenant_id;

  select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at desc), '[]'::jsonb) into v_subs
  from (
    select id, status, kind, amount, requested_fields, requested_staff, payment_reference, receipt_path,
           note, period_start, period_end, created_at, reviewed_at, reject_reason
    from public.subscriptions where tenant_id = p_tenant_id
  ) s;

  select coalesce(jsonb_agg(x order by ord desc), '[]'::jsonb) into v_audit
  from (
    select jsonb_build_object(
      'id', a.id, 'action', a.action, 'details', a.details, 'created_at', a.created_at,
      'actor', coalesce(u.raw_user_meta_data->>'display_name', u.raw_user_meta_data->>'full_name', u.email)
    ) as x, a.created_at as ord
    from public.admin_audit_log a
    left join auth.users u on u.id = a.actor_id
    where a.tenant_id = p_tenant_id
    order by a.created_at desc
    limit 100
  ) s;

  return jsonb_build_object(
    'tenant', jsonb_build_object(
      'id', v_tenant.id, 'name', v_tenant.name, 'logo_url', v_tenant.logo_url, 'created_at', v_tenant.created_at,
      'trial_ends_at', v_tenant.trial_ends_at, 'subscription_ends_at', v_tenant.subscription_ends_at,
      'subscription_status', v_tenant.subscription_status,
      'allowed_fields', v_tenant.allowed_fields, 'allowed_staff', v_tenant.allowed_staff,
      'suspended', v_tenant.suspended, 'lifetime', coalesce(v_tenant.lifetime, false)
    ),
    'is_active', public.is_tenant_active(p_tenant_id),
    'owner', jsonb_build_object('full_name', v_owner_name, 'email', v_owner_email),
    'counts', jsonb_build_object('fields', v_fields, 'staff', v_staff, 'bookings', v_bookings),
    'subscriptions', v_subs,
    'audit', v_audit
  );
end;
$function$;
