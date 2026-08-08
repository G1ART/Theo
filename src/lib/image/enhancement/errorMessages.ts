/**
 * Theo Image Enhance (Beta) — canonical mapping from
 * `EnhancementErrorReason` to i18n keys (2026-08-07).
 *
 * The `bulk` upload row surface previously rendered the raw enum
 * (`provider_rate_limited`, `unsupported_format`, …) as its `.failed`
 * tooltip. This module maps every reason to the same
 * `upload.imageEnhance.error.*` i18n family already used by the single
 * upload path so operator-facing copy is consistent across surfaces
 * AND localized (EN / KO both filled).
 *
 * Adding a new `EnhancementErrorReason`? Add it here AND in the two
 * `messages.ts` locales — the `Record<...>` type below forces this.
 */

import type { EnhancementErrorReason } from "./types";

const REASON_TO_KEY: Record<EnhancementErrorReason, string> = {
  provider_unauthorized: "upload.imageEnhance.error.provider_unauthorized",
  provider_rate_limited: "upload.imageEnhance.error.provider_rate_limited",
  provider_timeout: "upload.imageEnhance.error.provider_timeout",
  unsupported_format: "upload.imageEnhance.error.unsupported_format",
  invalid_input: "upload.imageEnhance.error.invalid_input",
  not_authorized: "upload.imageEnhance.error.not_authorized",
  storage_error: "upload.imageEnhance.error.storage_error",
  error: "upload.imageEnhance.error.error",
};

/**
 * Return the i18n key for a given error reason. Unknown / free-form
 * strings fall back to the generic `error` copy so we never leak an
 * internal enum into UI.
 */
export function enhancementErrorMessageKey(reason: string): string {
  if (reason in REASON_TO_KEY) {
    return REASON_TO_KEY[reason as EnhancementErrorReason];
  }
  return REASON_TO_KEY.error;
}
