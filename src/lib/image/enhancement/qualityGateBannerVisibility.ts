import type { ArtworkQualityGateResult } from "@/lib/ai/types";

/**
 * Whether the large pre-flight quality banner should occupy editor
 * space. "계속 진행" (warn) and "그래도 계속" (block) both accept the
 * warning — after that the crop / enhance UI stays the focus.
 *
 * Dismissal / override persist for the current editor session; a new
 * `file` resets them in ImageStandardizeEditor.
 */
export function shouldShowQualityGateBanner(args: {
  pathChoice: "original" | "ai" | null;
  result: ArtworkQualityGateResult | null;
  dismissed: boolean;
  override: boolean;
}): boolean {
  if (args.pathChoice !== "ai") return false;
  const { result } = args;
  if (!result || result.degraded) return false;
  if (result.severity !== "warn" && result.severity !== "block") return false;
  if (args.dismissed || args.override) return false;
  return true;
}
