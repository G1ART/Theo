import { createClient } from "@supabase/supabase-js";
import { blockedBrowserWrite } from "./browserWriteGuard";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

function createGuardedFetch(impl: typeof fetch): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const reqUrl = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
    const method = (init?.method ?? (input instanceof Request ? input.method : undefined)) ?? "GET";
    const blocked = blockedBrowserWrite(reqUrl, method);

    if (blocked === "profiles") {
      const err = new Error(
        `[SSOT] Blocked: profiles write via PostgREST (${method} /rest/v1/profiles). Use rpc("upsert_my_profile") only.`
      );
      console.error("[SSOT] profiles write blocked", { url: reqUrl, method, stack: err.stack });
      throw err;
    }
    if (blocked === "entitlements") {
      const err = new Error(
        `[SSOT] Blocked: entitlements write via PostgREST (${method}). Plan changes are service role and the signed Stripe webhook only.`
      );
      console.error("[SSOT] entitlements write blocked", { url: reqUrl, method, stack: err.stack });
      throw err;
    }
    // Disable cache for data freshness (feed, artworks, etc.)
    const opts: RequestInit = { ...init, cache: "no-store" as RequestCache };
    return impl(input, opts);
  };
}

export const supabase = createClient(url, anonKey, {
  global: { fetch: createGuardedFetch(fetch) },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // Safari + several withtheo.art tabs can hang forever on
    // Navigator LockManager (`getSession` never resolves → AuthGate
    // paints a blank white page). In-tab races on token refresh are
    // rarer than a stuck upload refresh; skip the exclusive lock.
    lock: async (_name, _acquireTimeout, fn) => fn(),
  },
});
