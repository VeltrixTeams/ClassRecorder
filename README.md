# LectureNote

Records university lectures in the browser, transcribes them, and writes a Thai
summary where every point links back to the second it was said. Lectures are in
English; the UI and summaries are in Thai.

One Next.js app (UI + API + processing pipeline) deployed on **Vercel**, with
**Supabase** for Postgres (+ pgvector), Auth and Storage.

## Features

- **Record**: in-browser recording (always-dark screen, bookmarks, hold-to-stop).
  Audio is saved to IndexedDB in 30 s pieces before upload, so a closed tab or
  lost connection doesn't lose the lecture. Uploads resume on the next visit.
- **Transcript**: word-level timestamps and lecturer/student speaker labels
  (Deepgram Nova-3).
- **Thai summary**: overview, topics, definitions, examples, emphasized points
  and assignments, each with a time chip that seeks the audio. English version
  is generated on request.
- **Search**: hybrid search (vector + full-text) across all lectures, in Thai or
  English.
- **Ask AI**: streaming chat answers grounded in your lectures, with timestamp
  citations.
- **Privacy**: per-user row-level security, audio retention setting, full
  account deletion. Web push notification when a summary is ready.

## Architecture

```
Browser ──► Next.js on Vercel ──► Supabase (Postgres + pgvector, Auth, Storage)
              │  /api/*            ▲
              │                    │ audio by signed URL
              └──► Deepgram ───────┘  (transcribes, then calls /api/webhooks/deepgram)
              └──► OpenRouter          (summary, chat, embeddings)
```

Processing a lecture (`src/server/pipeline/advance.ts`). Each step runs in its
own short function call, guarded by a per-lecture DB lock, and is skipped if
its output already exists, so retries and crashes are safe:

1. **finalize**: join the uploaded pieces byte-for-byte into `full.webm`/`full.mp4`
   (one MediaRecorder with `timeslice` makes this a valid file, no ffmpeg).
2. **transcribe**: send a signed URL to Deepgram with an HMAC-signed callback.
3. **segments**: turn the Deepgram result into transcript segments.
4. **summarize**: Thai summary as validated JSON (map-reduce for very long lectures).
5. **index**: 90 s windows, embeddings, stored for search and chat.
6. **ready**: delete the pieces, keep the full audio, send a push notification.

Vercel Cron: `/api/cron/sweep` every minute resumes stuck lectures;
`/api/cron/retention` hourly deletes expired audio and sets the daily cost cap.

Lecture status: `uploading → queued → finalizing → transcribing → summarizing → indexing → ready`
(any step can go to `failed`; **Retry** resumes from the step that failed).

## Layout

```
web/
  src/app/            pages: / (home), login, record, lectures/[id], search, courses/[id], settings
  src/app/api/        route handlers: courses, lectures, search, chat, vocabulary, me,
                      pipeline/advance, webhooks/deepgram, cron/{sweep,retention}
  src/server/         server-only: config, db, auth, storage, errors, ai/{gateway,deepgram},
                      pipeline/*, summary, chat, lectures, prompts/*.md
  src/lib/            browser: api client, recorder, upload queue (IndexedDB), push, formatting
  src/components/     TimeChip, StatusBadge, AudioPlayer, BottomNav, icons
  public/             sw.js (push), manifest.webmanifest
  vercel.json         cron schedules
supabase/migrations/  0001_init.sql (schema, RLS, storage, hybrid_search), 0002_vercel.sql
prototype/            static HTML design reference
PRODUCT.md, DESIGN.md product brief and design tokens; PLAN.md architecture decisions
```

## Run locally

Needs Node 20+, Docker Desktop (running) and the Supabase CLI.

```bash
# repo root (the CLI looks for ./supabase)
supabase start -x studio,postgres-meta
supabase db reset          # applies all migrations
supabase status            # prints URL, anon key, service_role key, JWT secret

cd web
cp .env.example .env.local # fill in values (see below)
npm install
npm run dev                # http://localhost:3000
```

Login codes arrive in Mailpit at http://127.0.0.1:54324.

Locally, a lecture goes through upload and finalize, then stops at transcribe:
Deepgram can't reach `localhost` to fetch the audio or call the webhook. To test
the full pipeline, use a Vercel preview deploy with Supabase Cloud (or a tunnel
such as `npx cloudflared tunnel --url http://localhost:3000` with `APP_URL` set
to it plus a cloud Supabase project).

### Environment variables (`web/.env.local`)

| Var | Where from |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `supabase status` / project settings |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | `npx web-push generate-vapid-keys` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` | `supabase status` / project settings |
| `DATABASE_URL` | local: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`; cloud: pooler URL (transaction mode, port 6543) |
| `OPENROUTER_API_KEY` | openrouter.ai/keys |
| `DEEPGRAM_API_KEY` | console.deepgram.com |
| `APP_URL` | public base URL (Deepgram callback target) |
| `WEBHOOK_SECRET`, `CRON_SECRET` | `openssl rand -hex 32` each |
| `SUMMARY_MODEL`, `CHAT_MODEL`, `EMBED_MODEL` | optional; defaults in `src/server/config.ts` |

`NEXT_PUBLIC_API_URL` stays empty (the API is same-origin under `/api`).

## Deploy to Vercel

1. **Supabase Cloud**: create a project (or add Supabase from the Vercel
   Marketplace, which fills in its env vars). From the repo root:
   `supabase link --project-ref <ref>` then `supabase db push`.
2. **Vercel**: import the GitHub repo and set **Root Directory = `web`**. The
   **Pro** plan is required (every-minute cron, 300 s functions).
3. Add every variable from the table above under Project → Settings →
   Environment Variables. Set `APP_URL` to the production URL (e.g.
   `https://lecturenote.vercel.app`). Vercel sends `CRON_SECRET` to the cron
   routes automatically.
4. Deploy. `vercel.json` registers both crons.
5. In Supabase → Auth → URL Configuration, set Site URL to the Vercel URL.

## Tests

```bash
cd web
npx tsc --noEmit
npx vitest run         # unit tests
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run   # + DB integration test
```

## Known limits

- Phones stop browser recording when the screen locks; the app keeps the screen
  awake (Wake Lock) and warns the user.
- Safari records `audio/mp4`; byte-joining its pieces still needs a real-device test.
- There is no screen for editing a summary yet (`PATCH /api/lectures/{id}/summary` exists).
- Very long lectures (4 h+) are summarized in one function call with parallel
  windows; the unused `summary_parts` table is the upgrade path if that nears
  the 300 s limit.
