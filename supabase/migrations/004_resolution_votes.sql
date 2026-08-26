-- Multi-party acceptance for AI resolution proposals.
create table if not exists public.resolution_case_votes (
  id uuid primary key default uuid_generate_v4(),
  case_id uuid not null references public.resolution_cases(id) on delete cascade,
  voter_id uuid not null references public.profiles(id),
  decision public.approval_status not null default 'pending',
  decided_at timestamptz,
  unique (case_id, voter_id)
);

alter table public.resolution_case_votes enable row level security;

create policy "Participants can read resolution votes"
  on public.resolution_case_votes for select
  using (exists (
    select 1 from public.resolution_cases c
    join public.agreements a on a.id = c.agreement_id
    where c.id = case_id and auth.uid() in (a.lender_id, a.borrower_id, a.guarantor_id)
  ));

create policy "Case opener can create required votes"
  on public.resolution_case_votes for insert
  with check (exists (select 1 from public.resolution_cases c where c.id = case_id and c.opened_by = auth.uid()));

create policy "Voters can decide their own resolution vote"
  on public.resolution_case_votes for update
  using (voter_id = auth.uid())
  with check (voter_id = auth.uid());

create or replace function public.sync_resolution_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  total_votes integer;
  accepted_votes integer;
begin
  if new.decision = 'declined' then
    update public.resolution_cases set status = 'declined', resolved_at = now() where id = new.case_id;
  elsif new.decision = 'approved' then
    select count(*), count(*) filter (where decision = 'approved')
      into total_votes, accepted_votes
      from public.resolution_case_votes where case_id = new.case_id;
    if total_votes = accepted_votes then
      update public.resolution_cases set status = 'accepted', resolved_at = now() where id = new.case_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists after_resolution_vote_change on public.resolution_case_votes;
create trigger after_resolution_vote_change
after update of decision on public.resolution_case_votes
for each row execute procedure public.sync_resolution_status();
