-- إصلاح: إشعار الجرس «أُلغي حجز» لم يكن ينطلق أبدًا.
-- الشرط كان NEW.cancelled_by IS NULL بينما إلغاء العميل يكتب 'customer'
-- (وإلغاء الإدارة يكتب 'staff' — لا إشعار له عمدًا لأن الإدارة نفسها من ألغى).
-- تحسين مرافق: الحجوزات المؤكّدة تفقد customer_input_name عند الموافقة،
-- فنأخذ الاسم من سجل العميل ليظهر اسم من ألغى بدل «عميل».

create or replace function public.trg_notify_booking() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_field text; v_customer text;
begin
  if TG_OP = 'INSERT' then
    if NEW.status = 'pending' then
      select name into v_field from public.fields where id = NEW.field_id;
      perform public.notify_create('owner', NEW.tenant_id, 'booking_new',
        'حجز جديد',
        coalesce(NEW.customer_input_name, 'عميل') || ' — ' || coalesce(v_field, 'ملعب'),
        '/bookings', jsonb_build_object('booking_id', NEW.id));
    end if;
  elsif TG_OP = 'UPDATE' then
    if NEW.status = 'cancelled' and OLD.status is distinct from 'cancelled' and NEW.cancelled_by = 'customer' then
      select name into v_field from public.fields where id = NEW.field_id;
      select full_name into v_customer from public.customers where id = NEW.customer_id;
      perform public.notify_create('owner', NEW.tenant_id, 'booking_cancelled',
        'ألغى العميل حجزه',
        coalesce(NEW.customer_input_name, v_customer, 'عميل') || ' — ' || coalesce(v_field, 'ملعب'),
        '/bookings', jsonb_build_object('booking_id', NEW.id));
    end if;
  end if;
  return null;
end $$;
