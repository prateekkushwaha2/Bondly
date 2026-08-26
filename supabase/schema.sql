-- Bondly database schema. Run this in the Supabase SQL Editor.
create extension if not exists "uuid-ossp";

create type public.bondly_role as enum ('lender', 'borrower', 'guarantor');
create type public.agreement_status as enum ('draft', 'pending_approval', 'active', 'completed', 'overdue', 'cancelled');
create type public.approval_status as enum ('pending', 'approved', 'declined');
create type public.payment_status as enum ('scheduled', 'paid', 'failed', 'overdue');
create type public.resolution_status as enum ('open', 'proposed', 'accepted', 'declined', 'closed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  primary_role public.bondly_role not null default 'borrower',
  phone text,
  preferred_reserve numeric(14,2) not null default 0 check (preferred_reserve >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.agreements (
  id uuid primary key default uuid_generate_v4(),
  lender_id uuid not null references public.profiles(id),
  borrower_id uuid not null references public.profiles(id),
  guarantor_id uuid references public.profiles(id),
  amount numeric(14,2) not null check (amount > 0),
  outstanding_amount numeric(14,2) not null check (outstanding_amount >= 0),
  interest_rate numeric(5,2) not null default 0 check (interest_rate >= 0),
  purpose text,
  due_date date not null,
  repayment_type text not null default 'one_time' check (repayment_type in ('one_time', 'installments', 'auto_pay')),
  installment_count integer check (installment_count is null or installment_count > 0),
  status public.agreement_status not null default 'draft',
  version integer not null default 1,
  terms_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (lender_id <> borrower_id),
  check (guarantor_id is null or guarantor_id <> lender_id and guarantor_id <> borrower_id)
);

create table public.approvals (
  id uuid primary key default uuid_generate_v4(),
  agreement_id uuid not null references public.agreements(id) on delete cascade,
  approver_id uuid not null references public.profiles(id),
  status public.approval_status not null default 'pending',
  approved_at timestamptz,
  agreement_version integer not null,
  unique (agreement_id, approver_id, agreement_version)
);

create table public.payment_schedule (
  id uuid primary key default uuid_generate_v4(),
  agreement_id uuid not null references public.agreements(id) on delete cascade,
  installment_number integer not null default 1,
  due_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  status public.payment_status not null default 'scheduled',
  paid_at timestamptz,
  payment_reference text,
  unique (agreement_id, installment_number)
);

create table public.resolution_cases (
  id uuid primary key default uuid_generate_v4(),
  agreement_id uuid not null references public.agreements(id) on delete cascade,
  opened_by uuid not null references public.profiles(id),
  status public.resolution_status not null default 'open',
  ai_summary text,
  proposed_terms jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table public.activity_events (
  id uuid primary key default uuid_generate_v4(),
  agreement_id uuid references public.agreements(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.agreements enable row level security;
alter table public.approvals enable row level security;
alter table public.payment_schedule enable row level security;
alter table public.resolution_cases enable row level security;
alter table public.activity_events enable row level security;

create policy "Users can view their own profile" on public.profiles for select using (id = auth.uid());
create policy "Users can update their own profile" on public.profiles for update using (id = auth.uid());
create policy "Participants can read agreements" on public.agreements for select using (auth.uid() in (lender_id, borrower_id, guarantor_id));
create policy "Lenders can create agreements" on public.agreements for insert with check (auth.uid() = lender_id);
create policy "Lenders can create approval requests" on public.approvals for insert with check (exists (select 1 from public.agreements a where a.id = agreement_id and a.lender_id = auth.uid()));
create policy "Lenders can create payment schedules" on public.payment_schedule for insert with check (exists (select 1 from public.agreements a where a.id = agreement_id and a.lender_id = auth.uid()));
create policy "Participants can create activity events" on public.activity_events for insert with check (exists (select 1 from public.agreements a where a.id = agreement_id and auth.uid() in (a.lender_id, a.borrower_id, a.guarantor_id)));
create policy "Participants can read approvals" on public.approvals for select using (exists (select 1 from public.agreements a where a.id = agreement_id and auth.uid() in (a.lender_id, a.borrower_id, a.guarantor_id)));
create policy "Approvers can update their own approval" on public.approvals for update using (approver_id = auth.uid()) with check (approver_id = auth.uid());
create policy "Participants can read payment schedules" on public.payment_schedule for select using (exists (select 1 from public.agreements a where a.id = agreement_id and auth.uid() in (a.lender_id, a.borrower_id, a.guarantor_id)));
create policy "Borrowers and lenders can update scheduled payments" on public.payment_schedule for update using (exists (select 1 from public.agreements a where a.id = agreement_id and auth.uid() in (a.lender_id, a.borrower_id))) with check (exists (select 1 from public.agreements a where a.id = agreement_id and auth.uid() in (a.lender_id, a.borrower_id)));
create policy "Participants can read cases" on public.resolution_cases for select using (exists (select 1 from public.agreements a where a.id = agreement_id and auth.uid() in (a.lender_id, a.borrower_id, a.guarantor_id)));
create policy "Participants can read activity" on public.activity_events for select using (exists (select 1 from public.agreements a where a.id = agreement_id and auth.uid() in (a.lender_id, a.borrower_id, a.guarantor_id)));

-- New user profile is created immediately after Supabase Auth signup.
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, primary_role)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', 'Bondly member'), coalesce((new.raw_user_meta_data ->> 'primary_role')::public.bondly_role, 'borrower'));
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

-- An agreement becomes active only after every required participant has approved.
create or replace function public.sync_agreement_approval_status() returns trigger language plpgsql security definer set search_path = public as $$
declare
  required_count integer;
  approved_count integer;
begin
  select case when guarantor_id is null then 2 else 3 end into required_count from public.agreements where id = new.agreement_id;
  select count(*) into approved_count from public.approvals where agreement_id = new.agreement_id and agreement_version = new.agreement_version and status = 'approved';
  if new.status = 'declined' then
    update public.agreements set status = 'cancelled', updated_at = now() where id = new.agreement_id;
  elsif approved_count = required_count then
    update public.agreements set status = 'active', updated_at = now() where id = new.agreement_id;
  end if;
  return new;
end;
$$;
create trigger after_approval_change after update of status on public.approvals for each row execute procedure public.sync_agreement_approval_status();

-- Keep the loan balance accurate whenever a scheduled payment becomes paid.
create or replace function public.sync_outstanding_balance() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    update public.agreements
    set outstanding_amount = greatest(0, outstanding_amount - new.amount),
        status = case when outstanding_amount - new.amount <= 0 then 'completed' else status end,
        updated_at = now()
    where id = new.agreement_id;
  end if;
  return new;
end;
$$;
create trigger after_payment_recorded after update of status on public.payment_schedule for each row execute procedure public.sync_outstanding_balance();
