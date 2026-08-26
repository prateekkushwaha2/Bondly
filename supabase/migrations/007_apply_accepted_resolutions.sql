-- Applies unanimously accepted AI proposals to the repayment ledger.
-- Supports an extension or a two-part plan when the agreement has one unpaid schedule entry.

create or replace function public.apply_accepted_resolution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_payment public.payment_schedule%rowtype;
  option_name text;
  extension_days integer;
  installment_amount numeric(14,2);
  unpaid_payment_count integer;
begin
  if new.status <> 'accepted' or old.status is not distinct from 'accepted' then
    return new;
  end if;

  option_name := new.proposed_terms ->> 'option';

  select * into target_payment
  from public.payment_schedule
  where agreement_id = new.agreement_id
    and status in ('scheduled', 'overdue')
  order by due_date, installment_number
  limit 1;

  if target_payment.id is null then
    raise exception 'No unpaid payment is available for this resolution';
  end if;

  if option_name = 'extension' then
    extension_days := coalesce((new.proposed_terms ->> 'extension_days')::integer, 0);
    if extension_days <= 0 then raise exception 'Extension must include positive extension_days'; end if;

    update public.payment_schedule
    set due_date = target_payment.due_date + extension_days,
        status = 'scheduled'
    where id = target_payment.id;

  elsif option_name = 'installment_plan' then
    if coalesce((new.proposed_terms ->> 'installments')::integer, 0) <> 2 then
      raise exception 'Only a two-part repayment plan is supported at this time';
    end if;
    select count(*) into unpaid_payment_count
    from public.payment_schedule
    where agreement_id = new.agreement_id and status in ('scheduled', 'overdue');
    if unpaid_payment_count <> 1 then
      raise exception 'A two-part plan can be applied only when one unpaid payment remains';
    end if;
    installment_amount := round(target_payment.amount / 2, 2);

    delete from public.payment_schedule where id = target_payment.id;
    insert into public.payment_schedule (agreement_id, installment_number, due_date, amount, status)
    values
      (new.agreement_id, target_payment.installment_number, target_payment.due_date + 7, installment_amount, 'scheduled'),
      (new.agreement_id, target_payment.installment_number + 1, target_payment.due_date + 14, target_payment.amount - installment_amount, 'scheduled');
  else
    -- A gentle reminder is an accepted communication action; it does not alter terms.
    return new;
  end if;

  update public.agreements
  set version = version + 1,
      terms_snapshot = terms_snapshot || jsonb_build_object('latest_resolution_case_id', new.id, 'latest_resolution_terms', new.proposed_terms),
      updated_at = now()
  where id = new.agreement_id;

  insert into public.activity_events (agreement_id, actor_id, event_type, metadata)
  values (new.agreement_id, new.opened_by, 'resolution_terms_applied', new.proposed_terms);

  return new;
end;
$$;

drop trigger if exists after_resolution_accepted on public.resolution_cases;
create trigger after_resolution_accepted
after update of status on public.resolution_cases
for each row execute procedure public.apply_accepted_resolution();
