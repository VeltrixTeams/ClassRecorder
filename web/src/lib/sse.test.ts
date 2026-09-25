import { describe, it, expect } from "vitest";
import { parseSseLine, splitSseBuffer, buildCitationLink } from "./sse";

describe("parseSseLine", () => {
  it("parses a delta event", () => {
    expect(parseSseLine('data:{"delta":"hi"}')).toEqual({ type: "delta", delta: "hi" });
  });
  it("parses citations", () => {
    const evt = parseSseLine('data:{"citations":[{"lecture_id":"a","start_ms":100}]}');
    expect(evt).toEqual({ type: "citations", citations: [{ lecture_id: "a", start_ms: 100 }] });
  });
  it("parses [DONE]", () => {
    expect(parseSseLine("data:[DONE]")).toEqual({ type: "done" });
  });
  it("ignores non-data lines", () => {
    expect(parseSseLine("")).toBeNull();
    expect(parseSseLine("event: ping")).toBeNull();
  });
  it("ignores malformed json", () => {
    expect(parseSseLine("data:{bad")).toBeNull();
  });
});

describe("splitSseBuffer", () => {
  it("splits complete lines and keeps partial tail", () => {
    const { lines, rest } = splitSseBuffer('data:{"delta":"a"}\ndata:{"delta":"b"}\ndata:{"del');
    expect(lines).toEqual(['data:{"delta":"a"}', 'data:{"delta":"b"}']);
    expect(rest).toBe('data:{"del');
  });
});

describe("buildCitationLink", () => {
  it("builds label and target", () => {
    expect(buildCitationLink({ lecture_id: "abc", start_ms: 12500 })).toEqual({
      label: "[12]",
      lectureId: "abc",
      tMs: 12500,
    });
  });
});
