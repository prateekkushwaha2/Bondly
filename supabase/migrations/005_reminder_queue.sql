-- In-app reminder queue. A scheduled job can run queue_due_payment_reminders() daily.
create table if not exists public.notifications (
  id uuid primary key default uuid_generate_v4(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  agreement_id uuid references public.agreements(id) on delete cascade,
  payment_id uuid references public.payment_schedule(id) on delete cascade,
  notification_type text not null check (notification_type in ('upcoming_payment', 'payment_due', 'payment_overdue', 'agreement_invite', 'resolution_proposal')),
  title text not null,
  body text not null,
  channel text not null default 'in_app' check (channel in ('in_app', 'email', 'whatsapp')),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists reminders_one_per_payment_type_day
  on public.notifications (payment_id, recipient_id, notification_type, ((created_at at time zone 'utc')::date))
  where payment_id is not null;

alter table public.notifications enable row level security;

create policy "Recipients can read their notifications"
  on public.notifications for select using (recipient_id = auth.uid());
create policy "Recipients can mark their notifications read"
  on public.notifications for update using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

create or replace function public.queue_due_payment_reminders()
returns integer language plpgsql security definer set search_path = public as $$
declare
  created_count integer := 0;
begin
  insert into public.notifications (recipient_id, agreement_id, payment_id, notification_type, title, body)
  select p.borrower_id, ps.agreement_id, ps.id,
    case when ps.due_date < current_date then 'payment_overdue' when ps.due_date = current_date then 'payment_due' else 'upcoming_payment' end,
    case when ps.due_date < current_date then 'Payment overdue' when ps.due_date = current_date then 'Payment due today' else 'Payment coming up' end,
    format('Your ₹%s repayment for %s is due %s.', to_char(ps.amount, 'FM999,999,999'), coalesce(a.purpose, 'your Bondly agreement'), to_char(ps.due_date, 'DD Mon'))
  from public.payment_schedule ps
  join public.agreements a on a.id = ps.agreement_id
  join public.profiles p on p.id = a.borrower_id
  where ps.status in ('scheduled', 'overdue')
    and ps.due_date <= current_date + 3
  on conflict do nothing;
  get diagnostics created_count = row_count;
  return created_count;
end;
$$;

-- In Supabase Dashboard, schedule once daily after enabling pg_cron:
-- select cron.schedule('bondly-payment-reminders', '0 9 * * *', $$select public.queue_due_payment_reminders();$$);
