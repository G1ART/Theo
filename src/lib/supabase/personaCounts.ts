import { supabase } from "./client";
import { ROLE_OPTIONS } from "./artists";

export type PersonaCounts = Record<(typeof ROLE_OPTIONS)[number], number>;

const EMPTY_COUNTS: PersonaCounts = {
  artist: 0,
  curator: 0,
  gallerist: 0,
  collector: 0,
};

/**
 * Persona-slot counts for the People page live counter.
 *
 * Multi-persona members are counted once per role (artist + collector + …).
 * Server-side `count_personas()` applies the `main_role` fallback when a
 * profile's `roles` array is empty, and runs security-definer so anonymous /
 * authenticated callers get aggregate numbers without any PII.
 */
export async function getPersonaCounts(): Promise<{
  data: PersonaCounts;
  error: unknown;
}> {
  const { data, error } = await supabase.rpc("count_personas");
  if (error) return { data: { ...EMPTY_COUNTS }, error };
  const counts: PersonaCounts = { ...EMPTY_COUNTS };
  for (const row of (data ?? []) as { persona: string; cnt: number }[]) {
    if (row.persona in counts) {
      counts[row.persona as keyof PersonaCounts] = Number(row.cnt) || 0;
    }
  }
  return { data: counts, error: null };
}
