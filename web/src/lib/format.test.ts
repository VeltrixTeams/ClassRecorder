import { describe, it, expect } from "vitest";
import { formatMs, formatSec, formatTimer } from "./format";

describe("formatSec", () => {
  it("formats under a minute", () => expect(formatSec(45)).toBe("0:45"));
  it("formats minutes", () => expect(formatSec(724)).toBe("12:04"));
  it("formats over an hour", () => expect(formatSec(5050)).toBe("1:24:10"));
  it("clamps negative", () => expect(formatSec(-5)).toBe("0:00"));
});

describe("formatMs", () => {
  it("converts ms to seconds first", () => expect(formatMs(724000)).toBe("12:04"));
});

describe("formatTimer", () => {
  it("always shows h:mm:ss", () => expect(formatTimer(4368)).toBe("01:12:48"));
  it("pads zero hour", () => expect(formatTimer(65)).toBe("00:01:05"));
});
