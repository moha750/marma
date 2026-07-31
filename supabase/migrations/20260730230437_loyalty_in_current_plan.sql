-- تضمين برنامج الولاء في الخطة الحالية.
--
-- العَلَم على الخطة وحده لا يكفي: لولا اشتقاقه في approve_subscription لبقي
-- زينةً — أي تجديد أو ترقية بعد اليوم كان سيُبقي loyalty_enabled على ما هو عليه
-- بدل أن يعكس ما تشتريه الخطة فعلاً. ولهذا نُعيد تعريف الدالة بنفس جسدها
-- الحالي مضافاً إليه سطران في كلا الفرعين (ترقية / تجديد-جديد).
--
-- سلوك التخفيض مقصود: النزول لخطة بلا ولاء يُطفئ الكسب الجديد، والبطاقات
-- الصادرة تبقى في جيوب العملاء وقسائمهم المتاحة تبقى قابلة للصرف (§10).

-- حدّ البطاقات الممنوح مع الخطة — عملياً بلا سقف لملعب واحد
-- (5000 بطاقة = 5000 عميل مختلف أنهى حجزاً مدفوعاً)

update public.plans set loyalty_included = true where is_active;

create or replace function public.approve_subscription(p_subscription_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sub record; v_plan record; v_tenant record;
  v_period_start timestamptz; v_period_end timestamptz;
  v_cur_fields int; v_cur_staff int;
  v_loyalty boolean; v_loyalty_cap int;
begin
  if not public.is_super_admin() then raise exception 'NOT_SUPER_ADMIN' using errcode = 'P0001'; end if;
  select * into v_sub from public.subscriptions where id = p_subscription_id for update;
  if not found then raise exception 'SUBSCRIPTION_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_sub.status <> 'pending' then raise exception 'SUBSCRIPTION_ALREADY_REVIEWED' using errcode = 'P0001'; end if;
  select * into v_plan from public.plans where id = v_sub.plan_id;
  if not found then raise exception 'PLAN_NOT_AVAILABLE' using errcode = 'P0001'; end if;
  select * into v_tenant from public.tenants where id = v_sub.tenant_id for update;

  -- ما تشتريه الخطة من الولاء
  v_loyalty     := coalesce(v_plan.loyalty_included, false);
  v_loyalty_cap := case when v_loyalty then 5000 else 0 end;

  if v_sub.kind = 'upgrade' then
    v_period_start := now();
    v_period_end   := v_tenant.subscription_ends_at;
    update public.subscriptions
      set status = 'approved', period_start = v_period_start, period_end = v_period_end,
          reviewed_by = auth.uid(), reviewed_at = now()
      where id = p_subscription_id;
    update public.tenants
      set allowed_fields = greatest(allowed_fields, coalesce(v_sub.requested_fields, allowed_fields)),
          allowed_staff  = greatest(allowed_staff,  coalesce(v_sub.requested_staff,  allowed_staff)),
          -- الترقية لا تسحب ميزة قائمة أبداً
          loyalty_enabled       = loyalty_enabled or v_loyalty,
          allowed_loyalty_cards = greatest(allowed_loyalty_cards, v_loyalty_cap)
      where id = v_sub.tenant_id;
  else
    -- تجديد/جديد: اضبط الحدّ = المطلوب، لكن لا تنزل أبداً تحت الاستخدام الفعلي
    select count(*)::int into v_cur_fields from public.fields   where tenant_id = v_tenant.id and is_active;
    select count(*)::int into v_cur_staff  from public.profiles where tenant_id = v_tenant.id and role = 'staff';
    v_period_start := greatest(
      now(),
      coalesce(v_tenant.subscription_ends_at, '-infinity'::timestamptz),
      coalesce(v_tenant.trial_ends_at,        '-infinity'::timestamptz)
    );
    v_period_end := v_period_start + make_interval(days => v_plan.duration_days);
    update public.subscriptions
      set status = 'approved', period_start = v_period_start, period_end = v_period_end,
          reviewed_by = auth.uid(), reviewed_at = now()
      where id = p_subscription_id;
    update public.tenants
      set subscription_ends_at = v_period_end,
          subscription_status  = 'active',
          allowed_fields = greatest(coalesce(v_sub.requested_fields, allowed_fields), v_cur_fields),
          allowed_staff  = greatest(coalesce(v_sub.requested_staff,  allowed_staff),  v_cur_staff),
          -- التجديد يعكس الخطة كما هي: صعوداً وهبوطاً
          loyalty_enabled       = v_loyalty,
          allowed_loyalty_cards = v_loyalty_cap
      where id = v_sub.tenant_id;
  end if;

  return jsonb_build_object(
    'subscription_id', p_subscription_id,
    'kind',            v_sub.kind,
    'period_start',    v_period_start,
    'period_end',      v_period_end
  );
end;
$function$;

-- تعبئة رجعية: كل المشتركين الحاليين على الخطة الوحيدة يحصلون على الميزة.
-- المعلَّقون مستثنون — تفعيل ميزة لحساب موقوف تناقض.
update public.tenants
   set loyalty_enabled       = true,
       allowed_loyalty_cards = greatest(allowed_loyalty_cards, 5000)
 where coalesce(subscription_status, '') <> 'suspended';
