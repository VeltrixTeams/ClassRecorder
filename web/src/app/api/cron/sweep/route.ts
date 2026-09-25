import "server-only";
import { config } from "@/server/config";
import { sql } from "@/server/db";
import { advance } from "@/server/pipeline/advance";
import { apiError, route } from "@/server/errors";

export const maxDuration = 300;

function requireCronSecret(req: Request): boolean {
  return (req.headers.get("authorization") ?? "") === `Bearer ${config.cronSecret}`;
}

/** Runs every minute (vercel.json). Advances any non-terminal lecture whose
 * lock has expired (crashed/timed-out advance() call), and resubmits STT for
 * a lecture that's been "transcribing" for 30+ min without a webhook
 * (once; then fails it). */
export const POST = route(async (req: Request) => {
  if (!requireCronSecret(req)) return apiError(401, "unauthorized", "invalid or missing cron secret");

  const db = sql();
  const stuckTranscribing = await db<{ id: string; stt_attempts: number }[]>`
    select id, stt_attempts from lectures
    where status = 'transcribing'
      and stt_request_id is not null
      and stt_submitted_at < now() - interval '30 minutes'
      and (locked_until is null or locked_until < now())
      and id not in (select lecture_id from stt_results)
  `;
  for (const l of stuckTranscribing) {
    if (l.stt_attempts < 2) {
      // Clear the stale request so plan.nextStep() resubmits on the next advance().
      await db`update lectures set stt_request_id=null, stt_submitted_at=null where id=${l.id}`;
    } else {
      await db`update lectures set status='failed', error='transcription timed out twice' where id=${l.id}`;
    }
  }

  const pending = await db<{ id: string }[]>`
    select id from lectures
    where status not in ('ready', 'failed')
      and (locked_until is null or locked_until < now())
  `;
  let advanced = 0;
  for (const l of pending) {
    try {
      await advance(l.id);
      advanced += 1;
    } catch (e) {
      console.error("sweep advance failed", l.id, e);
    }
  }
  return Response.json({ ok: true, swept: pending.length, advanced, resubmitted: stuckTranscribing.length });
});

// Vercel Cron invokes with GET + "Authorization: Bearer $CRON_SECRET"
export const GET = POST;
