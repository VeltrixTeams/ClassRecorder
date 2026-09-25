import "server-only";
import { sql } from "@/server/db";
import { requireUser } from "@/server/auth";
import { route, notFound } from "@/server/errors";

type Params = { params: Promise<{ id: string }> };

export const DELETE = route(async (req: Request, { params }: Params) => {
  const userId = await requireUser(req);
  const { id } = await params;
  const result = await sql()`delete from vocabulary where id=${id} and user_id=${userId}`;
  if (result.count === 0) throw notFound("vocabulary");
  return new Response(null, { status: 204 });
});
