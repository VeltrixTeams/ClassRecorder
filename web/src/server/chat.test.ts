import { describe, expect, it } from "vitest";
import { formatLabel, parseCitations, type ChunkLike } from "./chat";

describe("parseCitations", () => {
  const chunkById = new Map<number, ChunkLike>([
    [1, { id: 1, lecture_id: "lec-a", start_ms: 62_000 }],
    [2, { id: 2, lecture_id: "lec-b", start_ms: 5_000 }],
  ]);

  it("maps labels to lecture and time", () => {
    const text = "As mentioned [c:1 | Calc | 2024-01-01 | 01:02], and also [c:2 | Physics | 2024-01-02 | 00:05].";
    expect(parseCitations(text, chunkById)).toEqual([
      { lecture_id: "lec-a", start_ms: 62_000 },
      { lecture_id: "lec-b", start_ms: 5_000 },
    ]);
  });

  it("dedupes repeated citations", () => {
    const single = new Map<number, ChunkLike>([[1, { id: 1, lecture_id: "lec-a", start_ms: 1000 }]]);
    const text = "[c:1 | x | y | 00:01] repeated again [c:1 | x | y | 00:01]";
    expect(parseCitations(text, single)).toHaveLength(1);
  });

  it("ignores unknown ids", () => {
    expect(parseCitations("See [c:999 | x | y | 00:00]", new Map())).toEqual([]);
  });
});

describe("formatLabel", () => {
  it("includes mm:ss and course name", () => {
    const chunk: ChunkLike = {
      id: 5,
      lecture_id: "lec-x",
      start_ms: 125_000,
      recorded_at: null,
      course_name: "Calc I",
    };
    const label = formatLabel(chunk);
    expect(label.startsWith("[c:5")).toBe(true);
    expect(label).toContain("02:05");
    expect(label).toContain("Calc I");
  });
});
