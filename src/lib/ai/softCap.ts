import type { SupabaseClient } from "@supabase/supabase-js";

export class AiSoftCapError extends Error {
  constructor(public readonly used: number, public readonly cap: number) {
    super(`AI soft cap reached (${used}/${cap})`);
    this.name = "AiSoftCapError";
  }
}

function resolveCap(): number {
  const raw = process.env.AI_USER_DAILY_SOFT_CAP;
  const parsed = raw ? Number.parseInt(raw, 10) : 30;
  if (!Number.isFinite(parsed) || parsed <= 0) return 30;
  return parsed;
}

/**
 * Counts how many `ai_events` rows the current user has inserted since
 * midnight UTC. Throws `AiSoftCapError` once the daily cap is reached.
 * Callers should catch and return HTTP 429.
 */
export async function checkDailySoftCap(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const cap = resolveCap();
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from("ai_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", startOfDay.toISOString());

  if (error) {
    // Fail open — observability, not a hard dependency.
    console.warn("[ai/softCap] check failed, continuing", error);
    return;
  }

  const used = count ?? 0;
  if (used >= cap) {
    throw new AiSoftCapError(used, cap);
  }
}
