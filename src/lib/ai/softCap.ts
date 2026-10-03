import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiFeatureKey } from "./types";

export class AiSoftCapError extends Error {
  constructor(public readonly used: number, public readonly cap: number) {
    super(`AI soft cap reached (${used}/${cap})`);
    this.name = "AiSoftCapError";
  }
}

/**
 * Automatic per-photo vision. Opening the enhancer fires this with the
 * quality gate, so 15 photos burn the whole draft budget and every
 * later rectangle detect returns `cap` before gpt-5.6-sol runs. The
 * editor then shows the "place the corners yourself" banner.
 * These calls do not count toward, and are not blocked by, the draft cap.
 */
export const SOFT_CAP_EXEMPT_FEATURES: ReadonlySet<AiFeatureKey> = new Set([
  "artwork_painting_bbox",
]);

export function isSoftCapExempt(feature: AiFeatureKey): boolean {
  return SOFT_CAP_EXEMPT_FEATURES.has(feature);
}

function resolveCap(): number {
  const raw = process.env.AI_USER_DAILY_SOFT_CAP;
  const parsed = raw ? Number.parseInt(raw, 10) : 30;
  if (!Number.isFinite(parsed) || parsed <= 0) return 30;
  return parsed;
}

/**
 * Counts how many `ai_events` rows the current user has inserted since
 * midnight UTC, excluding automatic upload-vision features. Throws
 * `AiSoftCapError` once the daily cap is reached. Callers should catch
 * and return HTTP 429. An exempt feature returns immediately so a full
 * draft budget cannot block rectangle detection.
 */
export async function checkDailySoftCap(
  supabase: SupabaseClient,
  userId: string,
  feature: AiFeatureKey,
): Promise<void> {
  if (isSoftCapExempt(feature)) return;

  const cap = resolveCap();
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  let query = supabase
    .from("ai_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", startOfDay.toISOString());
  for (const exempt of SOFT_CAP_EXEMPT_FEATURES) {
    query = query.neq("feature_key", exempt);
  }
  const { count, error } = await query;

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
