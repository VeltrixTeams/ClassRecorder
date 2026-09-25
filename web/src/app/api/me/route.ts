import "server-only";
import { z } from "zod";
import { sql } from "@/server/db";
import { requireUser } from "@/server/auth";
import { route } from "@/server/errors";
import { config } from "@/server/config";
import { deletePrefix } from "@/server/storage";

const profilePatch = z.object({
  timezone: z.string().optional(),
  retention_days: z.number().int().optional(),
  push_subscription: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const GET = route(async (req: Request) => {
  const userId = await requireUser(req);
  const [row] = await sql()`select * from profiles where user_id=${userId}`;
  return Response.json(row ?? {});
});

export const PUT = route(async (req: Request) => {
  const userId = await requireUser(req);
  const body = profilePatch.parse(await req.json());

  const set: Record<string, unknown> = { ...body };
  if (set.push_subscription !== undefined) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    set.push_subscription = set.push_subscription === null ? null : sql().json(set.push_subscription as any);
  }

  let row;
  if (Object.keys(set).length > 0) {
    [row] = await sql()`update profiles set ${sql()(set)} where user_id=${userId} returning *`;
  } else {
    [row] = await sql()`select * from profiles where user_id=${userId}`;
  }
  return Response.json(row);
});

export const DELETE = route(async (req: Request) => {
  const userId = await requireUser(req);
  await deletePrefix(config.audioBucket, userId);
  await deletePrefix(config.imagesBucket, userId);
  await sql()`delete from auth.users where id=${userId}`;
  return new Response(null, { status: 204 });
});
