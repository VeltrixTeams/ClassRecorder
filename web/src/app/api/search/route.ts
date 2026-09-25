import "server-only";
import { sql } from "@/server/db";
import { requireUser } from "@/server/auth";
import { route } from "@/server/errors";
import { embed } from "@/server/ai/gateway";

export const GET = route(async (req: Request) => {
  const userId = await requireUser(req);
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const courseId = url.searchParams.get("course_id");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const [vec] = await embed([q], { userId });
  const rows = await sql()`
    select * from hybrid_search(${userId}, ${JSON.stringify(vec)}, ${q}, ${courseId}, ${from}, ${to}, 20)
  `;
  return Response.json(
    rows.map((r) => ({
      lecture_id: r.lecture_id,
      course_id: r.course_id ?? null,
      start_ms: r.start_ms,
      end_ms: r.end_ms,
      text: r.text,
      score: r.score,
    })),
  );
});
