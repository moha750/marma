-- تسجيلات أجهزة Apple Wallet — يملؤها PassKit عند إضافة العميل للبطاقة،
-- وتُقرأ عند إرسال إشعار التحديث (المرحلة ٤).
-- بلا أي سياسة RLS عمداً: تُدار حصراً من Edge Function بمفتاح service_role،
-- ولا يملك أي مستخدم سبباً لقراءة رموز الدفع الخاصة بأجهزة العملاء.
create table if not exists public.wallet_apple_registrations (
  id                uuid primary key default gen_random_uuid(),
  card_id           uuid not null references public.loyalty_cards(id) on delete cascade,
  device_library_id text not null,
  push_token        text not null,
  created_at        timestamptz not null default now(),
  unique (device_library_id, card_id)
);

create index if not exists idx_wallet_reg_card   on public.wallet_apple_registrations(card_id);
create index if not exists idx_wallet_reg_device on public.wallet_apple_registrations(device_library_id);

alter table public.wallet_apple_registrations enable row level security;
