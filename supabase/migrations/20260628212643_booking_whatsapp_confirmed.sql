-- تتبّع إرسال تأكيد الحجز عبر واتساب — لإخفاء/تحويل الزر بعد الإرسال من لوحة التحكم
alter table public.bookings
  add column if not exists whatsapp_confirmed_at timestamptz;

comment on column public.bookings.whatsapp_confirmed_at is
  'وقت آخر إرسال لتأكيد الحجز عبر واتساب من لوحة التحكم (null = لم يُرسَل بعد).';
