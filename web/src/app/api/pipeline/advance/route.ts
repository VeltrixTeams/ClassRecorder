import "server-only";
import { config } from "@/server/config";
import { advance } from "@/server/pipeline/advance";
import { apiError, route } from "@/server/errors";

export const maxDuration = 300;

function requireCronSecret(req: Request): boolean {
  const authorization = req.headers.get("authorization") ?? "";
  return authorization === `Bearer ${config.cronSecret}`;
}

export const POST = route(async (req: Request) => {
  if (!requireCronSecret(req)) return apiError(401, "unauthorized", "invalid or missing cron secret");
  const body = await req.json().catch(() => null);
  const lectureId = body?.lectureId;
  if (typeof lectureId !== "string" || !lectureId) {
    return apiError(400, "bad_request", "lectureId is required");
  }
  const result = await advance(lectureId);
  return Response.json({ ok: true, ...result });
});
