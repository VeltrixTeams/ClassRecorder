import "server-only";
import { z } from "zod";
import { sql } from "@/server/db";
import { requireUser } from "@/server/auth";
import { route, notFound } from "@/server/errors";
import { config } from "@/server/config";
import { createSignedUploadUrl } from "@/server/storage";

const bodySchema = z.object({ indices: z.array(z.number().int()) });

type Params = { params: Promise<{ id: string }> };

export const POST = route(async (req: Request, { params }: Params) => {
  const userId = await requireUser(req);
  const { id } = await params;
  const { indices } = bodySchema.parse(await req.json());

  const [lecture] = await sql()`select id from lectures where id=${id} and user_id=${userId}`;
  if (!lecture) throw notFound("lecture");

  const urls = [];
  for (const idx of indices) {
    // Extension-agnostic: chunks may be webm or mp4/m4a depending on client;
    // the finalize step decodes each segment rather than trusting a fixed extension.
    const path = `${userId}/${id}/chunks/${String(idx).padStart(4, "0")}.audio`;
    const signed = await createSignedUploadUrl(config.audioBucket, path);
    await sql()`
      insert into audio_chunks(lecture_id, user_id, idx, uploaded) values (${id}, ${userId}, ${idx}, false)
      on conflict (lecture_id, idx) do nothing
    `;
    urls.push({ idx, url: signed.url, path });
  }
  return Response.json({ urls });
});
