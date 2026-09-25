import { openDB, type IDBPDatabase } from "idb";
import { api, ApiClientError } from "./api";

export type SegmentStatus = "pending" | "uploading" | "uploaded" | "failed";

export interface SegmentRecord {
  lecture_id: string;
  idx: number;
  blob: Blob;
  sha256: string;
  status: SegmentStatus;
  attempts: number;
}

export interface LectureRow {
  lecture_id: string;
  /** false while the recorder object is still alive and adding segments; true once
   *  stop() has run (or the app determines on reload that no recorder can still be
   *  running, so it must have stopped). Only stopped lectures are auto-resumed. */
  stopped: boolean;
}

const DB_NAME = "lecturenote-upload-queue";
const STORE = "segments";
const LECTURES_STORE = "lectures";
const DB_VERSION = 2;
const MAX_COMPLETE_ROUNDS = 5;

let dbPromise: Promise<IDBPDatabase> | null = null;
function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: ["lecture_id", "idx"] });
          store.createIndex("lecture_id", "lecture_id");
        }
        if (!db.objectStoreNames.contains(LECTURES_STORE)) {
          db.createObjectStore(LECTURES_STORE, { keyPath: "lecture_id" });
        }
      },
    });
  }
  return dbPromise;
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Pure: next retry delay (ms) for exponential backoff, capped. */
export function retryDelayMs(attempts: number): number {
  return Math.min(30000, 1000 * 2 ** attempts);
}

/** Pure: given statuses of all known segments for a lecture, are they all uploaded? */
export function allUploaded(statuses: SegmentStatus[]): boolean {
  return statuses.length > 0 && statuses.every((s) => s === "uploaded");
}

export function hasPendingWork(statuses: SegmentStatus[]): boolean {
  return statuses.some((s) => s !== "uploaded");
}

/**
 * Pure: a segment left "uploading" was mid-flight when its tab/worker died — there is
 * no in-progress fetch to wait on any more, so it must be retried like "pending".
 * Called on every resume/round so a killed tab never leaves a segment stuck forever.
 */
export function resetStaleUploading<T extends { status: SegmentStatus }>(records: T[]): T[] {
  return records.map((r) => (r.status === "uploading" ? { ...r, status: "pending" } : r));
}

/**
 * Pure: applies a 409 {missing:[idx]} response — those indices were NOT actually
 * persisted server-side despite being marked "uploaded" locally, so they must be
 * reset to "pending" and re-uploaded before /complete is retried.
 */
export function applyMissingReset<T extends { idx: number; status: SegmentStatus }>(
  records: T[],
  missing: number[]
): T[] {
  const missingSet = new Set(missing);
  return records.map((r) => (missingSet.has(r.idx) ? { ...r, status: "pending" } : r));
}

/**
 * Pure: which lecture rows have not yet been marked stopped. Called on app load —
 * a row that's still "not stopped" belongs to a recorder object that no longer
 * exists (the page reloaded), so it must have stopped; these ids get marked
 * stopped=true before resuming.
 */
export function idsToMarkStopped(rows: LectureRow[]): string[] {
  return rows.filter((r) => !r.stopped).map((r) => r.lecture_id);
}

/**
 * Pure: a lecture is auto-resumable once stopped AND it still has segments in IDB
 * (segments are only removed after /complete succeeds, so "has segments" already
 * means "not completed" — no separate progress bookkeeping needed).
 */
export function selectResumableLectureIds(rows: LectureRow[], idsWithSegments: string[]): string[] {
  const withSegments = new Set(idsWithSegments);
  return rows.filter((r) => r.stopped && withSegments.has(r.lecture_id)).map((r) => r.lecture_id);
}

export async function enqueueSegment(lectureId: string, idx: number, blob: Blob): Promise<void> {
  const sha256 = await sha256Hex(blob);
  const db = await getDb();
  await db.put(STORE, { lecture_id: lectureId, idx, blob, sha256, status: "pending", attempts: 0 } satisfies SegmentRecord);
  const existing = await db.get(LECTURES_STORE, lectureId);
  if (!existing) {
    await db.put(LECTURES_STORE, { lecture_id: lectureId, stopped: false } satisfies LectureRow);
  }
}

/** Marks a lecture as stopped — call before processLectureQueue() when recording ends. */
export async function markLectureStopped(lectureId: string): Promise<void> {
  const db = await getDb();
  await db.put(LECTURES_STORE, { lecture_id: lectureId, stopped: true } satisfies LectureRow);
}

async function removeLectureRow(lectureId: string): Promise<void> {
  const db = await getDb();
  await db.delete(LECTURES_STORE, lectureId);
}

export async function getSegmentsForLecture(lectureId: string): Promise<SegmentRecord[]> {
  const db = await getDb();
  return db.getAllFromIndex(STORE, "lecture_id", lectureId);
}

async function getAllLectureIdsWithSegments(): Promise<string[]> {
  const db = await getDb();
  const all: SegmentRecord[] = await db.getAll(STORE);
  return [...new Set(all.map((s) => s.lecture_id))];
}

async function getAllLectureRows(): Promise<LectureRow[]> {
  const db = await getDb();
  return db.getAll(LECTURES_STORE);
}

async function setStatus(lectureId: string, idx: number, status: SegmentStatus, attempts?: number) {
  const db = await getDb();
  const rec = await db.get(STORE, [lectureId, idx]);
  if (!rec) return;
  rec.status = status;
  if (attempts != null) rec.attempts = attempts;
  await db.put(STORE, rec);
}

