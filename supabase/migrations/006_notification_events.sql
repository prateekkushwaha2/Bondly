-- Allows a participant to create inbox entries for other participants.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'notifications'
      and policyname = 'Participants can create notifications for agreement participants'
  ) then
    create policy "Participants can create notifications for agreement participants"
      on public.notifications for insert
      with check (
        exists (
          select 1 from public.agreements a
          where a.id = agreement_id
            and auth.uid() in (a.lender_id, a.borrower_id, a.guarantor_id)
            and recipient_id in (a.lender_id, a.borrower_id, a.guarantor_id)
        )
      );
  end if;
end;
$$;
