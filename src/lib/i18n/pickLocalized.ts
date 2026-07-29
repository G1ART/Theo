/**
 * QA 2026-07 Phase 4 (스코프 B) — bilingual display helpers.
 *
 * Rows in `projects` and `external_artists` now carry a legacy single
 * field (`title` / `display_name`) plus explicit KO / EN variants added
 * by `20260727200000_bilingual_titles.sql`.
 *
 * Resolution order (per current UI locale):
 *   1) exact locale field (title_ko for KO, title_en for EN)
 *   2) the OTHER language field (so a KO-only user viewing EN UI still
 *      sees SOMETHING, not an empty string)
 *   3) legacy field (`title` / `display_name`) — kept in sync on save
 *      with the first filled language, so this is normally a safe
 *      fallback for old rows.
 *   4) empty string (never null, so JSX renders cleanly).
 *
 * The helpers accept partial row shapes so callers can pass query
 * results without narrowing types.
 */

import type { Locale } from "./locale";

type TitleRow = {
  title?: string | null;
  title_ko?: string | null;
  title_en?: string | null;
};

type DisplayNameRow = {
  display_name?: string | null;
  display_name_ko?: string | null;
  display_name_en?: string | null;
};

/**
 * QA 2026-07-28 — 전시 서문(preface). Bilingual columns only; there is no
 * legacy single field, so the picker just walks {current, other} in order.
 * Returns "" (never null) so JSX renders cleanly and callers can gate on
 * truthiness without extra null-guards.
 */
type PrefaceRow = {
  preface_ko?: string | null;
  preface_en?: string | null;
};

function firstNonEmpty(...vals: Array<string | null | undefined>): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return "";
}

export function pickLocalizedTitle(row: TitleRow, locale: Locale): string {
  if (locale === "ko") {
    return firstNonEmpty(row.title_ko, row.title_en, row.title);
  }
  return firstNonEmpty(row.title_en, row.title_ko, row.title);
}

export function pickLocalizedDisplayName(
  row: DisplayNameRow,
  locale: Locale
): string {
  if (locale === "ko") {
    return firstNonEmpty(row.display_name_ko, row.display_name_en, row.display_name);
  }
  return firstNonEmpty(row.display_name_en, row.display_name_ko, row.display_name);
}

export function pickLocalizedPreface(row: PrefaceRow, locale: Locale): string {
  if (locale === "ko") {
    return firstNonEmpty(row.preface_ko, row.preface_en);
  }
  return firstNonEmpty(row.preface_en, row.preface_ko);
}

/**
 * Save-side helper: the legacy `title` column is kept in sync with
 * whichever language the operator filled first, so callers that have
 * not migrated to the bilingual columns still surface a usable string.
 *
 * Rules:
 * - If both are present, prefer KO (matches the primary market).
 * - If only one is present, use that one.
 * - If neither, return null so we don't wipe a pre-existing legacy value.
 */
export function pickLegacyTitleForSave(input: {
  title_ko: string | null | undefined;
  title_en: string | null | undefined;
}): string | null {
  const ko = input.title_ko?.trim() ?? "";
  const en = input.title_en?.trim() ?? "";
  if (ko) return ko;
  if (en) return en;
  return null;
}

/** Same as `pickLegacyTitleForSave` but for `external_artists.display_name`. */
export function pickLegacyDisplayNameForSave(input: {
  display_name_ko: string | null | undefined;
  display_name_en: string | null | undefined;
}): string | null {
  const ko = input.display_name_ko?.trim() ?? "";
  const en = input.display_name_en?.trim() ?? "";
  if (ko) return ko;
  if (en) return en;
  return null;
}
