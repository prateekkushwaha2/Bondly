-- Makes missed payments visibly overdue and adds a consent-based re-agreement workflow.
-- Run after migrations 002 through 013.

alter table public.notifications drop constraint if exists notifications_notification_type_check;
alter table public.notifications add constraint notifications_notification_type_check
  check (notification_type in ('upcoming_payment', 'payment_due', 'payment_overdue', 'agreement_invite', 'resolution_proposal', 'reagreement_proposal'));

create table if not exists public.reagreement_proposals (
  id uuid primary key default uuid_generate_v4(),
  agreement_id uuid not null references public.agreements(id) on delete cascade,
  proposed_by uuid not null references public.profiles(id),
  base_version integer not null,
  proposed_due_date date,
  proposed_interest_rate numeric(5,2) check (proposed_interest_rate >= 0),
  proposed_payment_amount numeric(14,2) check (proposed_payment_amount > 0),
  note text,
  status public.resolution_status not null default 'proposed',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (proposed_due_date is not null or proposed_interest_rate is not null or proposed_payment_amount is not null)
);

create table if not exists public.reagreement_votes (
  id uuid primary key default uuid_generate_v4(),
  proposal_id uuid not null references public.reagreement_proposals(id) on delete cascade,
  voter_id uuid not null references public.profiles(id),
  decision public.approval_status not null default 'pending',
  decided_at timestamptz,
  unique (proposal_id, voter_id)
);

alter table public.reagreement_proposals enable row level security;
alter table public.reagreement_votes enable row level security;

grant select, insert, update on public.reagreement_proposals to authenticated;
grant select, insert, update on public.reagreement_votes to authenticated;
grant select, insert, update on public.reagreement_proposals to service_role;
grant select, insert, update on public.reagreement_votes to service_role;

create policy "Participants can create re-agreement proposals" on public.reagreement_proposals for insert
  with check (proposed_by = auth.uid() and exists (select 1 from public.agreements a where a.id = agreement_id and auth.uid() in (a.lender_id, a.borrower_id, a.guarantor_id)));
create policy "Participants can read re-agreement proposals" on public.reagreement_proposals for select
  using (exists (select 1 from public.agreements a where a.id = agreement_id and auth.uid() in (a.lender_id, a.borrower_id, a.guarantor_id)));
create policy "Participants can read re-agreement votes" on public.reagreement_votes for select
  using (exists (select 1 from public.reagreement_proposals p join public.agreements a on a.id = p.agreement_id where p.id = proposal_id and auth.uid() in (a.lender_id, a.borrower_id, a.guarantor_id)));
create policy "Proposal creator can create re-agreement votes" on public.reagreement_votes for insert
  with check (exists (select 1 from public.reagreement_proposals p where p.id = proposal_id and p.proposed_by = auth.uid()));
create policy "Participants can decide their own re-agreement vote" on public.reagreement_votes for update
  using (voter_id = auth.uid()) with check (voter_id = auth.uid());

create or replace function public.sync_reagreement_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare total_votes integer; accepted_votes integer;
begin
  if new.decision = 'declined' then
    update public.reagreement_proposals set status = 'declined', resolved_at = now() where id = new.proposal_id;
  elsif new.decision = 'approved' then
    select count(*), count(*) filter (where decision = 'approved') into total_votes, accepted_votes from public.reagreement_votes where proposal_id = new.proposal_id;
    if total_votes = accepted_votes then update public.reagreement_proposals set status = 'accepted', resolved_at = now() where id = new.proposal_id; end if;
  end if;
  return new;
end; $$;

create or replace function public.apply_accepted_reagreement()
returns trigger language plpgsql security definer set search_path = public as $$
declare target_payment public.payment_schedule%rowtype; prior_terms jsonb;
begin
  if new.status <> 'accepted' or old.status is not distinct from 'accepted' then return new; end if;
  select * into target_payment from public.payment_schedule where agreement_id = new.agreement_id and status in ('scheduled', 'overdue') order by due_date, installment_number limit 1;
  if target_payment.id is null then raise exception 'No unpaid payment is available for this re-agreement'; end if;
  select jsonb_build_object('version', version, 'due_date', due_date, 'interest_rate', interest_rate, 'outstanding_amount', outstanding_amount) into prior_terms from public.agreements where id = new.agreement_id;
  update public.payment_schedule set due_date = coalesce(new.proposed_due_date, due_date), amount = coalesce(new.proposed_payment_amount, amount), status = 'scheduled' where id = target_payment.id;
  update public.agreements set due_date = coalesce(new.proposed_due_date, due_date), interest_rate = coalesce(new.proposed_interest_rate, interest_rate), status = 'active', version = version + 1,
    terms_snapshot = terms_snapshot || jsonb_build_object('previous_terms', prior_terms, 'latest_reagreement_proposal_id', new.id, 'latest_reagreement_terms', jsonb_build_object('due_date', new.proposed_due_date, 'interest_rate', new.proposed_interest_rate, 'payment_amount', new.proposed_payment_amount, 'note', new.note)), updated_at = now()
  where id = new.agreement_id;
  insert into public.activity_events (agreement_id, actor_id, event_type, metadata) values (new.agreement_id, new.proposed_by, 'reagreement_applied', jsonb_build_object('proposal_id', new.id, 'due_date', new.proposed_due_date, 'interest_rate', new.proposed_interest_rate, 'payment_amount', new.proposed_payment_amount));
  return new;
end; $$;

drop trigger if exists after_reagreement_vote_change on public.reagreement_votes;
create trigger after_reagreement_vote_change after update of decision on public.reagreement_votes for each row execute procedure public.sync_reagreement_status();
drop trigger if exists after_reagreement_accepted on public.reagreement_proposals;
create trigger after_reagreement_accepted after update of status on public.reagreement_proposals for each row execute procedure public.apply_accepted_reagreement();

create or replace function public.queue_due_payment_reminders()
returns integer language plpgsql security definer set search_path = public as $$
declare created_count integer := 0;
begin
  update public.payment_schedule set status = 'overdue' where status = 'scheduled' and due_date < current_date;
  update public.agreements a set status = 'overdue', updated_at = now()
  where a.status = 'active' and exists (select 1 from public.payment_schedule ps where ps.agreement_id = a.id and ps.status = 'overdue');
  insert into public.notifications (recipient_id, agreement_id, payment_id, notification_type, title, body)
  select recipient_id, ps.agreement_id, ps.id,
    case when ps.due_date < current_date then 'payment_overdue' when ps.due_date = current_date then 'payment_due' else 'upcoming_payment' end,
    case when ps.due_date < current_date then 'Payment overdue' when ps.due_date = current_date then 'Payment due today' else 'Payment coming up' end,
    format('INR %s repayment for %s is due %s.', to_char(ps.amount, 'FM999,999,999'), coalesce(a.purpose, 'your Bondly agreement'), to_char(ps.due_date, 'DD Mon'))
  from public.payment_schedule ps join public.agreements a on a.id = ps.agreement_id
  cross join lateral unnest(array[a.borrower_id, a.lender_id, a.guarantor_id]) as recipient_id
  where ps.status in ('scheduled', 'overdue') and ps.due_date <= current_date + 3
  on conflict do nothing;
  get diagnostics created_count = row_count;
  return created_count;
end; $$;
