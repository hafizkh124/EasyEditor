-- Create activity_log table to persist user activity instead of localStorage
create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('tts', 'ocr', 'stt')),
  label text not null,
  created_at timestamptz not null default now()
);

-- Index for fast user-specific queries sorted by time
create index activity_log_user_id_created_at_idx
  on public.activity_log (user_id, created_at desc);

-- Row Level Security
alter table public.activity_log enable row level security;

create policy "Users can view own activity"
  on public.activity_log for select
  using (auth.uid() = user_id);

create policy "Users can insert own activity"
  on public.activity_log for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own activity"
  on public.activity_log for delete
  using (auth.uid() = user_id);
