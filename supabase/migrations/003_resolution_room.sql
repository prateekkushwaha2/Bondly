-- Persistent AI Resolution Room workflow.

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'resolution_cases'
      and policyname = 'Participants can open resolution cases'
  ) then
    create policy "Participants can open resolution cases"
      on public.resolution_cases for insert
      with check (
        exists (
          select 1 from public.agreements a
          where a.id = agreement_id
            and auth.uid() in (a.lender_id, a.borrower_id, a.guarantor_id)
        )
        and opened_by = auth.uid()
      );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'resolution_cases'
      and policyname = 'Case opener can update an open case'
  ) then
    create policy "Case opener can update an open case"
      on public.resolution_cases for update
      using (opened_by = auth.uid() and status in ('open', 'proposed'))
      with check (opened_by = auth.uid());
  end if;
end;
$$;
