import { describe, expect, it } from "vitest";
import { guessCourseId, missingIndices, parseUploadedIndices } from "./lectures";

describe("missingIndices", () => {
  it("reports none missing", () => {
    expect(missingIndices(3, new Set([0, 1, 2]))).toEqual([]);
  });
  it("reports gaps", () => {
    expect(missingIndices(5, new Set([0, 2, 4]))).toEqual([1, 3]);
  });
  it("reports all missing when nothing uploaded", () => {
    expect(missingIndices(2, new Set())).toEqual([0, 1]);
  });
  it("ignores extra indices beyond count", () => {
    expect(missingIndices(2, new Set([0, 1, 99]))).toEqual([]);
  });
});

function obj(name: string, size: number) {
  return { name, metadata: { size } };
}

describe("parseUploadedIndices", () => {
  it("reads size-positive objects", () => {
    const objects = [obj("0000.audio", 1234), obj("0001.audio", 5678), obj("0002.audio", 999)];
    expect(parseUploadedIndices(objects)).toEqual(new Set([0, 1, 2]));
  });
  it("ignores zero-size objects", () => {
    const objects = [obj("0000.audio", 1234), obj("0001.audio", 0)];
    expect(parseUploadedIndices(objects)).toEqual(new Set([0]));
  });
  it("ignores non-numeric names", () => {
    const objects = [obj("0000.audio", 10), obj(".emptyFolderPlaceholder", 0)];
    expect(parseUploadedIndices(objects)).toEqual(new Set([0]));
  });
  it("reports gaps in a realistic partial upload", () => {
    const listing = [0, 1, 3].map((i) => obj(String(i).padStart(4, "0") + ".audio", 100));
    const uploaded = parseUploadedIndices(listing);
    expect(missingIndices(5, uploaded)).toEqual([2, 4]);
  });
});

describe("guessCourseId", () => {
  it("matches a course whose schedule slot covers the recorded time", () => {
    // 2026-09-28 is a Monday (dow=1). 10:00 UTC.
    const recordedAt = new Date("2026-09-28T10:00:00Z");
    const courses = [
      { id: "a", schedule: [{ dow: 1, start: "09:00", end: "10:30" }] },
      { id: "b", schedule: [{ dow: 2, start: "09:00", end: "10:30" }] },
    ];
    expect(guessCourseId(courses, recordedAt, "UTC")).toBe("a");
  });

  it("returns null when no slot matches", () => {
    const recordedAt = new Date("2026-09-28T23:00:00Z"); // Monday 23:00
    const courses = [{ id: "a", schedule: [{ dow: 1, start: "09:00", end: "10:30" }] }];
    expect(guessCourseId(courses, recordedAt, "UTC")).toBeNull();
  });

  it("honors timezone when converting recordedAt to local wall time", () => {
    // 2026-09-28T23:30Z is Tuesday 06:30 in Bangkok (UTC+7) -> dow=2.
    const recordedAt = new Date("2026-09-28T23:30:00Z");
    const courses = [{ id: "a", schedule: [{ dow: 2, start: "06:00", end: "07:00" }] }];
    expect(guessCourseId(courses, recordedAt, "Asia/Bangkok")).toBe("a");
    expect(guessCourseId(courses, recordedAt, "UTC")).toBeNull();
  });
});
