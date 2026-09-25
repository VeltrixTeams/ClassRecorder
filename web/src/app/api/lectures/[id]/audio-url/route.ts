import "server-only";
import { sql } from "@/server/db";
import { requireUser } from "@/server/auth";
import { route, notFound } from "@/server/errors";
import { config } from "@/server/config";
import { createSignedDownloadUrl } from "@/server/storage";

type Params = { params: Promise<{ id: string }> };

export const GET = route(async (req: Request, { params }: Params) => {
  const userId = await requireUser(req);
  const { id } = await params;
  const [lecture] = await sql()`select audio_path from lectures where id=${id} and user_id=${userId}`;
  if (!lecture || !lecture.audio_path) throw notFound("audio");
  const url = await createSignedDownloadUrl(config.audioBucket, lecture.audio_path, 3600);
  return Response.json({ url });
});
