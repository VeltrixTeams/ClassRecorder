import { describe, expect, it } from "vitest";
import { dedupOverlap, fromDeepgramResult, groupSentences, mergeChunks, type Word } from "./merge";

function w(start_ms: number, end_ms: number, text: string, speaker = "lecturer"): Word {
  return { start_ms, end_ms, text, speaker };
}

describe("dedupOverlap", () => {
  it("keeps the later chunk's version of the overlap window", () => {
    const chunk0 = [w(20000, 20500, "hello"), w(28500, 29000, "world-old")];
    const chunk1 = [w(29900, 30400, "world-new"), w(30500, 31000, "next")];
    const merged = dedupOverlap([chunk0, chunk1], 2000);
    const texts = merged.map((x) => x.text);
    expect(texts).not.toContain("world-old");
    expect(texts).toEqual(["hello", "world-new", "next"]);
  });

  it("handles empty chunks", () => {
    expect(dedupOverlap([], 2000)).toEqual([]);
    expect(dedupOverlap([[], []], 2000)).toEqual([]);
    const chunk0 = [w(0, 500, "hi")];
    expect(dedupOverlap([chunk0, []], 2000)).toEqual(chunk0);
  });
});

describe("groupSentences", () => {
  it("splits on sentence-ending punctuation", () => {
    const words = [w(0, 500, "Hello."), w(600, 900, "How"), w(950, 1200, "are"), w(1250, 1600, "you?")];
    const segments = groupSentences(words);
    expect(segments).toHaveLength(2);
    expect(segments[0].text).toBe("Hello.");
    expect(segments[1].text).toBe("How are you?");
    expect(segments[0].start_ms).toBe(0);
    expect(segments[1].end_ms).toBe(1600);
  });

  it("splits on speaker change", () => {
    const words = [w(0, 500, "lecturing", "lecturer"), w(600, 900, "question", "student")];
    const segments = groupSentences(words);
    expect(segments).toHaveLength(2);
    expect(segments[0].speaker).toBe("lecturer");
    expect(segments[1].speaker).toBe("student");
  });

  it("splits on a long gap", () => {
    const words = [w(0, 500, "before"), w(10000, 10500, "after")];
    const segments = groupSentences(words, 1500);
    expect(segments).toHaveLength(2);
  });
});

describe("mergeChunks", () => {
  it("dedupes overlap end to end", () => {
    const chunk0 = [w(0, 400, "Hi."), w(500, 900, "This"), w(950, 1300, "is-old")];
    const chunk1 = [w(900, 1250, "is-new"), w(1300, 1700, "lecture.")];
    const segments = mergeChunks([chunk0, chunk1], 500);
    const allText = segments.map((s) => s.text).join(" ");
    expect(allText).not.toContain("is-old");
    expect(allText).toContain("is-new");
  });
});

describe("fromDeepgramResult", () => {
  it("labels the longest-talking speaker as lecturer", () => {
    const result = {
      results: {
        channels: [
          {
            alternatives: [
              {
                words: [
                  { word: "hi", punctuated_word: "Hi.", start: 0, end: 5, speaker: 1 },
                  { word: "ok", punctuated_word: "ok?", start: 6, end: 6.5, speaker: 0 },
                ],
              },
            ],
          },
        ],
      },
    };
    const segments = fromDeepgramResult(result);
    expect(segments[0].speaker).toBe("lecturer"); // speaker 1 talked 5s vs 0.5s
    expect(segments[1].speaker).toBe("student");
  });

  it("returns [] when there are no words", () => {
    expect(fromDeepgramResult({})).toEqual([]);
  });
});
