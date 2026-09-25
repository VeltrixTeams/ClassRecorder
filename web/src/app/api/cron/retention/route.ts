import "server-only";
import { config } from "@/server/config";
import { sql } from "@/server/db";
import * as storage from "@/server/storage";
import { apiError, route } from "@/server/errors";

export const maxDuration = 300;

function requireCronSecret(req: Request): boolean {
  return (req.headers.get("authorization") ?? "") === `Bearer ${config.cronSecret}`;
}

/** Runs hourly (vercel.json). Deletes full audio past each user's
 * retention_days, and flips `app_flags.cost_cap_tripped` for today's spend
 * (checked by POST /api/lectures/{id}/complete before accepting new work —
 * see report). */
export const POST = route(async (req: Request) => {
  if (!requireCronSecret(req)) return apiError(401, "unauthorized", "invalid or missing cron secret");

  const db = sql();

  const expired = await db<{ id: string; audio_path: string }[]>`
    select l.id, l.audio_path from lectures l
    join profiles p on p.user_id = l.user_id
    where l.audio_path is not null
      and l.status = 'ready'
      and l.recorded_at < now() - (p.retention_days || ' days')::interval
  `;
  for (const l of expired) {
    await storage.deleteObject(config.audioBucket, l.audio_path);
    await db`update lectures set audio_path=null where id=${l.id}`;
  }

  const [{ cost }] = await db<{ cost: number }[]>`
    select coalesce(sum(cost_usd), 0)::float as cost from ai_usage where created_at >= date_trunc('day', now())
  `;
  const tripped = cost >= config.dailyCostCapUsd;
  // Stored as a bare jsonb boolean (not an object) so /complete's
  // `value === true` check stays a simple, cheap comparison.
  await db`
    insert into app_flags(key, value) values ('cost_cap_tripped', ${db.json(tripped)})
    on conflict (key) do update set value=excluded.value
  `;

  return Response.json({ ok: true, retentionDeleted: expired.length, costCapTripped: tripped });
});

// Vercel Cron invokes with GET + "Authorization: Bearer $CRON_SECRET"
export const GET = POST;
