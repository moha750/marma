-- تفعيل Realtime replication للجداول التي يشترك بها العميل (src/core/realtime.js).
-- RLS تضمن أن كل مستخدم يستلم تغييرات بيانات منشأته فقط.
alter publication supabase_realtime add table public.bookings;
alter publication supabase_realtime add table public.customers;
alter publication supabase_realtime add table public.fields;
