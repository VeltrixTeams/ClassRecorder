import { describe, expect, it, vi } from "vitest";

// advance() reads/writes through db.sql(); stub it so this test never needs
// a live database. after() from next/server just needs to not throw outside
// a request context.
vi.mock("next/server", () => ({ after: (fn: () => unknown) => fn() }));

describe("advance lock behavior", () => {
  it("is a no-op when the lecture's lock is already held (not expired)", async () => {
    const queries: string[] = [];
    vi.doMock("../db", () => ({
      sql: () => {
        const fn = (strings: readonly string[]) => {
          queries.push(strings.join("?"));
          // Simulate the `returning *` claim finding no row (lock held elsewhere).
          return Promise.resolve([]);
        };
        return fn as unknown as ReturnType<typeof import("../db").sql>;
      },
    }));

    const { advance } = await import("./advance");
    const result = await advance("lecture-locked");
    expect(result.ran).toBe("locked");
    // Only the lock-claim query ran; no output-lookup queries followed.
    expect(queries).toHaveLength(1);
  });
});