async function setStatuses(lectureId: string, idxs: number[], status: SegmentStatus) {
  await Promise.all(idxs.map((idx) => setStatus(lectureId, idx, status)));
}

async function removeSegment(lectureId: string, idx: number) {
  const db = await getDb();
  await db.delete(STORE, [lectureId, idx]);
}

let running = false;

/** Worker loop: uploads all pending/failed/stale-uploading segments for a lecture, then POSTs /complete. Idempotent, resumable. */
export async function processLectureQueue(lectureId: string): Promise<void> {
  if (running) return;
  running = true;
  try {
    // A segment left "uploading" by a killed tab has no in-flight fetch to wait on —
    // treat it as pending before doing anything else.
    const stale = (await getSegmentsForLecture(lectureId)).filter((s) => s.status === "uploading");
    if (stale.length > 0) {
      await setStatuses(lectureId, stale.map((s) => s.idx), "pending");
    }

    for (;;) {
      const segments = await getSegmentsForLecture(lectureId);
      const todo = segments.filter((s) => s.status !== "uploaded");
      if (todo.length === 0) break;

      const { urls } = await api.uploadUrls(
        lectureId,
        todo.map((s) => s.idx)
      );
      const byIdx = new Map(urls.map((u) => [u.idx, u]));

      await Promise.all(
        todo.map(async (seg) => {
          const target = byIdx.get(seg.idx);
          if (!target) return;
          await setStatus(lectureId, seg.idx, "uploading");
          try {
            const res = await fetch(target.url, { method: "PUT", body: seg.blob });
            if (!res.ok) throw new Error(`upload failed: ${res.status}`);
            await setStatus(lectureId, seg.idx, "uploaded");
          } catch {
            await setStatus(lectureId, seg.idx, "failed", seg.attempts + 1);
            await new Promise((r) => setTimeout(r, retryDelayMs(seg.attempts + 1)));
          }
        })
      );

      const remaining = (await getSegmentsForLecture(lectureId)).filter((s) => s.status !== "uploaded");
      if (remaining.length === 0) break;
      // loop again in case any failed and need retry
      if (remaining.every((s) => s.status === "failed")) {
        // brief pause before retrying the whole batch again
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    // /complete can 409 if the server didn't actually persist everything we think is
    // "uploaded" (e.g. a PUT that reported success but was dropped upstream). Reset
    // those indices to pending and retry the whole upload+complete cycle, bounded so
    // a permanently-missing segment can't loop forever.
    for (let round = 0; round < MAX_COMPLETE_ROUNDS; round++) {
      const all = (await getSegmentsForLecture(lectureId)).sort((a, b) => a.idx - b.idx);
      const checksums = all.map((s) => s.sha256);
      try {
        await api.completeLecture(lectureId, all.length, checksums);
        for (const s of all) await removeSegment(lectureId, s.idx);
        await removeLectureRow(lectureId);
        return;
      } catch (e) {
        const err = e as ApiClientError;
        const missing = (err?.body as { missing?: number[] } | undefined)?.missing;
        if (err instanceof ApiClientError && err.status === 409 && missing?.length) {
          await setStatuses(lectureId, missing, "pending");
          // re-upload the now-pending segments before trying /complete again
          const { urls } = await api.uploadUrls(lectureId, missing);
          const byIdx = new Map(urls.map((u) => [u.idx, u]));
          const toUpload = all.filter((s) => missing.includes(s.idx));
          await Promise.all(
            toUpload.map(async (seg) => {
              const target = byIdx.get(seg.idx);
              if (!target) return;
              await setStatus(lectureId, seg.idx, "uploading");
              try {
                const res = await fetch(target.url, { method: "PUT", body: seg.blob });
                if (!res.ok) throw new Error(`upload failed: ${res.status}`);
                await setStatus(lectureId, seg.idx, "uploaded");
              } catch {
                await setStatus(lectureId, seg.idx, "failed", seg.attempts + 1);
              }
            })
          );
          continue; // retry /complete
        }
        throw e;
      }
    }
  } finally {
    running = false;
  }
}

/**
 * Call on app load to resume any not-yet-completed lecture (segments still in IDB
 * mean /complete never succeeded). A lecture row still marked "not stopped" belongs
 * to a recorder object that died with the previous page — the recorder can't still
 * be running, so it's marked stopped here before being resumed.
 */
export async function resumePendingUploads(): Promise<void> {
  const db = await getDb();
  const rows = await getAllLectureRows();
  for (const id of idsToMarkStopped(rows)) {
    await markLectureStopped(id);
  }
  const stoppedRows = await getAllLectureRows();
  const idsWithSegments = await getAllLectureIdsWithSegments();
  const resumable = selectResumableLectureIds(stoppedRows, idsWithSegments);
  // a lecture row can exist with no segments left only if a previous run crashed
  // between removeSegment() and removeLectureRow() — clean it up rather than leaking it
  for (const row of stoppedRows) {
    if (!idsWithSegments.includes(row.lecture_id)) await db.delete(LECTURES_STORE, row.lecture_id);
  }
  for (const id of resumable) {
    processLectureQueue(id).catch(() => {
      // swallow; will retry on next resume or manual trigger
    });
  }
}
