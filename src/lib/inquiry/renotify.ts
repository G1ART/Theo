/**
 * "Notify again" on a price inquiry: the server allows it once per 24
 * hours per inquiry and at most 3 times
 * (20261017225332_price_inquiry_renotify_limit.sql). The screen only shows
 * the state it returns.
 */
import type { Locale } from "@/lib/i18n/locale";

export type RenotifyReason = "ok" | "too_soon" | "limit" | "replied";

export type RenotifyState = {
  used: number;
  limit: number;
  remaining: number;
  /** Set only when the next re-notify is waiting on the 24 hours. */
  nextAt: string | null;
  can: boolean;
  reason: RenotifyReason;
};

const REASONS: readonly RenotifyReason[] = ["ok", "too_soon", "limit", "replied"];

function count(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function readRenotifyState(value: unknown): RenotifyState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (!REASONS.includes(v.reason as RenotifyReason)) return null;
  return {
    used: count(v.used, 0),
    limit: count(v.limit, 3),
    remaining: count(v.remaining, 0),
    nextAt: typeof v.next_at === "string" ? v.next_at : null,
    can: v.can === true,
    reason: v.reason as RenotifyReason,
  };
}

export function formatRenotifyTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** The line under the button; empty when the artist already replied. */
export function renotifyHint(
  state: RenotifyState | null,
  t: (key: string) => string,
  locale: Locale,
): string {
  if (!state || state.reason === "replied") return "";
  if (state.reason === "limit") {
    return t("priceInquiry.renotifyUsedUp").replace("{limit}", String(state.limit));
  }
  if (state.reason === "too_soon" && state.nextAt) {
    return t("priceInquiry.renotifyNextAt")
      .replace("{time}", formatRenotifyTime(state.nextAt, locale))
      .replace("{n}", String(state.remaining));
  }
  return t("priceInquiry.renotifyLeft")
    .replace("{n}", String(state.remaining))
    .replace("{limit}", String(state.limit));
}
