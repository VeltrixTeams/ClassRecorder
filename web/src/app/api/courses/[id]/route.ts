import "server-only";
import { z } from "zod";
import { sql } from "@/server/db";
import { requireUser } from "@/server/auth";
import { route, notFound } from "@/server/errors";

const scheduleItem = z.object({ dow: z.number().int(), start: z.string(), end: z.string() });
const coursePatch = z.object({
  name: z.string().optional(),
  instructor: z.string().nullable().optional(),
  color: z.number().int().min(0).max(7).optional(),
  schedule: z.array(scheduleItem).optional(),
  vocabulary: z.array(z.string()).optional(),
});

type Params = { params: Promise<{ id: string }> };

export const PATCH = route(async (req: Request, { params }: Params) => {
  const userId = await requireUser(req);
  const { id } = await params;
  const body = coursePatch.parse(await req.json());

  const existing = await sql()`select * from courses where id=${id} and user_id=${userId}`;
  if (existing.length === 0) throw notFound("course");

  const set: Record<string, unknown> = { ...body };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (set.schedule !== undefined) set.schedule = sql().json(set.schedule as any);
  if (Object.keys(set).length === 0) return Response.json(existing[0]);

  const [row] = await sql()`
    update courses set ${sql()(set)} where id=${id} and user_id=${userId} returning *
  `;
  return Response.json(row);
});

export const DELETE = route(async (req: Request, { params }: Params) => {
  const userId = await requireUser(req);
  const { id } = await params;
  await sql()`delete from courses where id=${id} and user_id=${userId}`;
  return new Response(null, { status: 204 });
});
