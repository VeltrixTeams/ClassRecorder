import "server-only";
import { z } from "zod";
import { sql } from "@/server/db";
import { requireUser } from "@/server/auth";
import { route, notFound, ApiError } from "@/server/errors";
import { config } from "@/server/config";
import { chat } from "@/server/ai/gateway";
import { summaryContentSchema, type SummaryContent } from "@/server/summary";

type Params = { params: Promise<{ id: string }> };

async function translateSummary(
  content: SummaryContent,
  userId: string,
  lectureId: string,
): Promise<SummaryContent> {
  const resp = await chat(
    [
      {
        role: "system",
        content:
          "Translate the following lecture summary JSON to English. Keep the same JSON shape with 't' unchanged.",
      },
      { role: "user", content: JSON.stringify(content) },
    ],
    { model: config.summaryModel, userId, lectureId, kind: "translate" },
  );
  const text = resp.choices?.[0]?.message?.content;
  try {
    return summaryContentSchema.parse(JSON.parse(text));
  } catch {
    return content;
  }
}

export const GET = route(async (req: Request, { params }: Params) => {
  const userId = await requireUser(req);
  const { id } = await params;
  const url = new URL(req.url);
  const lang = url.searchParams.get("lang") === "en" ? "en" : "th";

  const [lecture] = await sql()`select * from lectures where id=${id} and user_id=${userId}`;
  if (!lecture) throw notFound("lecture");

  const [row] = await sql()`select * from summaries where lecture_id=${id} and user_id=${userId} and lang=${lang}`;
  if (row && !row.stale) return Response.json(row);

  if (lang === "en" && (!row || row.stale)) {
    const [thRow] = await sql()`select content from summaries where lecture_id=${id} and user_id=${userId} and lang='th'`;
    if (!thRow) throw notFound("summary");
    const translated = await translateSummary(thRow.content, userId, id);
    const [newRow] = await sql()`
      insert into summaries(lecture_id, user_id, lang, content) values (${id}, ${userId}, 'en', ${sql().json(translated)})
      on conflict (lecture_id, lang) do update set content=excluded.content, stale=false
      returning *
    `;
    return Response.json(newRow);
  }

  if (!row) throw notFound("summary");
  return Response.json(row);
});

export const PATCH = route(async (req: Request, { params }: Params) => {
  const userId = await requireUser(req);
  const { id } = await params;
  const body = z.object({ content: z.record(z.string(), z.unknown()) }).parse(await req.json());

  let validated;
  try {
    validated = summaryContentSchema.parse(body.content);
  } catch (e) {
    throw new ApiError(422, "invalid_summary", e instanceof Error ? e.message : "invalid summary");
  }

  const [row] = await sql()`
    update summaries set content=${sql().json(validated)}, edited=true
    where lecture_id=${id} and user_id=${userId} and lang='th'
    returning *
  `;
  if (!row) throw notFound("summary");
  await sql()`update summaries set stale=true where lecture_id=${id} and user_id=${userId} and lang='en'`;
  return Response.json(row);
});
