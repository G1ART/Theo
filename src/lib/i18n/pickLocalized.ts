/**
 * KO/EN bilingual display helpers.
 *
 * History
 * -------
 * QA 2026-07 Phase 4 (스코프 B) — first introduced `pickLocalizedTitle`
 * and `pickLocalizedDisplayName` for `projects.title` and
 * `external_artists.display_name` (`20260727200000_bilingual_titles.sql`).
 * QA 2026-07-28 — expanded to cover the remaining monolingual fields
 * that got KO/EN slots via the 240000-240004 migration set:
 *   * profiles.display_name / bio / artist_statement
 *   * artworks.title / medium / story
 *   * projects.host_name
 *
 * Resolution order (per current UI locale)
 * ----------------------------------------
 *   1) exact locale field (e.g. bio_ko for KO UI)
 *   2) the OTHER language field (fallback so an author who only filled
 *      one language never renders as an empty string)
 *   3) legacy field (`bio` / `display_name` / etc.) — kept in sync by
 *      the 240004 trigger set on write of any *_ko / *_en column, so it
 *      is a safe fallback for old rows.
 *   4) empty string (never null, so JSX renders cleanly).
 *
 * Author owns the name — display-time picking NEVER transliterates.
 * Romanization only lives in `src/lib/search/queryVariants.ts` (search
 * fallback), and in the `RomanizationHintChip` on the settings/onboarding
 * *authoring* surface as an editable *seed*, never authoritative.
 *
 * The helpers accept partial row shapes so callers can pass query
 * results without narrowing types.
 */

import type { Locale } from "./locale";

// ─────────────────────────────────────────────────────────────────────
// Row shapes (partials so DB rows can be passed without narrowing).
// ─────────────────────────────────────────────────────────────────────

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

type PrefaceRow = {
  preface_ko?: string | null;
  preface_en?: string | null;
};

type BioRow = {
  bio?: string | null;
  bio_ko?: string | null;
  bio_en?: string | null;
};

type StatementRow = {
  artist_statement?: string | null;
  artist_statement_ko?: string | null;
  artist_statement_en?: string | null;
};

type MediumRow = {
  medium?: string | null;
  medium_ko?: string | null;
  medium_en?: string | null;
};

type StoryRow = {
  story?: string | null;
  story_ko?: string | null;
  story_en?: string | null;
};

type HostNameRow = {
  host_name?: string | null;
  host_name_ko?: string | null;
  host_name_en?: string | null;
};

function firstNonEmpty(...vals: Array<string | null | undefined>): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return "";
}

// ─────────────────────────────────────────────────────────────────────
// Named pickers (preferred — greppable + narrow types).
// ─────────────────────────────────────────────────────────────────────

export function pickLocalizedTitle(row: TitleRow, locale: Locale): string {
  if (locale === "ko") {
    return firstNonEmpty(row.title_ko, row.title_en, row.title);
  }
  return firstNonEmpty(row.title_en, row.title_ko, row.title);
}

/** Named alias for the artwork title case — same semantics as
 *  `pickLocalizedTitle`, kept as a distinct export so grepping for
 *  "artwork title" retrofits is unambiguous. */
export function pickLocalizedArtworkTitle(
  row: TitleRow,
  locale: Locale,
): string {
  return pickLocalizedTitle(row, locale);
}

export function pickLocalizedDisplayName(
  row: DisplayNameRow,
  locale: Locale,
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

export function pickLocalizedBio(row: BioRow, locale: Locale): string {
  if (locale === "ko") {
    return firstNonEmpty(row.bio_ko, row.bio_en, row.bio);
  }
  return firstNonEmpty(row.bio_en, row.bio_ko, row.bio);
}

export function pickLocalizedStatement(
  row: StatementRow,
  locale: Locale,
): string {
  if (locale === "ko") {
    return firstNonEmpty(
      row.artist_statement_ko,
      row.artist_statement_en,
      row.artist_statement,
    );
  }
  return firstNonEmpty(
    row.artist_statement_en,
    row.artist_statement_ko,
    row.artist_statement,
  );
}

export function pickLocalizedMedium(row: MediumRow, locale: Locale): string {
  if (locale === "ko") {
    return firstNonEmpty(row.medium_ko, row.medium_en, row.medium);
  }
  return firstNonEmpty(row.medium_en, row.medium_ko, row.medium);
}

export function pickLocalizedStory(row: StoryRow, locale: Locale): string {
  if (locale === "ko") {
    return firstNonEmpty(row.story_ko, row.story_en, row.story);
  }
  return firstNonEmpty(row.story_en, row.story_ko, row.story);
}

export function pickLocalizedHostName(
  row: HostNameRow,
  locale: Locale,
): string {
  if (locale === "ko") {
    return firstNonEmpty(row.host_name_ko, row.host_name_en, row.host_name);
  }
  return firstNonEmpty(row.host_name_en, row.host_name_ko, row.host_name);
}

// ─────────────────────────────────────────────────────────────────────
// Save-side legacy helpers.
//
// The DB-level 240004 trigger set now owns the primary legacy sync path
// (writing *_ko / *_en syncs the legacy column server-side, KO wins). The
// helpers below stay exported for callers that construct the payload
// client-side and still want the legacy field pre-populated — e.g. the
// existing `createExhibition` invocation in `NewExhibitionFormShell`,
// which sends `title: legacyTitle` alongside the bilingual columns so
// that a NOT-NULL constraint on `title` is never hit. Callers that only
// send *_ko / *_en can rely on the trigger and skip these entirely.
// ─────────────────────────────────────────────────────────────────────

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

/** Generic "KO wins" legacy resolver — matches the trigger semantics.
 *  Prefer the named helpers above for grep-ability; use this only when
 *  you're wiring a save path for a field that doesn't have its own
 *  named helper (e.g. one-off admin scripts). */
export function pickLegacyForSave(
  ko: string | null | undefined,
  en: string | null | undefined,
): string | null {
  const k = ko?.trim() ?? "";
  const e = en?.trim() ?? "";
  if (k) return k;
  if (e) return e;
  return null;
}
