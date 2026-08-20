/**
 * Profile completeness scoring v0 — role-based weights.
 * Core 50 + primary role module 50 so collector/artist/curator are treated fairly.
 */

export type ProfileForCompleteness = {
  username?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  main_role?: string | null;
  roles?: string[] | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  themes?: string[] | null;
  mediums?: string[] | null;
  styles?: string[] | null;
  keywords?: string[] | null;
  education?: unknown[] | null;
  price_band?: string | string[] | null;
  acquisition_channels?: string[] | null;
  affiliation?: string | null;
  program_focus?: string[] | null;
};

export type CompletenessResult = {
  score: number;
  missingRecommendations: string[];
};

export type CompletenessResultWithConfidence = {
  score: number | null;
  confidence: "high" | "low";
  missingRecommendations: string[];
};

const CORE_WEIGHT = 50;
const MODULE_WEIGHT = 50;

function coreScore(p: ProfileForCompleteness): number {
  let n = 0;
  const total = 6;
  if (p.username && String(p.username).trim().length >= 3) n++;
  if (p.display_name && String(p.display_name).trim().length > 0) n++;
  if (p.avatar_url && String(p.avatar_url).trim().length > 0) n++;
  if (p.bio && String(p.bio).trim().length > 0) n++;
  const hasRoles =
    (p.main_role && String(p.main_role).trim().length > 0) ||
    (Array.isArray(p.roles) && p.roles.length > 0);
  if (hasRoles) n++;
  const hasLocation =
    (p.city && String(p.city).trim().length > 0) ||
    (p.region && String(p.region).trim().length > 0) ||
    (p.country && String(p.country).trim().length > 0);
  if (hasLocation) n++;
  return (n / total) * CORE_WEIGHT;
}

function artistModuleScore(p: ProfileForCompleteness): number {
  let n = 0;
  const total = 3;
  const themes = Array.isArray(p.themes) ? p.themes : [];
  if (themes.length >= 3) n++;
  const mediums = Array.isArray(p.mediums) ? p.mediums : [];
  if (mediums.length >= 1) n++;
  const styles = Array.isArray(p.styles) ? p.styles : [];
  if (styles.length >= 1) n++;
  const education = Array.isArray(p.education) ? p.education : [];
  if (education.length >= 1) n++;
  return (Math.min(n, total) / total) * MODULE_WEIGHT;
}

function collectorModuleScore(p: ProfileForCompleteness): number {
  let n = 0;
  const total = 3;
  const themes = Array.isArray(p.themes) ? p.themes : [];
  if (themes.length >= 2) n++;
  const pb = Array.isArray(p.price_band) ? p.price_band : (p.price_band ? [String(p.price_band)] : []);
  if (pb.some((s) => s && String(s).trim().length > 0)) n++;
  const ch = Array.isArray(p.acquisition_channels) ? p.acquisition_channels : [];
  if (ch.length >= 1) n++;
  return (n / total) * MODULE_WEIGHT;
}

function curatorModuleScore(p: ProfileForCompleteness): number {
  let n = 0;
  const total = 2;
  if (p.affiliation && String(p.affiliation).trim().length > 0) n++;
  const pf = Array.isArray(p.program_focus) ? p.program_focus : [];
  if (pf.length >= 2) n++;
  return (n / total) * MODULE_WEIGHT;
}

export function computeCompleteness(
  profile: ProfileForCompleteness
): CompletenessResult {
  const r = computeProfileCompleteness(profile, { hasDetailsLoaded: true });
  return {
    score: r.score ?? 0,
    missingRecommendations: r.missingRecommendations,
  };
}

/**
 * Returns { score, confidence }.
 * Return null (not 0) when required inputs missing. Only return 0 if profile is truly empty.
 * Never use score=null to write to DB - omit profile_completeness instead.
 */
