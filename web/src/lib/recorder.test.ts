import { describe, it, expect, vi, beforeEach } from "vitest";
import { nextSegmentIndex, describeRecorderError } from "./recorder";

describe("nextSegmentIndex", () => {
  it("assigns sequential indices as segments are enqueued, starting at 0", () => {
    let enqueued = 0;
    const indices = [0, 1, 2, 3].map(() => {
      const idx = nextSegmentIndex(enqueued);
      enqueued += 1;
      return idx;
    });
    expect(indices).toEqual([0, 1, 2, 3]);
  });
});

describe("describeRecorderError", () => {
  it("returns a Thai message for a mic/track ended", () => {
    expect(describeRecorderError("track-ended")).toMatch(/ไมโครโฟน/);
  });
  it("returns a Thai message for a MediaRecorder error", () => {
    expect(describeRecorderError("recorder-error")).toContain("บันทึกเสียง");
  });
});

// --- stop() must wait for the final (in-flight) enqueue before resolving ---

const enqueueSegment = vi.fn();
vi.mock("./uploadQueue", () => ({
  enqueueSegment: (...args: unknown[]) => enqueueSegment(...args),
}));

/** Minimal fake MediaRecorder: start() is a no-op, stop() fires "stop" listeners
 *  asynchronously (as real MediaRecorder does), matching the class's own stop(). */
class FakeMediaRecorder {
  static isTypeSupported() {
    return true;
  }
  state: "recording" | "inactive" = "recording";
  ondataavailable: ((e: { data: { size: number } }) => void) | null = null;
  onerror: (() => void) | null = null;
  private stopListeners: (() => void)[] = [];
  start() {
    this.state = "recording";
  }
  addEventListener(type: string, cb: () => void) {
    if (type === "stop") this.stopListeners.push(cb);
  }
  stop() {
    this.state = "inactive";
    queueMicrotask(() => this.stopListeners.forEach((cb) => cb()));
  }
  emitFinalData() {
    this.ondataavailable?.({ data: { size: 100 } });
  }
}

function fakeStream() {
  return {
    getAudioTracks: () => [{ onended: null, stop: () => {} }],
    getTracks: () => [{ onended: null, stop: () => {} }],
  } as unknown as MediaStream;
}

beforeEach(() => {
  enqueueSegment.mockReset();
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: async () => fakeStream() }, wakeLock: undefined });
  vi.stubGlobal("document", { addEventListener: () => {}, removeEventListener: () => {} });
});

describe("LectureRecorder.stop() ordering", () => {
  it("resolves only after the final segment's enqueueSegment() has completed", async () => {
    let enqueueResolved = false;
    enqueueSegment.mockImplementation(
      () =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            enqueueResolved = true;
            resolve();
          }, 20)
        )
    );

    const { LectureRecorder } = await import("./recorder");
    const rec = new LectureRecorder("lecture-1");
    await rec.start();

    const fake = (rec as unknown as { mediaRecorder: FakeMediaRecorder }).mediaRecorder;
    fake.emitFinalData(); // last dataavailable, fired right before stop — not yet settled

    expect(enqueueResolved).toBe(false);
    await rec.stop();
    expect(enqueueResolved).toBe(true);
  });
});
