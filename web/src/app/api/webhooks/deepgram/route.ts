import "server-only";
import type postgres from "postgres";
import { sql } from "@/server/db";
import { verifyHmac } from "@/server/ai/deepgram";
import { kick } from "@/server/pipeline/advance";
import { apiError, route } from "@/server/errors";

export const maxDuration = 300;

/** Deepgram pre-recorded callback: verifies the HMAC token (timing-safe),
 * stores the raw result in stt_results, then kicks the pipeline to build
 * transcript_segments from it. */
export const POST = route(async (req: Request) => {
  const url = new URL(req.url);
  const lectureId = url.searchParams.get("lecture");
  const token = url.searchParams.get("token");
  if (!lectureId || !token) return apiError(400, "bad_request", "lecture and token query params required");
  if (!verifyHmac(lectureId, token)) return apiError(401, "unauthorized", "invalid token");

  const result = await req.json();

  const db = sql();
  const rows = await db<{ user_id: string }[]>`select user_id from lectures where id=${lectureId}`;
  const lecture = rows[0];
  if (!lecture) return apiError(404, "not_found", "lecture not found");

  await db`
    insert into stt_results(lecture_id, user_id, result) values (${lectureId}, ${lecture.user_id}, ${db.json(result as postgres.JSONValue)})
    on conflict (lecture_id) do update set result=excluded.result
  `;

  kick(lectureId);
  return Response.json({ ok: true });
});
