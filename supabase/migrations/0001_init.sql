-- LectureNote initial schema: tables, RLS, storage, pgmq queue, hybrid_search
create extension if not exists vector;
create extension if not exists pgmq;

-- =========================================================================
-- profiles
-- =========================================================================
create table profiles (
  user_id uuid primary key references auth.users on delete cascade,
  timezone text not null default 'Asia/Bangkok',
  retention_days int not null default 180,
  push_subscription jsonb,  -- Web Push subscription (endpoint, keys)
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;
create policy profiles_select on profiles for select using (user_id = auth.uid());
create policy profiles_insert on profiles for insert with check (user_id = auth.uid());
create policy profiles_update on profiles for update using (user_id = auth.uid());
create policy profiles_delete on profiles for delete using (user_id = auth.uid());

-- trigger: create profile row on new auth user
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================================
-- courses
-- =========================================================================
create table courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  instructor text,
  color smallint not null default 0 check (color between 0 and 7),
  schedule jsonb not null default '[]', -- [{dow:1-7,start:"09:00",end:"10:30"}]
  vocabulary text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index courses_user_id_idx on courses (user_id);

alter table courses enable row level security;
create policy courses_select on courses for select using (user_id = auth.uid());
create policy courses_insert on courses for insert with check (user_id = auth.uid());
create policy courses_update on courses for update using (user_id = auth.uid());
create policy courses_delete on courses for delete using (user_id = auth.uid());

-- =========================================================================
-- lectures
-- =========================================================================
create table lectures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid references courses (id) on delete set null,
  title text,
  recorded_at timestamptz not null,
  duration_ms int,
  status text not null default 'uploading' check (
    status in ('uploading', 'queued', 'preparing', 'transcribing', 'summarizing', 'indexing', 'ready', 'failed')
  ),
  progress jsonb not null default '{}', -- {step,done,total}
  error text,
  chunk_count int not null default 0,
  audio_path text,
  created_at timestamptz not null default now()
);

create index lectures_user_id_idx on lectures (user_id);
create index lectures_course_id_idx on lectures (course_id);

alter table lectures enable row level security;
create policy lectures_select on lectures for select using (user_id = auth.uid());
create policy lectures_insert on lectures for insert with check (user_id = auth.uid());
create policy lectures_update on lectures for update using (user_id = auth.uid());
create policy lectures_delete on lectures for delete using (user_id = auth.uid());

-- =========================================================================
-- audio_chunks
-- =========================================================================
create table audio_chunks (
  lecture_id uuid not null references lectures (id) on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  idx int not null,
  checksum text,
  uploaded boolean not null default false,
  primary key (lecture_id, idx)
);

create index audio_chunks_user_id_idx on audio_chunks (user_id);

alter table audio_chunks enable row level security;
create policy audio_chunks_select on audio_chunks for select using (user_id = auth.uid());
create policy audio_chunks_insert on audio_chunks for insert with check (user_id = auth.uid());
create policy audio_chunks_update on audio_chunks for update using (user_id = auth.uid());
create policy audio_chunks_delete on audio_chunks for delete using (user_id = auth.uid());

-- =========================================================================
-- stt_chunks (per-chunk STT cache)
-- =========================================================================
create table stt_chunks (
  lecture_id uuid not null references lectures (id) on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  idx int not null,
  start_ms int not null,
  result jsonb not null,
  primary key (lecture_id, idx)
);

create index stt_chunks_user_id_idx on stt_chunks (user_id);

alter table stt_chunks enable row level security;
create policy stt_chunks_select on stt_chunks for select using (user_id = auth.uid());
create policy stt_chunks_insert on stt_chunks for insert with check (user_id = auth.uid());
create policy stt_chunks_update on stt_chunks for update using (user_id = auth.uid());
create policy stt_chunks_delete on stt_chunks for delete using (user_id = auth.uid());

