import "server-only";
import { z } from "zod";
import { sql } from "@/server/db";
import { requireUser } from "@/server/auth";
import { route } from "@/server/errors";

const vocabIn = z.object({
  term: z.string(),
  meaning: z.string().nullable().optional(),
  course_id: z.string().uuid().nullable().optional(),
  lecture_id: z.string().uuid().nullable().optional(),
  t_ms: z.number().int().nullable().optional(),
});

export const GET = route(async (req: Request) => {
  const userId = await requireUser(req);
  const rows = await sql()`select * from vocabulary where user_id=${userId} order by id desc`;
  return Response.json(rows);
});

export const POST = route(async (req: Request) => {
  const userId = await requireUser(req);
  const body = vocabIn.parse(await req.json());
  const [row] = await sql()`
    insert into vocabulary(user_id, course_id, term, meaning, lecture_id, t_ms)
    values (${userId}, ${body.course_id ?? null}, ${body.term}, ${body.meaning ?? null},
            ${body.lecture_id ?? null}, ${body.t_ms ?? null})
    returning *
  `;
  return Response.json(row);
});
