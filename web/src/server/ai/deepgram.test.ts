import { describe, expect, it } from "vitest";
import { hmac, verifyHmac } from "./deepgram";

describe("deepgram hmac", () => {
  it("verifies a token produced by hmac() for the same lecture id", () => {
    const token = hmac("lecture-1");
    expect(verifyHmac("lecture-1", token)).toBe(true);
  });

  it("rejects a token for a different lecture id", () => {
    const token = hmac("lecture-1");
    expect(verifyHmac("lecture-2", token)).toBe(false);
  });

  it("rejects a tampered token", () => {
    const token = hmac("lecture-1");
    const tampered = token.slice(0, -2) + (token.slice(-2) === "00" ? "11" : "00");
    expect(verifyHmac("lecture-1", tampered)).toBe(false);
  });

  it("rejects non-hex garbage without throwing", () => {
    expect(verifyHmac("lecture-1", "not-hex-!!")).toBe(false);
  });

  it("is deterministic for the same lecture id", () => {
    expect(hmac("lecture-1")).toBe(hmac("lecture-1"));
  });
});
