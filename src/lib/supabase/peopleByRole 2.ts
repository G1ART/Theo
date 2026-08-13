/**
 * People-by-role discovery — thin wrapper around `get_people_by_role`.
 *
 * The RPC (see `supabase/migrations/20260812000000_people_by_role.sql`)
 * returns rows in the same JSONB shape as `get_people_recs`, so callers
 * reuse `PeopleRec` and the shared `SuggestionCard`.
 *
 * Used by:
 *   • `RoleDiscoveryPanel` on `/my/network` overview (4 role cards,
 *     limit 6 each, no offset).
 *   • URL-driven discovery surface `/my/network?tab=discover&role=…`
 *     (limit 24, offset paged in +24 increments).
 */

import { supabase } from "./client";
import type { PeopleRec } from "./peopleRecs";

export const ROLE_DISCOVERY_ORDER = [
  "artist",
  "collector",
  "curator",
  "gallerist",
] as const;

export type RoleDiscoveryKey = (typeof ROLE_DISCOVERY_ORDER)[number];

export function isRoleDiscoveryKey(v: unknown): v is RoleDiscoveryKey {
  return (
    typeof v === "string" &&
    (ROLE_DISCOVERY_ORDER as readonly string[]).includes(v)
  );
}

export type GetPeopleByRoleOptions = {
  role: RoleDiscoveryKey;
  limit?: number;
  offset?: number;
};

export async function getPeopleByRole(
  options: GetPeopleByRoleOptions,
): Promise<{ data: PeopleRec[]; error: unknown }> {
  const { role, limit = 6, offset = 0 } = options;
  const { data, error } = await supabase.rpc("get_people_by_role", {
    p_target_role: role,
    p_limit: Math.min(Math.max(limit, 1), 60),
    p_offset: Math.max(offset, 0),
  });
  if (error) return { data: [], error };
  return { data: (data ?? []) as PeopleRec[], error: null };
}
