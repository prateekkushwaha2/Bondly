-- Supabase requires both SQL privileges and RLS policies.
-- These grants allow authenticated requests to reach the tables; RLS still limits rows/actions.
grant usage on schema public to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert on public.agreements to authenticated;
grant select, insert, update on public.approvals to authenticated;
grant select, insert, update on public.payment_schedule to authenticated;
grant select, insert, update on public.resolution_cases to authenticated;
grant select, insert, update on public.resolution_case_votes to authenticated;
grant select, insert on public.activity_events to authenticated;
grant select, insert, update on public.notifications to authenticated;

-- A participant may see the name/profile of people in one of their shared agreements.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'Participants can view shared agreement profiles'
  ) then
    create policy "Participants can view shared agreement profiles"
      on public.profiles for select
      using (
        exists (
          select 1 from public.agreements a
          where auth.uid() in (a.lender_id, a.borrower_id, a.guarantor_id)
            and profiles.id in (a.lender_id, a.borrower_id, a.guarantor_id)
        )
      );
  end if;
end;
$$;
