import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Created lazily so `next build` can prerender pages without NEXT_PUBLIC_* env vars
// present (e.g. a clean checkout with no .env.local yet). Real env vars are required
// at runtime in the browser, not at build time.
let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co";
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder-anon-key";
    client = createClient(url, anonKey);
  }
  return client;
}

// Proxy so existing call sites (`supabase.auth...`) keep working unchanged while the
// underlying client is only constructed on first actual use.
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver);
  },
});

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
