import "server-only";
import { z } from "zod";
import { sql } from "@/server/db";
import { requireUser } from "@/server/auth";
import { route } from "@/server/errors";
import { guessCourseId } from "@/server/lectures";

const lectureIn = z.object({
  course_id: z.string().uuid().nullable().optional(),
  title: z.string().nullable().optional(),
  recorded_at: z.coerce.date(),
  mime_type: z.string().nullable().optional(),
});

export const POST = route(async (req: Request) => {
  const userId = await requireUser(req);
  const body = lectureIn.parse(await req.json());

  let courseId = body.course_id ?? null;
  if (courseId === null) {
    const [profile] = await sql()`select timezone from profiles where user_id=${userId}`;
    const courses = await sql()`select id, schedule from courses where user_id=${userId}`;
    courseId = guessCourseId(
      courses.map((c) => ({ id: c.id, schedule: c.schedule })),
      body.recorded_at,
      profile?.timezone ?? "UTC",
    );
  }

  const [row] = await sql()`
    insert into lectures(user_id, course_id, title, recorded_at, mime_type, status)
    values (${userId}, ${courseId}, ${body.title ?? null}, ${body.recorded_at}, ${body.mime_type ?? null}, 'uploading')
    returning *
  `;
  return Response.json(row);
});

export const GET = route(async (req: Request) => {
  const userId = await requireUser(req);
  const url = new URL(req.url);
  const courseId = url.searchParams.get("course_id");
  const cursor = url.searchParams.get("cursor");

  const rows = courseId
    ? cursor
      ? await sql()`select * from lectures where user_id=${userId} and course_id=${courseId}
          and recorded_at < ${cursor} order by recorded_at desc limit 50`
      : await sql()`select * from lectures where user_id=${userId} and course_id=${courseId}
          order by recorded_at desc limit 50`
    : cursor
      ? await sql()`select * from lectures where user_id=${userId}
          and recorded_at < ${cursor} order by recorded_at desc limit 50`
      : await sql()`select * from lectures where user_id=${userId} order by recorded_at desc limit 50`;

  return Response.json(rows);
});
