import { describe, expect, it } from "vitest";
import { POST } from "./route";

describe("POST /api/webhooks/deepgram", () => {
  it("rejects a request with an invalid HMAC token before touching the database", async () => {
    const req = new Request("http://localhost/api/webhooks/deepgram?lecture=abc&token=deadbeef", {
      method: "POST",
      body: JSON.stringify({ results: {} }),
    });
    const resp = await POST(req);
    expect(resp.status).toBe(401);
    const body = await resp.json();
    expect(body.error.code).toBe("unauthorized");
  });

  it("rejects a request missing lecture/token params", async () => {
    const req = new Request("http://localhost/api/webhooks/deepgram", { method: "POST", body: "{}" });
    const resp = await POST(req);
    expect(resp.status).toBe(400);
  });
});
