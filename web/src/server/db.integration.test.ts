import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

/** Guards against the jsonb double-encoding bug: writing a jsonb column via
 * `${JSON.stringify(x)}::jsonb` stores the JSON text as a jsonb *string*
 * instead of an object, because postgres.js already sends the parameter as
 * a json-typed value — the cast then wraps it again. The fix is to always
 * use `sql.json(x)` (never JSON.stringify + ::jsonb) for jsonb params.
 *
 * Runs only when DATABASE_URL is set (e.g. against local Supabase via
 * `supabase start`); skipped in CI/sandbox environments without a DB. */
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("jsonb writes use sql.json (no double-encoding)", () => {
  it("stores lecture.progress as a jsonb object, not a string", async () => {
    const { sql } = await import("./db");
    const db = sql();
    const userId = randomUUID();
    const lectureId = randomUUID();

    try {
      // Minimal profile + lecture row via the same jsonb-write path the
      // pipeline uses (sql.json), bypassing auth/RLS with the service role
      // connection the app itself uses.
      await db`insert into auth.users(id, email) values (${userId}, ${userId + "@example.com"}) on conflict do nothing`;
      await db`insert into profiles(user_id) values (${userId}) on conflict do nothing`;
      await db`
        insert into lectures(id, user_id, recorded_at, status, progress)
        values (${lectureId}, ${userId}, now(), 'finalizing', ${db.json({ step: "finalize", done: 0, total: 5 })})
      `;

      const [{ typeof: t, progress }] = await db<{ typeof: string; progress: unknown }[]>`
        select jsonb_typeof(progress) as typeof, progress from lectures where id=${lectureId}
      `;

      expect(t).toBe("object");
      expect(progress).toEqual({ step: "finalize", done: 0, total: 5 });
    } finally {
      await db`delete from lectures where id=${lectureId}`;
      await db`delete from profiles where user_id=${userId}`;
      await db`delete from auth.users where id=${userId}`;
    }
  });
});
