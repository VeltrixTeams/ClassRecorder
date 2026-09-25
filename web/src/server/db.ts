import "server-only";
import postgres from "postgres";
import { config } from "./config";

let _sql: postgres.Sql | null = null;

/** postgres.js singleton against the Supabase pooler (transaction mode ->
 * prepare:false). Service role: every query must filter user_id explicitly. */
export function sql(): postgres.Sql {
  if (_sql === null) {
    _sql = postgres(config.databaseUrl, { prepare: false });
  }
  return _sql;
}
