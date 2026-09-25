import "server-only";
import { config } from "../config";
import { sql } from "../db";
import { embed } from "../ai/gateway";

/** Build search_chunks: 90s windows, 15s overlap, embed in batches of 64.
 * Port of backend/app/pipeline/index.py. */

export interface IndexableSegment {
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface Window {
  start_ms: number;
  end_ms: number;
  text: string;
}

/** Group transcript segments into overlapping text windows for embedding. */
export function windowSegments(
  segments: IndexableSegment[],
  windowSec: number,
  overlapSec: number,
): Window[] {
  if (segments.length === 0) return [];
  const windowMs = windowSec * 1000;
  const stepMs = (windowSec - overlapSec) * 1000;
  const endMsTotal = Math.max(...segments.map((s) => s.end_ms));

  const windows: Window[] = [];
  let start = segments[0].start_ms;
  while (start < endMsTotal) {
    const stop = start + windowMs;
    const chunkSegs = segments.filter((s) => s.start_ms < stop && s.end_ms > start);
    if (chunkSegs.length > 0) {
      windows.push({
        start_ms: Math.min(...chunkSegs.map((s) => s.start_ms)),
        end_ms: Math.max(...chunkSegs.map((s) => s.end_ms)),
        text: chunkSegs.map((s) => s.text).join(" "),
      });
    }
    start += stepMs;
  }
  return windows;
}

/** Embeds every window first, then writes all rows in a single
 * delete+insert transaction. A crash between embed batches leaves NO rows
 * (rather than a partial set plan() would mistake for "already indexed"). */
export async function indexLecture(opts: {
  userId: string;
  lectureId: string;
  courseId: string | null;
  segments: IndexableSegment[];
}): Promise<number> {
  const windows = windowSegments(opts.segments, config.indexWindowSec, config.indexOverlapSec);

  const rows: Array<[string, string, string | null, number, number, string, string]> = [];
  const batchSize = config.embedBatchSize;
  for (let i = 0; i < windows.length; i += batchSize) {
    const batch = windows.slice(i, i + batchSize);
    const vectors = await embed(
      batch.map((w) => w.text),
      { userId: opts.userId, lectureId: opts.lectureId },
    );
    for (let j = 0; j < batch.length; j++) {
      const w = batch[j];
      rows.push([
        opts.lectureId,
        opts.userId,
        opts.courseId,
        w.start_ms,
        w.end_ms,
        w.text,
        `[${vectors[j].join(",")}]`,
      ]);
    }
  }

  const db = sql();
  await db.begin(async (tx) => {
    await tx`delete from search_chunks where lecture_id=${opts.lectureId} and user_id=${opts.userId}`;
    for (const [lectureId, userId, courseId, startMs, endMs, text, embedding] of rows) {
      await tx`insert into search_chunks(lecture_id, user_id, course_id, start_ms, end_ms, text, embedding)
               values (${lectureId}, ${userId}, ${courseId}, ${startMs}, ${endMs}, ${text}, ${embedding}::vector)`;
    }
  });
  return rows.length;
}
