/**
 * Centralized column selectors for Supabase queries.
 * Ensures profile_completeness and profile_details are always included for /my and /settings.
 */

export const PROFILE_ME_SELECT =
  // QA 2026-07-28 bilingual — additive display_name_ko/en, bio_ko/en,
  // artist_statement_ko/en. The DB `240004` trigger keeps legacy
  // columns in sync so old callers (search, SEO) keep rendering; new
  // callers should route through `pickLocalizedDisplayName` /
  // `pickLocalizedBio` / `pickLocalizedStatement` from
  // `@/lib/i18n/pickLocalized`.
  "id, username, display_name, display_name_ko, display_name_en, avatar_url, bio, bio_ko, bio_en, location, website, main_role, roles, is_public, profile_details, profile_completeness, profile_updated_at, education, career_stage, age_band, city, region, country, themes, mediums, styles, keywords, price_band, acquisition_channels, affiliation, program_focus, residencies, exhibitions, awards, cover_image_url, cover_image_position_y, artist_statement, artist_statement_ko, artist_statement_en, artist_statement_hero_image_url, artist_statement_updated_at, cv_pdf_path";
