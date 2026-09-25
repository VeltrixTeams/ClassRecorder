import { describe, it, expect } from "vitest";
import {
  retryDelayMs,
  allUploaded,
  hasPendingWork,
  resetStaleUploading,
  applyMissingReset,
  idsToMarkStopped,
  selectResumableLectureIds,
  type LectureRow,
} from "./uploadQueue";

describe("retryDelayMs", () => {
  it("doubles per attempt and caps at 30s", () => {
    expect(retryDelayMs(0)).toBe(1000);
    expect(retryDelayMs(1)).toBe(2000);
    expect(retryDelayMs(5)).toBe(30000);
    expect(retryDelayMs(10)).toBe(30000);
  });
});

describe("allUploaded", () => {
  it("false when empty", () => expect(allUploaded([])).toBe(false));
  it("true when all uploaded", () => expect(allUploaded(["uploaded", "uploaded"])).toBe(true));
  it("false when any not uploaded", () => expect(allUploaded(["uploaded", "pending"])).toBe(false));
});

describe("hasPendingWork", () => {
  it("true when something not uploaded", () => expect(hasPendingWork(["uploaded", "failed"])).toBe(true));
  it("false when all done", () => expect(hasPendingWork(["uploaded"])).toBe(false));
});

describe("resetStaleUploading", () => {
  it("resets a segment stuck in 'uploading' (killed tab) back to pending", () => {
    const records = [
      { idx: 0, status: "uploaded" as const },
      { idx: 1, status: "uploading" as const },
      { idx: 2, status: "failed" as const },
    ];
    expect(resetStaleUploading(records)).toEqual([
      { idx: 0, status: "uploaded" },
      { idx: 1, status: "pending" },
      { idx: 2, status: "failed" },
    ]);
  });
  it("leaves records unchanged when nothing is uploading", () => {
    const records = [{ idx: 0, status: "uploaded" as const }];
    expect(resetStaleUploading(records)).toEqual(records);
  });
});

describe("applyMissingReset", () => {
  it("resets only the indices the server reports missing on a 409, even if marked uploaded locally", () => {
    const records = [
      { idx: 0, status: "uploaded" as const },
      { idx: 1, status: "uploaded" as const },
      { idx: 2, status: "uploaded" as const },
    ];
    expect(applyMissingReset(records, [1])).toEqual([
      { idx: 0, status: "uploaded" },
      { idx: 1, status: "pending" },
      { idx: 2, status: "uploaded" },
    ]);
  });
  it("is a no-op when missing is empty", () => {
    const records = [{ idx: 0, status: "uploaded" as const }];
    expect(applyMissingReset(records, [])).toEqual(records);
  });
});

describe("idsToMarkStopped", () => {
  it("selects rows not yet marked stopped (recorder object is gone after reload)", () => {
    const rows: LectureRow[] = [
      { lecture_id: "a", stopped: true },
      { lecture_id: "b", stopped: false },
    ];
    expect(idsToMarkStopped(rows)).toEqual(["b"]);
  });
  it("empty when everything already stopped", () => {
    expect(idsToMarkStopped([{ lecture_id: "a", stopped: true }])).toEqual([]);
  });
});

describe("selectResumableLectureIds", () => {
  it("resumes only stopped lectures that still have segments in IDB", () => {
    const rows: LectureRow[] = [
      { lecture_id: "a", stopped: true }, // has segments -> resume
      { lecture_id: "b", stopped: true }, // no segments left (already completed) -> skip
      { lecture_id: "c", stopped: false }, // still recording -> never resume
    ];
    expect(selectResumableLectureIds(rows, ["a", "c"])).toEqual(["a"]);
  });
  it("never resumes a lecture still marked not stopped, even with segments present", () => {
    const rows: LectureRow[] = [{ lecture_id: "c", stopped: false }];
    expect(selectResumableLectureIds(rows, ["c"])).toEqual([]);
  });
  it("empty when no rows have segments", () => {
    const rows: LectureRow[] = [{ lecture_id: "a", stopped: true }];
    expect(selectResumableLectureIds(rows, [])).toEqual([]);
  });
});
