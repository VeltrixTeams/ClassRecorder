import { describe, expect, it, vi } from "vitest";

// gateway.chat/_embed log to ai_usage via db.sql() after each call; stub the
// tagged-template query so these retry tests don't need a live database.
vi.mock("../db", () => ({
  sql: () => (_strings: readonly string[], ..._values: unknown[]) => Promise.resolve(),
}));

const gateway = await import("./gateway");
type HttpClient = import("./gateway").HttpClient;

class FakeClient implements HttpClient {
  calls = 0;
  private responses: (Response | Error)[];
  constructor(responses: (Response | Error)[]) {
    this.responses = [...responses];
  }
  async request(_method: string, _url: string): Promise<Response> {
    this.calls += 1;
    const item = this.responses.shift();
    if (item instanceof Error) throw item;
    return item as Response;
  }
}

function makeResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("gateway.chat retry", () => {
  it("retries on 429 then succeeds", async () => {
    const sleeps: number[] = [];
    const fakeSleep = async (s: number) => {
      sleeps.push(s);
    };
    const client = new FakeClient([
      makeResponse(429, {}),
      makeResponse(200, { choices: [{ message: { content: "ok" } }], usage: { cost: 0.01 } }),
    ]);

    const data = await gateway.chat([{ role: "user", content: "hi" }], { sleep: fakeSleep, client });

    expect(data.choices[0].message.content).toBe("ok");
    expect(client.calls).toBe(2);
    expect(sleeps).toEqual([2.0]);
  });

  it("gives up after exhausting backoffs", async () => {
    const sleeps: number[] = [];
    const fakeSleep = async (s: number) => {
      sleeps.push(s);
    };
    const client = new FakeClient([
      makeResponse(500, {}),
      makeResponse(500, {}),
      makeResponse(500, {}),
      makeResponse(500, {}),
    ]);

    await expect(
      gateway.chat([{ role: "user", content: "hi" }], { sleep: fakeSleep, client }),
    ).rejects.toBeInstanceOf(gateway.HttpStatusError);
    expect(sleeps).toEqual([2.0, 8.0, 30.0]);
  });
});
