// Pure formatting helpers — no DOM, no I/O. Covered by format.test.ts.

/** ms -> "m:ss" or "h:mm:ss", matches prototype's fmt() */
export function formatMs(ms: number): string {
  return formatSec(ms / 1000);
}

export function formatSec(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? h + ":" : ""}${mm}:${String(x).padStart(2, "0")}`;
}

/** Always h:mm:ss (recording timer) */
export function formatTimer(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  return [h, m, x].map((n) => String(n).padStart(2, "0")).join(":");
}
