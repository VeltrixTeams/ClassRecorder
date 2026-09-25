# LectureNote

Records university lectures, transcribes them, and writes a Thai summary with
timestamps back to the source audio. One Next.js app (UI + API + pipeline) on
Vercel, with Supabase for Postgres/Auth/Storage.

## Layout

```
web/                  Next.js app
  src/app/            pages (UI)
  src/app/api/        API route handlers (+ pipeline, webhooks, cron)
  src/server/         server-only modules: db, auth, storage, AI gateway, pipeline
  vercel.json         cron schedules
supabase/migrations/  Postgres schema, RLS, storage policies, hybrid_search
prototype/            static design reference
```

## Run locally

Needs Docker Desktop running and the Supabase CLI.

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

Locally the pipeline runs up to the Deepgram step, but Deepgram can't reach
`localhost` to download audio or call the webhook. To test transcription end
to end locally, expose the app with a tunnel (e.g. `npx cloudflared tunnel
--url http://localhost:3000`), then set `APP_URL` to the tunnel URL. Supabase
Storage also has to be reachable, so a cloud Supabase project is easiest.

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

`NEXT_PUBLIC_API_URL` stays empty (API is same-origin under `/api`).

## Deploy to Vercel

1. **Supabase Cloud**: create a project (or add Supabase from the Vercel
   Marketplace, which also fills in its env vars). Then from the repo root:
   `supabase link --project-ref <ref>` and `supabase db push`.
2. **Vercel**: import the GitHub repo, set **Root Directory = `web`**. Plan:
   **Pro** is required (every-minute cron, 300 s functions).
3. Add every variable from the table above in Project → Settings → Environment
   Variables. Set `APP_URL` to the production URL (e.g.
   `https://lecturenote.vercel.app`) and `CRON_SECRET` (Vercel sends it to the
   cron routes automatically).
4. Deploy. `vercel.json` registers the crons: `/api/cron/sweep` (every minute,
   resumes stuck lectures) and `/api/cron/retention` (hourly, deletes expired
   audio and sets the daily cost cap flag).
5. In Supabase → Auth → URL Configuration, set Site URL to the Vercel URL.

## Tests

```bash
cd web
npx tsc --noEmit
npx vitest run                                  # unit tests
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run   # + DB integration test
```
