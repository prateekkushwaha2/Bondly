-- Financial Intelligence Layer: voluntary data, private by default, shared only as agreement-specific snapshots.
create table if not exists public.financial_contexts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  liquid_funds numeric(14,2) not null default 0 check (liquid_funds >= 0),
  monthly_income numeric(14,2) not null default 0 check (monthly_income >= 0),
  monthly_emi numeric(14,2) not null default 0 check (monthly_emi >= 0),
  upcoming_obligations numeric(14,2) not null default 0 check (upcoming_obligations >= 0),
  emergency_reserve numeric(14,2) not null default 0 check (emergency_reserve >= 0),
  essential_fund_reserve numeric(14,2) not null default 0 check (essential_fund_reserve >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.financial_context_shares (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  agreement_id uuid not null references public.agreements(id) on delete cascade,
  shared_snapshot jsonb not null,
  includes_repayment_history boolean not null default true,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (owner_id, agreement_id)
);

alter table public.financial_contexts enable row level security;
alter table public.financial_context_shares enable row level security;

create policy "Users manage their own financial context"
  on public.financial_contexts for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Owners create financial context shares"
  on public.financial_context_shares for insert
  with check (
    owner_id = auth.uid()
    and exists (select 1 from public.agreements a where a.id = agreement_id and auth.uid() in (a.lender_id, a.borrower_id, a.guarantor_id))
  );

create policy "Owners manage their own financial context shares"
  on public.financial_context_shares for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "Agreement participants read active shared snapshots"
  on public.financial_context_shares for select
  using (
    revoked_at is null
    and (expires_at is null or expires_at > now())
    and exists (select 1 from public.agreements a where a.id = agreement_id and auth.uid() in (a.lender_id, a.borrower_id, a.guarantor_id))
  );

grant select, insert, update on public.financial_contexts to authenticated;
grant select, insert, update on public.financial_context_shares to authenticated;
grant select, insert, update on public.financial_contexts to service_role;
grant select, insert, update on public.financial_context_shares to service_role;
