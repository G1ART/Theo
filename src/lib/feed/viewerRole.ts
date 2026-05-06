"use client";

/**
 * Cheap, cached `main_role` fetch for the Personalized Salon Mixer.
 *
 * The mixer wants the viewer's persona (`artist` / `curator` / `gallerist`
 * / `collector`) to apply a *very mild* role-affinity nudge. Pulling the
 * full `getMyProfile()` payload here would download ~30 columns just for
 * a single string, so we go through the lightest possible RPC slice.
 *
 * Caching strategy:
 *   - Module-level promise cache keyed by `userId`. The very first feed
 *     load awaits the fetch; subsequent loads in the same tab return the
 *     resolved value instantly.
 *   - 10-minute TTL so role changes (e.g. a curator updates their main_role
 *     in /settings) propagate without forcing a hard refresh.
 *   - Failures are silently swallowed and treated as "role unknown" —
 *     the mixer already degrades gracefully when the role is null.
 *
 * SSR-safe: returns `null` if the supabase client cannot reach a session.
 */
import { supabase } from "@/lib/supabase/client";

const TTL_MS = 10 * 60 * 1000;

type CacheEntry = {
  userId: string;
  role: string | null;
  fetchedAt: number;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<string | null>>();

export async function getViewerRoleCached(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const now = Date.now();
  const cached = cache.get(userId);
  if (cached && now - cached.fetchedAt < TTL_MS) return cached.role;

  const existing = inflight.get(userId);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("main_role")
        .eq("id", userId)
        .single();
      const role =
        !error && data && typeof (data as { main_role?: unknown }).main_role === "string"
          ? ((data as { main_role: string }).main_role || null)
          : null;
      cache.set(userId, { userId, role, fetchedAt: Date.now() });
      return role;
    } catch {
      cache.set(userId, { userId, role: null, fetchedAt: Date.now() });
      return null;
    } finally {
      inflight.delete(userId);
    }
  })();

  inflight.set(userId, promise);
  return promise;
}

/** Test / dev convenience — drop the cache. */
export function _resetViewerRoleCache(): void {
  cache.clear();
  inflight.clear();
}
