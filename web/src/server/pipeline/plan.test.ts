import { describe, expect, it } from "vitest";
import { nextStep } from "./plan";

const base = {
  audioPath: "u/l/full.webm",
  sttRequestId: null,
  sttSubmittedAt: null,
  hasSttResults: false,
  hasTranscriptSegments: false,
  hasThSummary: false,
  hasSearchChunks: false,
};

describe("nextStep", () => {
  it("finalizes first when audio_path is missing", () => {
    expect(nextStep({ ...base, audioPath: null })).toBe("finalize");
  });

  it("transcribes when no stt request is outstanding", () => {
    expect(nextStep({ ...base })).toBe("transcribe");
  });

  it("waits when an stt request was submitted recently", () => {
    const now = new Date("2024-01-01T00:10:00Z");
    const submitted = new Date("2024-01-01T00:00:00Z"); // 10 min ago
    expect(nextStep({ ...base, sttRequestId: "req1", sttSubmittedAt: submitted, now })).toBe("waiting");
  });

  it("resubmits transcription once the wait exceeds 30 minutes", () => {
    const now = new Date("2024-01-01T00:31:00Z");
    const submitted = new Date("2024-01-01T00:00:00Z");
    expect(nextStep({ ...base, sttRequestId: "req1", sttSubmittedAt: submitted, now })).toBe("transcribe");
  });

  it("builds segments once stt results arrive", () => {
    expect(nextStep({ ...base, sttRequestId: "req1", sttSubmittedAt: new Date(), hasSttResults: true })).toBe(
      "segments",
    );
  });

  it("summarizes once transcript segments exist", () => {
    expect(nextStep({ ...base, hasSttResults: true, hasTranscriptSegments: true })).toBe("summarize");
  });

  it("indexes once the summary exists", () => {
    expect(
      nextStep({ ...base, hasSttResults: true, hasTranscriptSegments: true, hasThSummary: true }),
    ).toBe("index");
  });

  it("is ready once everything exists", () => {
    expect(
      nextStep({
        ...base,
        hasSttResults: true,
        hasTranscriptSegments: true,
        hasThSummary: true,
        hasSearchChunks: true,
      }),
    ).toBe("ready");
  });
});
