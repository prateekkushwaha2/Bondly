-- Run this ONCE after the original schema.sql.
-- Safe to run again: the policy check and trigger replacement are idempotent.

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'payment_schedule'
      and policyname = 'Borrowers and lenders can update scheduled payments'
  ) then
    create policy "Borrowers and lenders can update scheduled payments"
      on public.payment_schedule for update
      using (
        exists (
          select 1 from public.agreements a
          where a.id = agreement_id
            and auth.uid() in (a.lender_id, a.borrower_id)
        )
      )
      with check (
        exists (
          select 1 from public.agreements a
          where a.id = agreement_id
            and auth.uid() in (a.lender_id, a.borrower_id)
        )
      );
  end if;
end;
$$;

create or replace function public.sync_outstanding_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

drop trigger if exists after_payment_recorded on public.payment_schedule;
create trigger after_payment_recorded
after update of status on public.payment_schedule
for each row execute procedure public.sync_outstanding_balance();