-- =========================================================================
-- transcript_segments
-- =========================================================================
create table transcript_segments (
  id bigserial primary key,
  lecture_id uuid not null references lectures (id) on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  start_ms int not null,
  end_ms int not null,
  speaker text check (speaker in ('lecturer', 'student')),
  text text not null,
  words jsonb
);

create index transcript_segments_lecture_id_idx on transcript_segments (lecture_id);
create index transcript_segments_user_id_idx on transcript_segments (user_id);

alter table transcript_segments enable row level security;
create policy transcript_segments_select on transcript_segments for select using (user_id = auth.uid());
create policy transcript_segments_insert on transcript_segments for insert with check (user_id = auth.uid());
create policy transcript_segments_update on transcript_segments for update using (user_id = auth.uid());
create policy transcript_segments_delete on transcript_segments for delete using (user_id = auth.uid());

-- =========================================================================
-- summaries
-- =========================================================================
create table summaries (
  lecture_id uuid not null references lectures (id) on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  lang text not null check (lang in ('th', 'en')),
  content jsonb not null,
  edited boolean not null default false,
  stale boolean not null default false,
  primary key (lecture_id, lang)
);

create index summaries_user_id_idx on summaries (user_id);

alter table summaries enable row level security;
create policy summaries_select on summaries for select using (user_id = auth.uid());
create policy summaries_insert on summaries for insert with check (user_id = auth.uid());
create policy summaries_update on summaries for update using (user_id = auth.uid());
create policy summaries_delete on summaries for delete using (user_id = auth.uid());

-- =========================================================================
-- bookmarks
-- =========================================================================
create table bookmarks (
  id uuid primary key default gen_random_uuid(),
  lecture_id uuid not null references lectures (id) on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  t_ms int not null,
  note text,
  image_path text,
  created_at timestamptz not null default now()
);

create index bookmarks_lecture_id_idx on bookmarks (lecture_id);
create index bookmarks_user_id_idx on bookmarks (user_id);

alter table bookmarks enable row level security;
create policy bookmarks_select on bookmarks for select using (user_id = auth.uid());
create policy bookmarks_insert on bookmarks for insert with check (user_id = auth.uid());
create policy bookmarks_update on bookmarks for update using (user_id = auth.uid());
create policy bookmarks_delete on bookmarks for delete using (user_id = auth.uid());

-- =========================================================================
-- search_chunks
-- =========================================================================
create table search_chunks (
  id bigserial primary key,
  lecture_id uuid not null references lectures (id) on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid references courses (id) on delete set null,
  start_ms int not null,
  end_ms int not null,
  text text not null,
  embedding vector(1536),
  tsv tsvector generated always as (to_tsvector('english', text)) stored
);

create index search_chunks_embedding_idx on search_chunks using hnsw (embedding vector_cosine_ops);
create index search_chunks_tsv_idx on search_chunks using gin (tsv);
create index search_chunks_user_id_idx on search_chunks (user_id);
create index search_chunks_lecture_id_idx on search_chunks (lecture_id);

alter table search_chunks enable row level security;
create policy search_chunks_select on search_chunks for select using (user_id = auth.uid());
create policy search_chunks_insert on search_chunks for insert with check (user_id = auth.uid());
create policy search_chunks_update on search_chunks for update using (user_id = auth.uid());
create policy search_chunks_delete on search_chunks for delete using (user_id = auth.uid());

-- =========================================================================
-- vocabulary
-- =========================================================================
create table vocabulary (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid references courses (id) on delete set null,
  term text not null,
  meaning text,
  lecture_id uuid references lectures (id) on delete set null,
  t_ms int
);

create index vocabulary_user_id_idx on vocabulary (user_id);

alter table vocabulary enable row level security;
create policy vocabulary_select on vocabulary for select using (user_id = auth.uid());
create policy vocabulary_insert on vocabulary for insert with check (user_id = auth.uid());
create policy vocabulary_update on vocabulary for update using (user_id = auth.uid());
create policy vocabulary_delete on vocabulary for delete using (user_id = auth.uid());

