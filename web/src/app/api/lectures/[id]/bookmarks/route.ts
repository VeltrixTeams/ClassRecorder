import "server-only";
import { z } from "zod";
import { sql } from "@/server/db";
import { requireUser } from "@/server/auth";
import { route } from "@/server/errors";

const bodySchema = z.object({
  t_ms: z.number().int(),
  note: z.string().nullable().optional(),
  image_path: z.string().nullable().optional(),
});

type Params = { params: Promise<{ id: string }> };

export const POST = route(async (req: Request, { params }: Params) => {
  const userId = await requireUser(req);
  const { id } = await params;
  const body = bodySchema.parse(await req.json());
  const [row] = await sql()`
    insert into bookmarks(lecture_id, user_id, t_ms, note, image_path)
    values (${id}, ${userId}, ${body.t_ms}, ${body.note ?? null}, ${body.image_path ?? null})
    returning *
  `;
  return Response.json(row);
});
