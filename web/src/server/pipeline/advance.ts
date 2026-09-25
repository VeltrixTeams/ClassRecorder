import "server-only";
import { after } from "next/server";
import { config } from "../config";
import { sql } from "../db";
import * as storage from "../storage";
import { hmac, submit as deepgramSubmit } from "../ai/deepgram";
import { fromDeepgramResult } from "./merge";
import { nextStep, type Step } from "./plan";
import { summarize } from "../summary";
import { indexLecture } from "./searchIndex";
import { notifyUser } from "./notify";

/**
 * Contract between route handlers (stage 2) and the pipeline (stage 3).
 * kick(): schedule advance(lectureId) after the response is sent (next/server `after`).
 */
export function kick(lectureId: string): void {
  after(async () => {
    try {
      await fetch(`${config.appUrl}/api/pipeline/advance`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.cronSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ lectureId }),
      });
    } catch (e) {
      console.error("kick failed", e);
    }
  });
}

const STEP_STATUS: Record<Step, string> = {
  finalize: "finalizing",
  transcribe: "transcribing",
  waiting: "transcribing",
  segments: "transcribing",
  summarize: "summarizing",
  index: "indexing",
  ready: "ready",
};

// Longer than maxDuration (300s) so a step finishing near the limit can't
// overlap a sweep re-claim of the same lecture.
const LOCK_MINUTES = 6;

interface LectureRow {
  id: string;
  user_id: string;
  course_id: string | null;
  audio_path: string | null;
  mime_type: string | null;
  chunk_count: number;
  duration_ms: number | null;
  stt_request_id: string | null;
  stt_submitted_at: Date | null;
  stt_attempts: number;
}

function chunkObjectPath(userId: string, lectureId: string, idx: number): string {
  return `${userId}/${lectureId}/chunks/${String(idx).padStart(4, "0")}.audio`;
}

function extForMime(mimeType: string | null): "webm" | "mp4" {
  return mimeType && mimeType.includes("mp4") ? "mp4" : "webm";
}

async function loadOutputs(lectureId: string, userId: string) {
  const db = sql();
  const [sttResults, segCount, summaryRow, chunkCount] = await Promise.all([
    db<{ result: unknown }[]>`select result from stt_results where lecture_id=${lectureId} and user_id=${userId}`,
    db<{ n: number }[]>`select count(*)::int as n from transcript_segments where lecture_id=${lectureId} and user_id=${userId}`,
    db<{ lecture_id: string }[]>`select lecture_id from summaries where lecture_id=${lectureId} and user_id=${userId} and lang='th'`,
    db<{ n: number }[]>`select count(*)::int as n from search_chunks where lecture_id=${lectureId} and user_id=${userId}`,
  ]);
  return {
    sttResult: sttResults[0]?.result ?? null,
    hasSttResults: sttResults.length > 0,
    hasTranscriptSegments: segCount[0].n > 0,
    hasThSummary: summaryRow.length > 0,
    hasSearchChunks: chunkCount[0].n > 0,
  };
}

async function setStatus(
  lectureId: string,
  status: string,
  opts: { progress?: unknown; error?: string | null } = {},
): Promise<void> {
  const db = sql();
  if (opts.progress !== undefined) {
    await db`
      update lectures set status=${status}, progress=${db.json(opts.progress as any)}, error=${opts.error ?? null}
      where id=${lectureId}
    `;
  } else {
    await db`
      update lectures set status=${status}, error=${opts.error ?? null}
      where id=${lectureId}
    `;
  }
}

async function runFinalize(lecture: LectureRow): Promise<void> {
  const chunks: Uint8Array[] = [];
  for (let idx = 0; idx < (lecture.chunk_count || 0); idx++) {
    const buf = await storage.download(config.audioBucket, chunkObjectPath(lecture.user_id, lecture.id, idx));
    chunks.push(new Uint8Array(buf));
  }
  const totalLen = chunks.reduce((n, c) => n + c.length, 0);
  const full = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) {
    full.set(c, offset);
    offset += c.length;
  }
  const ext = extForMime(lecture.mime_type);
  const audioPath = `${lecture.user_id}/${lecture.id}/full.${ext}`;
  await storage.upload(config.audioBucket, audioPath, full, lecture.mime_type ?? `audio/${ext}`);
  await sql()`update lectures set audio_path=${audioPath} where id=${lecture.id}`;
}

async function runTranscribe(lecture: LectureRow): Promise<void> {
  if (!lecture.audio_path) throw new Error("cannot transcribe: audio_path missing");
  const signedUrl = await storage.createSignedDownloadUrl(config.audioBucket, lecture.audio_path, 3600);
  const token = hmac(lecture.id);
  const callbackUrl = `${config.appUrl}/api/webhooks/deepgram?lecture=${lecture.id}&token=${token}`;

  let keywords: string[] | undefined;
  if (lecture.course_id) {
    const rows = await sql()<{ vocabulary: string[] | null }[]>`
      select vocabulary from courses where id=${lecture.course_id} and user_id=${lecture.user_id}
    `;
    keywords = rows[0]?.vocabulary ?? undefined;
  }

  const requestId = await deepgramSubmit(signedUrl, callbackUrl, keywords);
  await sql()`
    update lectures set stt_request_id=${requestId}, stt_submitted_at=now(), stt_attempts=stt_attempts+1
    where id=${lecture.id}
  `;
}

