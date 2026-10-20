-- Golden-dataset feedback on AI-produced citations (Approve / Edit & Correct).
-- Owner-only: users can insert and read their OWN rows, never update or delete
-- them. `consent_training` defaults to false — a row is only ever eligible for
-- a curated research dataset when the scholar opted in.
create table public.citation_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('approve', 'correct')),
  source_id text,
  verify_status text check (verify_status in ('verified', 'partial', 'unverified')),
  original jsonb not null,
  corrected jsonb,
  consent_training boolean not null default false,
  created_at timestamptz not null default now(),
  -- a correction must carry the corrected citation
  constraint citation_feedback_correct_has_payload check (action <> 'correct' or corrected is not null)
);

create index citation_feedback_user_created_idx
  on public.citation_feedback (user_id, created_at desc);

alter table public.citation_feedback enable row level security;

create policy "Users can view own citation feedback"
  on public.citation_feedback for select
  using (auth.uid() = user_id);

create policy "Users can insert own citation feedback"
  on public.citation_feedback for insert
  with check (auth.uid() = user_id);
