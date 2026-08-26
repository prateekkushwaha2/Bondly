-- Trusted Edge Functions run as service_role and need SQL table privileges.
-- These permissions are server-only; the service_role key must never reach the browser.
grant usage on schema public to service_role;
grant select, update on public.payment_schedule to service_role;
grant select on public.agreements to service_role;
grant select, insert, update on public.razorpay_orders to service_role;

-- Needed for trusted server-side workflow/audit operations.
grant select, insert on public.activity_events to service_role;
grant select, insert, update on public.resolution_cases to service_role;
grant select, insert, update on public.resolution_case_votes to service_role;
grant select, insert, update on public.notifications to service_role;
