import { enqueueSegment } from "./uploadQueue";

const TIMESLICE_MS = 30_000;
const AUDIO_BITS_PER_SECOND = 32_000;

export function pickMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
}

/**
 * Pure: next segment index for a dataavailable/final blob, given how many segments
 * have already been enqueued for this lecture. Segments are numbered 0,1,2… in the
 * order chunks arrive from the single MediaRecorder; the last one (on stop) is just
 * whatever index comes next, not a special case.
 */
export function nextSegmentIndex(enqueuedCount: number): number {
  return enqueuedCount;
}

/**
 * Pure: maps a MediaRecorder/track failure to a Thai toast message. Covers mic
 * unplugged / permission revoked (track "ended") and MediaRecorder "error" events.
 */
export function describeRecorderError(source: "track-ended" | "recorder-error"): string {
  if (source === "track-ended") return "การบันทึกหยุดลง — ไมโครโฟนถูกถอดหรือถูกเพิกถอนสิทธิ์";
  return "เกิดข้อผิดพลาดในการบันทึกเสียง — บันทึกที่มีอยู่ถูกบันทึกไว้แล้ว";
}

export interface Bookmark {
  t_ms: number;
  note?: string;
}

export class LectureRecorder {
  private stream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private mimeType = "";
  private idx = 0;
  private startedAt = 0;
  private elapsedTimer: ReturnType<typeof setInterval> | null = null;
  private visibilityHandler = () => this.reacquireWakeLock();
  private stopping = false;
  /** Pending enqueueSegment() calls (sha256 + IDB write), including the final chunk
   *  fired right before the recorder's "stop" event. stop() must await all of these —
   *  otherwise /complete can run before the last segment is persisted, truncating the
   *  byte-concatenated audio and reporting the wrong chunk_count. */
  private pendingEnqueues = new Set<Promise<void>>();

  lectureId: string;
  elapsedMs = 0;
  bookmarks: Bookmark[] = [];
  onElapsed?: (ms: number) => void;
  onSegmentUploaded?: (idx: number) => void;
  /** Fired when recording stops itself due to a mic/track/recorder failure (not a user-initiated stop). */
  onError?: (message: string) => void;

  constructor(lectureId: string) {
    this.lectureId = lectureId;
  }

  get selectedMimeType(): string {
    return this.mimeType;
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.mimeType = pickMimeType();
    await this.acquireWakeLock();
    document.addEventListener("visibilitychange", this.visibilityHandler);
    this.startedAt = Date.now();
    this.startRecorder();
    this.elapsedTimer = setInterval(() => {
      this.elapsedMs = Date.now() - this.startedAt;
      this.onElapsed?.(this.elapsedMs);
    }, 1000);
  }

  private startRecorder() {
    if (!this.stream) return;
    this.mediaRecorder = new MediaRecorder(this.stream, {
      ...(this.mimeType ? { mimeType: this.mimeType } : {}),
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
    });
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size === 0) return;
      const idx = nextSegmentIndex(this.idx);
      this.idx += 1;
      const task = this.enqueueWithRetry(idx, e.data);
      this.pendingEnqueues.add(task);
      task.finally(() => this.pendingEnqueues.delete(task));
    };
    this.mediaRecorder.onerror = () => {
      if (this.stopping) return;
      this.onError?.(describeRecorderError("recorder-error"));
      this.stop().catch(() => {});
    };
    const track = this.stream.getAudioTracks()[0];
    if (track) {
      track.onended = () => {
        if (this.stopping) return;
        this.onError?.(describeRecorderError("track-ended"));
        this.stop().catch(() => {});
      };
    }
    this.mediaRecorder.start(TIMESLICE_MS);
  }

  /**
   * enqueueSegment() is a local IndexedDB write (sha256 + put) that can fail
   * transiently. Chunks are byte-concatenated server-side, so silently dropping one
   * corrupts the whole file — retry once, and if it still fails, surface it via
   * onError instead of swallowing it.
   */
  private async enqueueWithRetry(idx: number, blob: Blob): Promise<void> {
    try {
      await enqueueSegment(this.lectureId, idx, blob);
    } catch {
      try {
        await enqueueSegment(this.lectureId, idx, blob);
      } catch {
        this.onError?.(`บันทึกส่วนที่ ${idx} ไม่สำเร็จ — ไฟล์เสียงอาจไม่สมบูรณ์`);
        return;
      }
    }
    this.onSegmentUploaded?.(idx);
  }

  bookmark(): Bookmark {
    const b: Bookmark = { t_ms: this.elapsedMs };
    this.bookmarks.push(b);
    return b;
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    if (this.elapsedTimer) clearInterval(this.elapsedTimer);
    document.removeEventListener("visibilitychange", this.visibilityHandler);
    await new Promise<void>((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === "inactive") return resolve();
      this.mediaRecorder.addEventListener("stop", () => resolve(), { once: true });
      this.mediaRecorder.stop();
    });
    // The final dataavailable fires right before "stop" but enqueueSegment() is async —
    // without this, /complete could run before the last segment is persisted.
    await Promise.all(this.pendingEnqueues);
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    await this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
  }

  private async acquireWakeLock() {
    try {
      this.wakeLock = await navigator.wakeLock?.request("screen");
    } catch {
      // wake lock unsupported/denied — recording still proceeds
    }
  }

  private async reacquireWakeLock() {
    if (document.visibilityState === "visible" && !this.wakeLock) {
      await this.acquireWakeLock();
    }
  }
}
