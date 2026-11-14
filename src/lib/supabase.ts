import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Two clients, different powers.
 *
 * The browser uses the public anon key. Row-level security lets it READ a
 * group, its members and its charges — that is what an invitation QR is for —
 * and nothing else: no writes, no secrets, no webhook payloads.
 *
 * The server uses the service role key, which bypasses row-level security.
 * Every write goes through it, after groups.ts has checked who is asking.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function supabaseConfigured(): boolean {
  return Boolean(url && anonKey);
}

let browser: SupabaseClient | null = null;

/** Read-only, for the browser. Subscribes to live changes. */
export function browserClient(): SupabaseClient {
  if (!url || !anonKey) throw new Error("Supabase is not configured");
  if (!browser) {
    browser = createClient(url, anonKey, {
      auth: { persistSession: false },
      realtime: { params: { eventsPerSecond: 10 } },
    });
  }
  return browser;
}

let server: SupabaseClient | null = null;

/**
 * The server's client. Holds the service role key, so it must never run in a
 * browser — the guard below fails loudly rather than leaking it.
 */
export function serverClient(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error("serverClient() must never run in the browser");
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Supabase server access is not configured");
  if (!server) {
    server = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return server;
}
