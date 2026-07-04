-- توسيع Realtime replication ليشمل الاشتراكات والمنشأة والجدول والعروض والموظفين.
-- RLS على كل جدول يضمن أن المستخدم يستلم بيانات منشأته/صلاحيته فقط.
alter publication supabase_realtime add table public.tenants;
alter publication supabase_realtime add table public.subscriptions;
alter publication supabase_realtime add table public.working_periods;
alter publication supabase_realtime add table public.staff_invitations;
alter publication supabase_realtime add table public.profiles;
alter publication supabase_realtime add table public.field_offers;
alter publication supabase_realtime add table public.offer_targets;
