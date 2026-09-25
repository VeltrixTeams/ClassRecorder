# LectureNote

Records university lectures, transcribes them, and writes a Thai summary with
timestamps back to the source audio.

## Layout

```
supabase/   Postgres schema, RLS policies, pgmq queue, hybrid_search (migrations/)
backend/    FastAPI API + pgmq worker, one Python package (app/)
web/        Next.js web app (recording, lectures, chat, search)
prototype/  static HTML/CSS design reference (not run as part of the app)
```

## Run locally

### 1. Database (Supabase local stack)

```bash
cd supabase
supabase start      # local Postgres + Auth + Storage + Studio
supabase db reset    # applies migrations/0001_init.sql
```

`supabase start` prints the local API URL, anon key, service role key and
JWT secret — use those for the `backend/.env` and `web/.env.local` below.

### 2. Backend (API + worker)

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate        # or: source .venv/bin/activate
pip install -e .[dev]
cp .env.example .env          # fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
                               # SUPABASE_JWT_SECRET, DATABASE_URL, OPENROUTER_API_KEY,
                               # DEEPGRAM_API_KEY, VAPID_PRIVATE_KEY/VAPID_SUBJECT

uvicorn app.main:app --reload         # API on :8000
python -m app.pipeline.worker         # worker (pgmq consumer), separate process
```

Requires `ffmpeg`/`ffprobe` on PATH for the worker (already in `backend/Dockerfile`).

### 3. Web app

```bash
cd web
npm install
cp .env.example .env.local    # NEXT_PUBLIC_API_URL, NEXT_PUBLIC_SUPABASE_URL,
                               # NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_VAPID_PUBLIC_KEY
npm run dev                   # http://localhost:3000
```

## Tests

```bash
cd backend && pytest && ruff check .
cd web && npm run lint && npx tsc --noEmit && npm test
```
