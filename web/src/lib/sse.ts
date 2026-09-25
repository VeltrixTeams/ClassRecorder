// Pure SSE line parser for the /chat endpoint's event stream.
// Server sends lines like: data:{"delta":"..."}  data:{"citations":[...]}  data:[DONE]
import type { Citation } from "./types";

export type SseEvent =
  | { type: "delta"; delta: string }
  | { type: "citations"; citations: Citation[] }
  | { type: "done" };

/** Parses one "data:..." line (no leading/trailing newline) into an SseEvent, or null if not a data line. */
export function parseSseLine(line: string): SseEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice("data:".length).trim();
  if (payload === "[DONE]") return { type: "done" };
  try {
    const obj = JSON.parse(payload);
    if (typeof obj.delta === "string") return { type: "delta", delta: obj.delta };
    if (Array.isArray(obj.citations)) return { type: "citations", citations: obj.citations };
  } catch {
    // ignore malformed chunk
  }
  return null;
}

/** Splits a raw SSE buffer into complete lines + leftover partial line (for streaming chunk-by-chunk). */
export function splitSseBuffer(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.filter((l) => l.length > 0), rest };
}

/** Reads a fetch ReadableStream of an SSE response, invoking onEvent for each parsed event. */
export async function consumeSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (evt: SseEvent) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { lines, rest } = splitSseBuffer(buffer);
    buffer = rest;
    for (const line of lines) {
      const evt = parseSseLine(line);
      if (evt) onEvent(evt);
    }
  }
  const evt = parseSseLine(buffer);
  if (evt) onEvent(evt);
}

/** Builds a clickable citation label like "[12:04]" and href for a citation. */
export function buildCitationLink(c: Citation): { label: string; lectureId: string; tMs: number } {
  return { label: `[${Math.floor(c.start_ms / 1000)}]`, lectureId: c.lecture_id, tMs: c.start_ms };
}
