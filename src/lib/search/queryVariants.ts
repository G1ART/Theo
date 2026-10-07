/**
 * Search query variants for cross-language (e.g. Korean ↔ Roman).
 * When the query contains Hangul, we also search with romanized form
 * so that e.g. "김홍도" finds "Kim Hong-do" and "클림트" helps find "Klimt".
 * Latin names also gain a Hangul spelling ("Hyunmin Kim" → 김현민) so the
 * existing people RPC can match a profile that never stored English.
 */

import { reconstructedHangulName, romanizedSearchForms } from "@/lib/search/romanize";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const hangeul = require("hangeul");

const HANGUL_REGEX = /[\uAC00-\uD7AF\u1100-\u11FF]/;

/** True if the string contains at least one Hangul character. */
export function hasHangul(str: string): boolean {
  return HANGUL_REGEX.test(str);
}

/** Romanize Korean text (e.g. for cross-language search). Uses name-oriented romanization. */
export function romanizeKorean(text: string): string {
  if (!text || typeof text !== "string") return "";
  try {
    return (hangeul.enname as (s: string) => string)(text.trim());
  } catch {
    return "";
  }
}

/**
 * Returns query variants for search: [original, ...romanized if has Hangul].
 * Deduped and without empty strings.
 */
export function getSearchQueryVariants(q: string): string[] {
  const normalized = q.trim();
  if (!normalized) return [];
  const variants = new Set<string>([normalized]);
  if (hasHangul(normalized)) {
    const roman = romanizeKorean(normalized);
    if (roman && roman !== normalized) {
      variants.add(roman);
      variants.add(roman.replace(/\s+/g, " ").trim());
    }
    for (const form of romanizedSearchForms(normalized).slice(0, 2)) variants.add(form);
  } else {
    const hangul = reconstructedHangulName(normalized);
    if (hangul) variants.add(hangul);
  }
  return Array.from(variants).filter(Boolean).slice(0, 4);
}
