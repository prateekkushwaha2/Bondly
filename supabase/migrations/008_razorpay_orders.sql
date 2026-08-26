-- Maps a Bondly scheduled payment to one Razorpay order.
create table if not exists public.razorpay_orders (
  id uuid primary key default uuid_generate_v4(),
  payment_id uuid not null unique references public.payment_schedule(id) on delete cascade,
  razorpay_order_id text not null unique,
  amount_paise integer not null check (amount_paise > 0),
  status text not null default 'created' check (status in ('created', 'paid', 'failed')),
  razorpay_payment_id text unique,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.razorpay_orders enable row level security;
-- No browser policies: these records are accessed only by Edge Functions.
