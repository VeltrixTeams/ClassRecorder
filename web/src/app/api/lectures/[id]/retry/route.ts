import "server-only";
import { sql } from "@/server/db";
import { requireUser } from "@/server/auth";
import { route, notFound } from "@/server/errors";
import { kick } from "@/server/pipeline/advance";

type Params = { params: Promise<{ id: string }> };

export const POST = route(async (req: Request, { params }: Params) => {
  const userId = await requireUser(req);
  const { id } = await params;
  const [row] = await sql()`
    update lectures set status='queued', error=null
    where id=${id} and user_id=${userId} and status='failed'
    returning id
  `;
  if (!row) throw notFound("failed lecture");
  kick(id);
  return Response.json({ status: "queued" }, { status: 202 });
});
