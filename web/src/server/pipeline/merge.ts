import "server-only";

/** PURE functions merging per-chunk STT word lists into transcript segments.
 * Port of backend/app/pipeline/merge.py. No I/O, no config/db imports. */

export interface Word {
  start_ms: number;
  end_ms: number;
  text: string;
  speaker: string;
}

export interface Segment {
  start_ms: number;
  end_ms: number;
  speaker: string;
  text: string;
  words: Word[];
}

const SENTENCE_ENDERS = [".", "?", "!", "。", "…"];

function endsWithSentenceEnder(text: string): boolean {
  const trimmed = text.trim();
  return SENTENCE_ENDERS.some((e) => trimmed.endsWith(e));
}

/** Concatenate per-chunk word lists, dropping earlier-chunk words that fall
 * within `overlapMs` of the next chunk's first word start (later chunk wins
 * for that time range). */
export function dedupOverlap(chunks: Word[][], overlapMs: number): Word[] {
  const merged: Word[] = [];
  for (let i = 0; i < chunks.length; i++) {
    let chunk = chunks[i];
    if (!chunk || chunk.length === 0) continue;
    const next = chunks[i + 1];
    if (next && next.length > 0) {
      const cutoff = next[0].start_ms - overlapMs;
      chunk = chunk.filter((w) => w.start_ms < cutoff);
    }
    merged.push(...chunk);
  }
  merged.sort((a, b) => a.start_ms - b.start_ms);
  return merged;
}

/** Group a flat, time-ordered word list into sentence-level segments, split
 * on sentence-ending punctuation, speaker change, or a gap > maxGapMs. */
export function groupSentences(words: Word[], maxGapMs = 1500): Segment[] {
  const segments: Segment[] = [];
  let current: Word[] = [];

  const flush = () => {
    if (current.length === 0) return;
    segments.push({
      start_ms: current[0].start_ms,
      end_ms: current[current.length - 1].end_ms,
      speaker: current[0].speaker,
      text: current.map((w) => w.text).join(" ").trim(),
      words: [...current],
    });
  };

  let prev: Word | null = null;
  for (const w of words) {
    if (current.length > 0 && prev !== null) {
      const gap = w.start_ms - prev.end_ms;
      const speakerChanged = w.speaker !== current[0].speaker;
      if (speakerChanged || gap > maxGapMs) {
        flush();
        current = [];
      }
    }
    current.push(w);
    prev = w;
    if (endsWithSentenceEnder(w.text)) {
      flush();
      current = [];
      prev = null;
    }
  }
  flush();
  return segments;
}

/** Full merge pipeline: dedup overlap then group into sentences. */
export function mergeChunks(chunks: Word[][], overlapMs = 2000, maxGapMs = 1500): Segment[] {
  const words = dedupOverlap(chunks, overlapMs);
  return groupSentences(words, maxGapMs);
}

/** Deepgram pre-recorded word shape (nova-3, diarize=true): start/end in
 * seconds, integer speaker id, punctuated_word for display casing/punct. */
export interface DeepgramWord {
  start: number;
  end: number;
  speaker?: number;
  punctuated_word?: string;
  word: string;
}

export interface DeepgramResult {
  results?: {
    channels?: Array<{
      alternatives?: Array<{ words?: DeepgramWord[] }>;
    }>;
  };
}

/** Extract the word list from a Deepgram callback body (channel 0, best
 * alternative). */
function extractWords(result: DeepgramResult): DeepgramWord[] {
  return result.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];
}

/** Convert a Deepgram result into transcript segments: ms offsets, the
 * speaker who talks the longest (summed word duration) labeled 'lecturer',
 * everyone else 'student', then sentence-grouped (max gap 1500ms). */
export function fromDeepgramResult(result: DeepgramResult, maxGapMs = 1500): Segment[] {
  const dgWords = extractWords(result);
  if (dgWords.length === 0) return [];

  const durationBySpeaker = new Map<number, number>();
  for (const w of dgWords) {
    const speaker = w.speaker ?? 0;
    durationBySpeaker.set(speaker, (durationBySpeaker.get(speaker) ?? 0) + (w.end - w.start));
  }
  let lecturerSpeaker = 0;
  let maxDuration = -1;
  for (const [speaker, duration] of durationBySpeaker) {
    if (duration > maxDuration) {
      maxDuration = duration;
      lecturerSpeaker = speaker;
    }
  }

  const words: Word[] = dgWords.map((w) => ({
    start_ms: Math.round(w.start * 1000),
    end_ms: Math.round(w.end * 1000),
    text: w.punctuated_word ?? w.word,
    speaker: (w.speaker ?? 0) === lecturerSpeaker ? "lecturer" : "student",
  }));

  return groupSentences(words, maxGapMs);
}
