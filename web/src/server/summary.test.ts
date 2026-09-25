import { describe, expect, it } from "vitest";
import {
  dropPastDuration,
  mergeContents,
  summarize,
  summaryContentSchema,
  type CallLlmOpts,
  type SummaryContent,
} from "./summary";
import type { ChatMessage } from "./ai/gateway";

function makeSegments() {
  return [
    { start_ms: 0, end_ms: 5000, speaker: "lecturer", text: "Intro to calculus." },
    { start_ms: 5000, end_ms: 10000, speaker: "lecturer", text: "Derivatives explained." },
  ];
}

function fullContentDict(overrides: Record<string, unknown> = {}) {
  return {
    overview: "intro overview",
    topics: [
      {
        title: "Calculus",
        points: [
          { text: "intro", t: 0 },
          { text: "derivative", t: 5 },
          { text: "out of range", t: 999 },
        ],
      },
    ],
    definitions: [{ term: "derivative", meaning: "rate of change", t: 5 }],
    examples: [{ text: "an example", t: 3 }],
    emphasized: [{ text: "will be on the exam", t: 999 }],
    assignments: [{ task: "read chapter 1", due: "2024-01-01", t: 0 }],
    ...overrides,
  };
}

function fakeChat(content: string): NonNullable<CallLlmOpts["chat"]> {
  return (async (_messages: ChatMessage[], _opts?: unknown) => ({
    choices: [{ message: { content } }],
  })) as NonNullable<CallLlmOpts["chat"]>;
}

describe("summarize", () => {
  it("drops items past the lecture duration", async () => {
    const result = await summarize(makeSegments(), 10_000, {
      chat: fakeChat(JSON.stringify(fullContentDict())),
    });
    expect(result.topics.flatMap((t) => t.points).map((p) => p.t)).toEqual([0, 5]);
    expect(result.emphasized).toEqual([]);
    expect(result.definitions.map((d) => d.t)).toEqual([5]);
    expect(result.assignments.map((a) => a.t)).toEqual([0]);
  });

  it("retries once on invalid JSON then succeeds", async () => {
    let calls = 0;
    const chat: NonNullable<CallLlmOpts["chat"]> = (async () => {
      calls += 1;
      if (calls === 1) return { choices: [{ message: { content: "not json" } }] };
      return { choices: [{ message: { content: JSON.stringify(fullContentDict()) } }] };
    }) as NonNullable<CallLlmOpts["chat"]>;

    const result = await summarize(makeSegments(), 10_000, { chat });
    expect(calls).toBe(2);
    expect(result.overview).toBe("intro overview");
  });

  it("throws after two failed attempts", async () => {
    const chat = fakeChat("still not json");
    await expect(summarize(makeSegments(), 10_000, { chat })).rejects.toThrow();
  });

  it("map-reduces a very long transcript into >1 window", async () => {
    const longSegments = Array.from({ length: 3000 }, (_, i) => ({
      start_ms: i * 1000,
      end_ms: i * 1000 + 900,
      speaker: "lecturer",
      text: "word ".repeat(50),
    }));
    let calls = 0;
    const chat: NonNullable<CallLlmOpts["chat"]> = (async () => {
      calls += 1;
      const content = fullContentDict({
        overview: `window ${calls}`,
        topics: [],
        definitions: [],
        examples: [],
        emphasized: [],
        assignments: [],
      });
      return { choices: [{ message: { content: JSON.stringify(content) } }] };
    }) as NonNullable<CallLlmOpts["chat"]>;

    const result = await summarize(longSegments, 3_000_000, { chat });
    expect(calls).toBeGreaterThan(1);
    expect(result.overview.split("window").length - 1).toBe(calls);
  });
});

describe("dropPastDuration", () => {
  it("drops topics left with no points after filtering", () => {
    const content: SummaryContent = summaryContentSchema.parse({
      overview: "x",
      topics: [{ title: "AllDropped", points: [{ text: "x", t: 999 }] }],
    });
    const filtered = dropPastDuration(content, 10);
    expect(filtered.topics).toEqual([]);
  });
});

describe("mergeContents", () => {
  it("concatenates lists and joins overviews", () => {
    const a = summaryContentSchema.parse({ overview: "a", topics: [{ title: "T1", points: [{ text: "x", t: 1 }] }] });
    const b = summaryContentSchema.parse({ overview: "b", definitions: [{ term: "y", meaning: "z", t: 2 }] });
    const merged = mergeContents([a, b]);
    expect(merged.overview).toBe("a\n\nb");
    expect(merged.topics).toHaveLength(1);
    expect(merged.definitions).toHaveLength(1);
  });
});
