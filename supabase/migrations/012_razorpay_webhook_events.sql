-- Idempotency records for Razorpay server-to-server webhooks.
create table if not exists public.razorpay_webhook_events (
  event_id text primary key,
  event_type text not null,
  received_at timestamptz not null default now()
);

alter table public.razorpay_webhook_events enable row level security;
grant select, insert on public.razorpay_webhook_events to service_role;
