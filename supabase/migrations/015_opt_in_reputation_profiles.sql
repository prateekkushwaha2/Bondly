-- Member-searchable, opt-in reputation profiles. These are factual aggregates,
-- not credit scores and do not expose private financial data.

create table if not exists public.reputation_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  display_name text not null,
  is_public boolean not null default false,
  role_badges text[] not null default '{}',
  total_agreements integer not null default 0 check (total_agreements >= 0),
  completed_agreements integer not null default 0 check (completed_agreements >= 0),
  scheduled_payments integer not null default 0 check (scheduled_payments >= 0),
  paid_payments integer not null default 0 check (paid_payments >= 0),
  overdue_payments integer not null default 0 check (overdue_payments >= 0),
  on_time_paid_payments integer not null default 0 check (on_time_paid_payments >= 0),
  ai_summary text not null default '',
  methodology jsonb not null default '{}'::jsonb,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (completed_agreements <= total_agreements),
  check (on_time_paid_payments <= paid_payments)
);

alter table public.reputation_profiles enable row level security;

create policy "Members can read published reputation profiles"
  on public.reputation_profiles for select to authenticated
  using (is_public or user_id = auth.uid());

-- Clients can read only. The authenticated Edge Function owns calculation,
-- AI text, and visibility updates so a user cannot forge their history.
grant select on public.reputation_profiles to authenticated;
grant select, insert, update on public.reputation_profiles to service_role;

-- Required by reputation-agent when it calculates a server-verified snapshot
-- or repairs an old account that predates the profile-creation trigger.
grant usage on schema public to service_role;
grant select, insert, update on public.profiles to service_role;
grant select on public.agreements to service_role;
grant select on public.payment_schedule to service_role;
