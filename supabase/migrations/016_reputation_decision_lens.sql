-- Adds explainable role-specific context to the opt-in reputation profile.
alter table public.reputation_profiles
  add column if not exists role_breakdown jsonb not null default '{}'::jsonb,
  add column if not exists ai_considerations text[] not null default '{}',
  add column if not exists ai_question text not null default '';
