import "server-only";
import { z } from "zod";
import { sql } from "@/server/db";
import { requireUser } from "@/server/auth";
import { route } from "@/server/errors";

const scheduleItem = z.object({ dow: z.number().int(), start: z.string(), end: z.string() });
const courseIn = z.object({
  name: z.string(),
  instructor: z.string().nullable().optional(),
  color: z.number().int().min(0).max(7).default(0),
  schedule: z.array(scheduleItem).default([]),
  vocabulary: z.array(z.string()).default([]),
});

export const GET = route(async (req: Request) => {
  const userId = await requireUser(req);
  const rows = await sql()`select * from courses where user_id=${userId} order by created_at desc`;
  return Response.json(rows);
});

export const POST = route(async (req: Request) => {
  const userId = await requireUser(req);
  const body = courseIn.parse(await req.json());
  const [row] = await sql()`
    insert into courses(user_id, name, instructor, color, schedule, vocabulary)
    values (${userId}, ${body.name}, ${body.instructor ?? null}, ${body.color},
            ${sql().json(body.schedule)}, ${body.vocabulary})
    returning *
  `;
  return Response.json(row);
});
