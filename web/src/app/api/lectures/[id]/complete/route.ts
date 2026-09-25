import "server-only";
import { z } from "zod";
import { sql } from "@/server/db";
import { requireUser } from "@/server/auth";
import { route, notFound, ApiError } from "@/server/errors";
import { config } from "@/server/config";
import { listObjects } from "@/server/storage";
import { missingIndices, parseUploadedIndices } from "@/server/lectures";
import { kick } from "@/server/pipeline/advance";

const bodySchema = z.object({
  chunk_count: z.number().int().nonnegative(),
  checksums: z.array(z.string()),
});

type Params = { params: Promise<{ id: string }> };

export const POST = route(async (req: Request, { params }: Params) => {
  const userId = await requireUser(req);
  const { id } = await params;
  const body = bodySchema.parse(await req.json());

  const [lecture] = await sql()`select * from lectures where id=${id} and user_id=${userId}`;
  if (!lecture) throw notFound("lecture");

  const [capFlag] = await sql()`select value from app_flags where key='cost_cap_tripped'`;
  if (capFlag?.value === true) {
    return Response.json(
      {
        error: {
          code: "cost_cap",
          message: "ระบบถึงเพดานค่าใช้จ่ายวันนี้ ไฟล์เสียงถูกเก็บไว้แล้ว ลองกดส่งอีกครั้งพรุ่งนี้",
        },
      },
      { status: 503 },
    );
  }

  if (body.checksums.length !== body.chunk_count) {
    throw new ApiError(422, "checksum_count_mismatch", "checksums must have exactly chunk_count entries");
  }

  // Client PUTs chunks directly to signed storage URLs, so /complete is where
  // we verify which indices actually landed: ONE storage list call on the
  // lecture's chunks/ prefix, trusting only objects that exist with size>0.
  const objects = await listObjects(config.audioBucket, `${userId}/${id}/chunks`);
  const uploaded = parseUploadedIndices(objects);
  const missing = missingIndices(body.chunk_count, uploaded);
  if (missing.length > 0) {
    return Response.json({ missing }, { status: 409 });
  }

  for (let idx = 0; idx < body.checksums.length; idx++) {
    await sql()`
      insert into audio_chunks(lecture_id, user_id, idx, checksum, uploaded)
      values (${id}, ${userId}, ${idx}, ${body.checksums[idx]}, true)
      on conflict (lecture_id, idx) do update set checksum=excluded.checksum, uploaded=true
    `;
  }

  const [{ usage }] = await sql()`
    select coalesce(sum(duration_ms),0) as usage from lectures
    where user_id=${userId} and created_at >= date_trunc('month', now())
  `;
  const thisLectureHours = (body.chunk_count * config.chunkSegSec) / 3600;
  if (Number(usage ?? 0) / 3_600_000 + thisLectureHours > config.quotaAudioHoursPerMonth) {
    throw new ApiError(402, "quota_exceeded", "monthly audio quota exceeded");
  }

  await sql()`update lectures set chunk_count=${body.chunk_count}, status='queued' where id=${id}`;
  kick(id);

  const [row] = await sql()`select * from lectures where id=${id}`;
  return Response.json(row, { status: 202 });
});