async function runSegments(lecture: LectureRow, sttResult: unknown): Promise<void> {
  const segments = fromDeepgramResult(sttResult as never);
  const db = sql();
  await db.begin(async (tx) => {
    await tx`delete from transcript_segments where lecture_id=${lecture.id} and user_id=${lecture.user_id}`;
    for (const s of segments) {
      await tx`
        insert into transcript_segments(lecture_id, user_id, start_ms, end_ms, speaker, text, words)
        values (${lecture.id}, ${lecture.user_id}, ${s.start_ms}, ${s.end_ms}, ${s.speaker}, ${s.text}, ${tx.json(s.words as any)})
      `;
    }
  });
}

async function runSummarize(lecture: LectureRow): Promise<void> {
  const db = sql();
  const rows = await db<{ start_ms: number; end_ms: number; speaker: string; text: string }[]>`
    select start_ms, end_ms, speaker, text from transcript_segments
    where lecture_id=${lecture.id} and user_id=${lecture.user_id} order by start_ms
  `;
  // ponytail: map-reduce for very long transcripts runs inline inside this
  // one advance() step rather than as separate summary_parts steps, so a
  // lecture long enough to need many windows risks exceeding maxDuration
  // (300s). Upgrade path: persist each window's result to summary_parts and
  // make each window (and the final merge) its own advance() step.
  const content = await summarize(rows, lecture.duration_ms ?? 0, {
    userId: lecture.user_id,
    lectureId: lecture.id,
  });
  await db`
    insert into summaries(lecture_id, user_id, lang, content) values (${lecture.id}, ${lecture.user_id}, 'th', ${db.json(content as any)})
    on conflict (lecture_id, lang) do update set content=excluded.content, stale=false
  `;
}

async function runIndex(lecture: LectureRow): Promise<void> {
  const db = sql();
  const rows = await db<{ start_ms: number; end_ms: number; text: string }[]>`
    select start_ms, end_ms, text from transcript_segments
    where lecture_id=${lecture.id} and user_id=${lecture.user_id} order by start_ms
  `;
  await indexLecture({ userId: lecture.user_id, lectureId: lecture.id, courseId: lecture.course_id, segments: rows });
}

async function runReady(lecture: LectureRow, sttResult: unknown): Promise<void> {
  await storage.deletePrefix(config.audioBucket, `${lecture.user_id}/${lecture.id}/chunks`);
  const durationMs = extractDurationMs(sttResult);
  const db = sql();
  if (durationMs !== null) {
    await db`update lectures set duration_ms=${durationMs} where id=${lecture.id}`;
  }
  await notifyUser(lecture.user_id, "สรุปพร้อมแล้ว", "บันทึกการบรรยายของคุณพร้อมให้อ่านแล้ว", {
    lecture_id: lecture.id,
  });
}

function extractDurationMs(sttResult: unknown): number | null {
  const r = sttResult as { metadata?: { duration?: number } } | null;
  const seconds = r?.metadata?.duration;
  return typeof seconds === "number" ? Math.round(seconds * 1000) : null;
}

/** Claims the per-lecture lock, runs exactly one pipeline step, releases the
 * lock, then (unless the step is a terminal wait state) schedules another
 * advance() via kick(). Safe to call repeatedly / concurrently: a lecture
 * whose lock is already held (not yet expired) is a no-op. */
export async function advance(lectureId: string): Promise<{ ran: Step | "locked" | "missing" }> {
  const db = sql();
  const claimed = await db<LectureRow[]>`
    update lectures set locked_until = now() + (${LOCK_MINUTES} || ' minutes')::interval
    where id=${lectureId} and (locked_until is null or locked_until < now())
    returning id, user_id, course_id, audio_path, mime_type, chunk_count, duration_ms,
              stt_request_id, stt_submitted_at, stt_attempts
  `;
  const lecture = claimed[0];
  if (!lecture) return { ran: "locked" };

  try {
    const outputs = await loadOutputs(lecture.id, lecture.user_id);
    const step = nextStep({
      audioPath: lecture.audio_path,
      sttRequestId: lecture.stt_request_id,
      sttSubmittedAt: lecture.stt_submitted_at,
      hasSttResults: outputs.hasSttResults,
      hasTranscriptSegments: outputs.hasTranscriptSegments,
      hasThSummary: outputs.hasThSummary,
      hasSearchChunks: outputs.hasSearchChunks,
    });

    if (step === "ready") {
      await runReady(lecture, outputs.sttResult);
      await setStatus(lecture.id, "ready", { progress: { step: "ready", done: 5, total: 5 } });
      await db`update lectures set locked_until=null where id=${lecture.id}`;
      return { ran: "ready" };
    }

    if (step === "waiting") {
      await db`update lectures set locked_until=null where id=${lecture.id}`;
      return { ran: "waiting" };
    }

    await setStatus(lecture.id, STEP_STATUS[step], { progress: { step, done: STEP_INDEX[step], total: 5 } });

    if (step === "finalize") await runFinalize(lecture);
    else if (step === "transcribe") await runTranscribe(lecture);
    else if (step === "segments") await runSegments(lecture, outputs.sttResult);
    else if (step === "summarize") await runSummarize(lecture);
    else if (step === "index") await runIndex(lecture);

    await db`update lectures set locked_until=null where id=${lecture.id}`;
    kick(lecture.id);
    return { ran: step };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await setStatus(lecture.id, "failed", { error: message });
    await db`update lectures set locked_until=null where id=${lecture.id}`;
    await notifyUser(lecture.user_id, "เกิดข้อผิดพลาด", "การประมวลผลบันทึกล้มเหลว ลองใหม่อีกครั้ง", {
      lecture_id: lecture.id,
    }).catch(() => {});
    throw e;
  }
}

const STEP_INDEX: Record<Step, number> = {
  finalize: 0,
  transcribe: 1,
  waiting: 1,
  segments: 2,
  summarize: 3,
  index: 4,
  ready: 5,
};
