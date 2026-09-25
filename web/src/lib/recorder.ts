import { enqueueSegment } from "./uploadQueue";

const SEGMENT_MS = 30_000;

export function pickMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
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
  private segmentTimer: ReturnType<typeof setInterval> | null = null;
  private elapsedTimer: ReturnType<typeof setInterval> | null = null;
  private visibilityHandler = () => this.reacquireWakeLock();

  lectureId: string;
  elapsedMs = 0;
  bookmarks: Bookmark[] = [];
  onElapsed?: (ms: number) => void;
  onSegmentUploaded?: (idx: number) => void;

  constructor(lectureId: string) {
    this.lectureId = lectureId;
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.mimeType = pickMimeType();
    await this.acquireWakeLock();
    document.addEventListener("visibilitychange", this.visibilityHandler);
    this.startedAt = Date.now();
    this.startSegment();
    this.segmentTimer = setInterval(() => this.rotateSegment(), SEGMENT_MS);
    this.elapsedTimer = setInterval(() => {
      this.elapsedMs = Date.now() - this.startedAt;
      this.onElapsed?.(this.elapsedMs);
    }, 1000);
  }

  private startSegment() {
    if (!this.stream) return;
    this.mediaRecorder = new MediaRecorder(this.stream, this.mimeType ? { mimeType: this.mimeType } : undefined);
    const chunks: Blob[] = [];
    const idx = this.idx;
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    this.mediaRecorder.onstop = async () => {
      if (chunks.length === 0) return;
      const blob = new Blob(chunks, { type: this.mimeType || "audio/webm" });
      await enqueueSegment(this.lectureId, idx, blob);
      this.onSegmentUploaded?.(idx);
    };
    this.mediaRecorder.start();
    this.idx += 1;
  }

  private rotateSegment() {
    this.mediaRecorder?.stop();
    this.startSegment();
  }

  bookmark(): Bookmark {
    const b: Bookmark = { t_ms: this.elapsedMs };
    this.bookmarks.push(b);
    return b;
  }

  async stop(): Promise<void> {
    if (this.segmentTimer) clearInterval(this.segmentTimer);
    if (this.elapsedTimer) clearInterval(this.elapsedTimer);
    document.removeEventListener("visibilitychange", this.visibilityHandler);
    await new Promise<void>((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === "inactive") return resolve();
      this.mediaRecorder.addEventListener("stop", () => resolve(), { once: true });
      this.mediaRecorder.stop();
    });
    this.stream?.getTracks().forEach((t) => t.stop());
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
