-- v2 All-in-Vercel: drop pgmq queue + stt_chunks (no worker/queue anymore);
-- add columns for cron-driven step orchestration; add stt_results, summary_parts, app_flags.

select pgmq.drop_queue('lecture_jobs_q');
drop extension if exists pgmq;

drop table if exists stt_chunks;

alter table lectures
  add column mime_type text,
  add column locked_until timestamptz,
  add column stt_request_id text,
  add column stt_submitted_at timestamptz,
  add column stt_attempts int not null default 0;

alter table lectures drop constraint lectures_status_check;
alter table lectures add constraint lectures_status_check check (
  status in ('uploading', 'queued', 'finalizing', 'transcribing', 'summarizing', 'indexing', 'ready', 'failed')
);

-- =========================================================================
-- stt_results: raw Deepgram callback payload per lecture
-- =========================================================================
create table stt_results (
  lecture_id uuid primary key references lectures (id) on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create index stt_results_user_id_idx on stt_results (user_id);

alter table stt_results enable row level security;
create policy stt_results_select on stt_results for select using (user_id = auth.uid());
create policy stt_results_insert on stt_results for insert with check (user_id = auth.uid());
create policy stt_results_update on stt_results for update using (user_id = auth.uid());
create policy stt_results_delete on stt_results for delete using (user_id = auth.uid());

-- =========================================================================
-- summary_parts: per-window summaries for map-reduce when transcript is long
-- =========================================================================
create table summary_parts (
  lecture_id uuid not null references lectures (id) on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  idx int not null,
  content jsonb not null,
  primary key (lecture_id, idx)
);

create index summary_parts_user_id_idx on summary_parts (user_id);

alter table summary_parts enable row level security;
create policy summary_parts_select on summary_parts for select using (user_id = auth.uid());
create policy summary_parts_insert on summary_parts for insert with check (user_id = auth.uid());
create policy summary_parts_update on summary_parts for update using (user_id = auth.uid());
create policy summary_parts_delete on summary_parts for delete using (user_id = auth.uid());

-- =========================================================================
-- app_flags: server-only global flags (e.g. daily cost cap tripped). No RLS
-- grants to authenticated/anon users; only the service role (which bypasses
-- RLS) reads/writes it.
-- =========================================================================
create table app_flags (
  key text primary key,
  value jsonb not null
);

alter table app_flags enable row level security;
