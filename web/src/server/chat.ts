import "server-only";

/** Pure helpers ported from backend/app/api/chat.py. */

export interface ChunkLike {
  id: number;
  lecture_id: string;
  start_ms: number;
  recorded_at?: Date | string | null;
  course_name?: string | null;
  [k: string]: unknown;
}

export function formatLabel(chunk: ChunkLike): string {
  const totalSec = Math.floor(chunk.start_ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  const date = chunk.recorded_at;
  const dateStr = date ? new Date(date).toISOString().slice(0, 10) : "";
  const course = chunk.course_name ?? "";
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return `[c:${chunk.id} | ${course} | ${dateStr} | ${mm}:${ss}]`;
}

const CITATION_RE = /\[c:(\d+)[^\]]*\]/g;

export interface Citation {
  lecture_id: string;
  start_ms: number;
}

export function parseCitations(text: string, chunkById: Map<number, ChunkLike>): Citation[] {
  const seen: Citation[] = [];
  const seenIds = new Set<number>();
  for (const m of text.matchAll(CITATION_RE)) {
    const cid = Number(m[1]);
    if (seenIds.has(cid)) continue;
    const chunk = chunkById.get(cid);
    if (!chunk) continue;
    seenIds.add(cid);
    seen.push({ lecture_id: chunk.lecture_id, start_ms: chunk.start_ms });
  }
  return seen;
}

export const LECTURE_SCOPE_CHUNK_LIMIT = 120;