-- =========================================================================
-- ai_usage
-- =========================================================================
create table ai_usage (
  id bigserial primary key,
  user_id uuid not null references auth.users on delete cascade,
  lecture_id uuid references lectures (id) on delete set null,
  kind text not null,
  model text not null,
  input_units int not null default 0,
  output_units int not null default 0,
  cost_usd numeric not null default 0,
  created_at timestamptz not null default now()
);

create index ai_usage_user_id_idx on ai_usage (user_id);

alter table ai_usage enable row level security;
create policy ai_usage_select on ai_usage for select using (user_id = auth.uid());
create policy ai_usage_insert on ai_usage for insert with check (user_id = auth.uid());
create policy ai_usage_update on ai_usage for update using (user_id = auth.uid());
create policy ai_usage_delete on ai_usage for delete using (user_id = auth.uid());

-- =========================================================================
-- pgmq queue
-- =========================================================================
select pgmq.create('lecture_jobs_q');

-- =========================================================================
-- hybrid_search: RRF (k=60) fusion of vector top-50 + FTS top-50, returns 20
-- security invoker (default) + explicit p_user filter, so RLS on
-- search_chunks/lectures still applies for the caller.
-- =========================================================================
create function hybrid_search(
  p_user uuid,
  q_embedding vector(1536),
  q_text text,
  p_course uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  k int default 20
) returns table (
  id bigint,
  lecture_id uuid,
  course_id uuid,
  start_ms int,
  end_ms int,
  text text,
  score double precision,
  similarity double precision
)
language sql
stable
security invoker
as $$
  with vector_hits as (
    select
      sc.id,
      row_number() over (order by sc.embedding <=> q_embedding) as rank,
      1 - (sc.embedding <=> q_embedding) as similarity
    from search_chunks sc
    join lectures l on l.id = sc.lecture_id
    where sc.user_id = p_user
      and (p_course is null or sc.course_id = p_course)
      and (p_from is null or l.recorded_at >= p_from)
      and (p_to is null or l.recorded_at <= p_to)
    order by sc.embedding <=> q_embedding
    limit 50
  ),
  fts_hits as (
    select
      sc.id,
      row_number() over (
        order by ts_rank_cd(sc.tsv, websearch_to_tsquery('english', q_text)) desc
      ) as rank
    from search_chunks sc
    join lectures l on l.id = sc.lecture_id
    where sc.user_id = p_user
      and (p_course is null or sc.course_id = p_course)
      and (p_from is null or l.recorded_at >= p_from)
      and (p_to is null or l.recorded_at <= p_to)
      and sc.tsv @@ websearch_to_tsquery('english', q_text)
    order by ts_rank_cd(sc.tsv, websearch_to_tsquery('english', q_text)) desc
    limit 50
  ),
  fused as (
    select
      coalesce(v.id, f.id) as id,
      coalesce(1.0 / (60 + v.rank), 0) + coalesce(1.0 / (60 + f.rank), 0) as score
    from vector_hits v
    full outer join fts_hits f on v.id = f.id
  )
  select
    sc.id,
    sc.lecture_id,
    sc.course_id,
    sc.start_ms,
    sc.end_ms,
    sc.text,
    fused.score,
    coalesce(vh.similarity, 0) as similarity
  from fused
  join search_chunks sc on sc.id = fused.id
  left join vector_hits vh on vh.id = fused.id
  order by fused.score desc
  limit k;
$$;

-- =========================================================================
-- storage buckets
-- =========================================================================
insert into storage.buckets (id, name, public)
values ('audio', 'audio', false), ('images', 'images', false)
on conflict (id) do nothing;

create policy audio_select on storage.objects for select
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy audio_insert on storage.objects for insert
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy audio_update on storage.objects for update
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy audio_delete on storage.objects for delete
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);

create policy images_select on storage.objects for select
  using (bucket_id = 'images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy images_insert on storage.objects for insert
  with check (bucket_id = 'images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy images_update on storage.objects for update
  using (bucket_id = 'images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy images_delete on storage.objects for delete
  using (bucket_id = 'images' and (storage.foldername(name))[1] = auth.uid()::text);
