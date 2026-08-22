import type { ArtworkQualityGateResult } from "@/lib/ai/types";

export type QualityGateAck = {
  dismissed: boolean;
  override: boolean;
};

const sessionAck = new Map<string, QualityGateAck>();

/** Stable across parent re-renders that replace the `File` object. */
export function fileIdentityKey(file: File): string {
  return `${file.name}\0${file.size}\0${file.lastModified}`;
}

export function getQualityGateAck(file: File): QualityGateAck {
  return (
    sessionAck.get(fileIdentityKey(file)) ?? {
      dismissed: false,
      override: false,
    }
  );
}

export function rememberQualityGateAck(
  file: File,
  next: Partial<QualityGateAck>,
): QualityGateAck {
  const key = fileIdentityKey(file);
  const prev = sessionAck.get(key) ?? { dismissed: false, override: false };
  const merged = { ...prev, ...next };
  sessionAck.set(key, merged);
  return merged;
}

/**
 * Whether the large pre-flight quality banner should occupy editor
 * space. "계속 진행" (warn) and "그래도 계속" (block) both accept the
 * warning — after that the crop / enhance UI stays the focus.
 *
 * Dismissal / override persist for the current editor session keyed by
 * file identity (name+size+lastModified), not object reference.
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
