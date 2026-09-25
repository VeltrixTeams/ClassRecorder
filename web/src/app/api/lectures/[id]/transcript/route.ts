import "server-only";
import { sql } from "@/server/db";
import { requireUser } from "@/server/auth";
import { route } from "@/server/errors";

type Params = { params: Promise<{ id: string }> };

export const GET = route(async (req: Request, { params }: Params) => {
  const userId = await requireUser(req);
  const { id } = await params;
  const url = new URL(req.url);
  const afterMs = Number(url.searchParams.get("after_ms") ?? "0");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "200"), 500);

  const rows = await sql()`
    select id, start_ms, end_ms, speaker, text from transcript_segments
    where lecture_id=${id} and user_id=${userId} and start_ms > ${afterMs}
    order by start_ms limit ${limit}
  `;
  return Response.json(rows);
});
