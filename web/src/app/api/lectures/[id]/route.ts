import "server-only";
import { sql } from "@/server/db";
import { requireUser } from "@/server/auth";
import { route, notFound } from "@/server/errors";
import { config } from "@/server/config";
import { deletePrefix } from "@/server/storage";

type Params = { params: Promise<{ id: string }> };

export const GET = route(async (req: Request, { params }: Params) => {
  const userId = await requireUser(req);
  const { id } = await params;
  const [row] = await sql()`select * from lectures where id=${id} and user_id=${userId}`;
  if (!row) throw notFound("lecture");
  return Response.json(row);
});

export const DELETE = route(async (req: Request, { params }: Params) => {
  const userId = await requireUser(req);
  const { id } = await params;
  const [lecture] = await sql()`select * from lectures where id=${id} and user_id=${userId}`;
  if (!lecture) throw notFound("lecture");
  await deletePrefix(config.audioBucket, `${userId}/${id}`);
  await sql()`delete from lectures where id=${id} and user_id=${userId}`;
  return new Response(null, { status: 204 });
});