export function computeProfileCompleteness(
  profile: ProfileForCompleteness,
  options?: { hasDetailsLoaded?: boolean }
): CompletenessResultWithConfidence {
  const hasDetailsLoaded = options?.hasDetailsLoaded ?? true;
  const roles = Array.isArray(profile.roles) ? profile.roles : [];
  const main = profile.main_role ?? "";
  const hasArtist = roles.includes("artist") || main === "artist";
  const hasCollector = roles.includes("collector") || main === "collector";
  const hasCurator = roles.includes("curator") || main === "curator";
  const hasGallerist = roles.includes("gallerist") || main === "gallerist";

  const baseLoaded = profile.username != null && String(profile.username).trim().length >= 3;
  if (!baseLoaded) {
    return { score: null, confidence: "low", missingRecommendations: ["base_not_loaded"] };
  }
  const needsDetails = hasArtist || hasCollector || hasCurator || hasGallerist;
  if (needsDetails && !hasDetailsLoaded) {
    return { score: null, confidence: "low", missingRecommendations: ["details_not_loaded"] };
  }

  const core = coreScore(profile);
  let moduleScore = 0;
  const missing: string[] = [];

  if (hasArtist) {
    const s = artistModuleScore(profile);
    if (s > moduleScore) moduleScore = s;
  }
  if (hasCollector) {
    const s = collectorModuleScore(profile);
    if (s > moduleScore) moduleScore = s;
  }
  if (hasCurator || hasGallerist) {
    const s = curatorModuleScore(profile);
    if (s > moduleScore) moduleScore = s;
  }

  const score = Math.min(100, Math.round(core + moduleScore));

  if (core < CORE_WEIGHT) missing.push("core");
  if (hasArtist && artistModuleScore(profile) < MODULE_WEIGHT) missing.push("artist_module");
  if (hasCollector && collectorModuleScore(profile) < MODULE_WEIGHT) missing.push("collector_module");
  if ((hasCurator || hasGallerist) && curatorModuleScore(profile) < MODULE_WEIGHT) missing.push("curator_module");

  return { score, confidence: "high", missingRecommendations: missing };
}

/**
 * Single display source for profile completeness across Studio (/my) and
 * Settings. Prefer the server-persisted `profile_completeness` (written on
 * save) so the hero bar matches the settings card; fall back to a fresh
 * client recompute when the column is still null.
 */
export function resolveDisplayedProfileCompleteness(
  profile: { profile_completeness?: number | null },
  recomputed: number | null | undefined
): number | null {
  const db = profile.profile_completeness;
  if (db != null && Number.isFinite(db)) {
    return Math.max(0, Math.min(100, Math.round(db)));
  }
  if (recomputed != null && Number.isFinite(recomputed)) {
    return Math.max(0, Math.min(100, Math.round(recomputed)));
  }
  return null;
}

/** Completeness at/above this is "good enough" — no global nag banner. */
export const COMPLETION_BANNER_HIDE_AT = 70;

export type ProfileBasicsForBanner = {
  profile_completed_at?: string | null;
  full_name?: string | null;
  display_name?: string | null;
  main_role?: string | null;
  roles?: string[] | null;
  profile_completeness?: number | null;
};

function hasText(v: string | null | undefined): boolean {
  return !!v && v.trim().length > 0;
}

/**
 * Global completion banner should only fire when the *basics the banner
 * asks for* are still empty (name + role). Age is optional. A reasonably
 * complete profile (score >= 70) also suppresses the nag even if the
 * Signup v2 timestamp was never stamped.
 */
export function shouldShowExistingUserCompletionBanner(
  p: ProfileBasicsForBanner | null
): boolean {
  if (!p) return false;
  if (p.profile_completed_at) return false;
  const completeness = p.profile_completeness;
  if (typeof completeness === "number" && completeness >= COMPLETION_BANNER_HIDE_AT) {
    return false;
  }
  const hasName = hasText(p.full_name) || hasText(p.display_name);
  const hasRole =
    hasText(p.main_role) ||
    (Array.isArray(p.roles) && p.roles.some((r) => hasText(r)));
  if (hasName && hasRole) return false;
  return true;
}

export type ProfileGapHint = {
  /** i18n suffix under `settings.completeness.gap.` */
  id: "displayName" | "mainRole" | "ageBand" | "bio" | "avatar" | "location";
  href: string;
};

/** Concrete empty fields to nudge inside Settings — not the global banner. */
export function listHighImpactProfileGaps(p: {
  display_name?: string | null;
  main_role?: string | null;
  roles?: string[] | null;
  age_band?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
}): ProfileGapHint[] {
  const gaps: ProfileGapHint[] = [];
  if (!hasText(p.display_name)) {
    gaps.push({ id: "displayName", href: "#displayName" });
  }
  const hasRole =
    hasText(p.main_role) ||
    (Array.isArray(p.roles) && p.roles.some((r) => hasText(r)));
  if (!hasRole) {
    gaps.push({ id: "mainRole", href: "#mainRole" });
  }
  if (!hasText(p.age_band)) {
    gaps.push({ id: "ageBand", href: "#ageBand" });
  }
  if (!hasText(p.avatar_url)) {
    gaps.push({ id: "avatar", href: "#statement" });
  }
  if (!hasText(p.bio)) {
    gaps.push({ id: "bio", href: "#bio" });
  }
  const hasLocation =
    hasText(p.city) || hasText(p.region) || hasText(p.country);
  if (!hasLocation) {
    gaps.push({ id: "location", href: "#ageBand" });
  }
  return gaps.slice(0, 4);
}
