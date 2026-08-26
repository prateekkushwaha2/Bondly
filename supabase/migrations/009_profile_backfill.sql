-- Lets an authenticated user repair/create only their own missing profile row.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'Users can create their own profile'
  ) then
    create policy "Users can create their own profile"
      on public.profiles for insert
      with check (id = auth.uid());
  end if;
end;
$$;
