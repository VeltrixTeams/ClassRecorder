import "server-only";

/** Pure helpers ported from backend/app/api/lectures.py. */

/** Which chunk indices in [0, chunkCount) are not uploaded. */
export function missingIndices(chunkCount: number, uploaded: Set<number>): number[] {
  const missing: number[] = [];
  for (let i = 0; i < chunkCount; i++) if (!uploaded.has(i)) missing.push(i);
  return missing;
}

export interface StorageObjectLike {
  name: string;
  metadata?: { size?: number } | null;
}

/** Given a Supabase Storage object-list response for a lecture's chunks/
 * prefix, return the set of chunk indices that are actually present with
 * non-zero size (i.e. really uploaded, not just claimed by the client). */
export function parseUploadedIndices(objects: StorageObjectLike[]): Set<number> {
  const present = new Set<number>();
  for (const obj of objects) {
    const name = obj.name ?? "";
    const size = obj.metadata?.size ?? 0;
    if (size <= 0) continue;
    const stem = name.split(".", 1)[0];
    if (/^\d+$/.test(stem)) present.add(parseInt(stem, 10));
  }
  return present;
}

export interface ScheduleSlot {
  dow: number;
  start: string;
  end: string;
}

/** Best-effort: match recordedAt (local wall-clock time in tz) against
 * course.schedule. dow: ISO weekday (1=Mon..7=Sun), matching Python's
 * `.isoweekday()`. */
export function guessCourseId(
  courses: { id: string; schedule: ScheduleSlot[] }[],
  recordedAt: Date,
  timezone = "UTC",
): string | null {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(recordedAt);
  const weekdayShort = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  const dowMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const dow = dowMap[weekdayShort] ?? 1;
  const hhmm = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;

  for (const c of courses) {
    for (const slot of c.schedule ?? []) {
      const start = slot.start ?? "00:00";
      const end = slot.end ?? "23:59";
      if (slot.dow === dow && start <= hhmm && hhmm <= end) return c.id;
    }
  }
  return null;
}
