/**
 * Identity SSOT (Track 2.1)
 *
 * Every surface that shows a person's name / handle / role set should read
 * from this module instead of ad-hoc `display_name || username || ...` logic.
 * That way the rules ship from one place and stay consistent across Header,
 * feed cards, people lanes, artwork pages, notifications, delegation
 * banners, etc.
 */

import type { RoleKey } from "./roles";
import { normalizeRoleList, roleLabel } from "./roles";
import { isPlaceholderUsername } from "./placeholder";
import type { Locale } from "@/lib/i18n/locale";
import { pickLocalizedDisplayName } from "@/lib/i18n/pickLocalized";

export type IdentityInput = {
  id?: string | null;
  display_name?: string | null;
  /** QA 2026-07-28 bilingual. When supplied together with `locale`,
   *  `formatDisplayName` / `formatIdentityPair` return the author-owned
   *  localized name. Legacy `display_name` is kept in sync by the 240004
   *  DB trigger so callers that don't pass locale keep their existing
   *  behaviour. */
  display_name_ko?: string | null;
  display_name_en?: string | null;
  username?: string | null;
  main_role?: string | null;
  roles?: string[] | null;
};

/** Anything we render for unknown users. Never throws, never returns ''. */
const UNKNOWN = "알 수 없는 사용자";
/** Public-surface stand-in for users with placeholder handles and no display name.
 *  Callers that have a `t()` handle in scope should pass it so this is
 *  localized through `identity.incompletePlaceholder`. */
const PLACEHOLDER_NEUTRAL_KO = "설정 중인 프로필";

type Translator = (key: string) => string;

function placeholderNeutralLabel(t?: Translator): string {
  if (!t) return PLACEHOLDER_NEUTRAL_KO;
  const out = t("identity.incompletePlaceholder");
  return out && out !== "identity.incompletePlaceholder" ? out : PLACEHOLDER_NEUTRAL_KO;
}

function cleanStr(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.trim();
}

/** Returns "@username" or "" when there is no username, or empty when
 *  the handle is a canonical placeholder (`user_xxxxxxxx`). Placeholder
 *  handles must never be shown on public surfaces — see Onboarding
 *  Identity Overhaul (Track I). */
export function formatUsername(profile: IdentityInput | null | undefined): string {
  const u = cleanStr(profile?.username);
  if (!u) return "";
  if (isPlaceholderUsername(u)) return "";
  return `@${u.replace(/^@+/, "")}`;
}

/** The single line to show as the person's primary name.
 *  Preference order: (localized display_name if locale) → display_name →
 *  @username (suppressing placeholder) → neutral label.
 *  Pass `t` to localize the placeholder / unknown fallback via
 *  `identity.incompletePlaceholder`.
 *  Pass `locale` (QA 2026-07-28) to return the author-owned KO/EN name;
 *  omit for the legacy behaviour. */
export function formatDisplayName(
  profile: IdentityInput | null | undefined,
  t?: Translator,
  locale?: Locale,
): string {
  if (locale && profile) {
    const localized = pickLocalizedDisplayName(profile, locale).trim();
    if (localized) return localized;
  }
  const dn = cleanStr(profile?.display_name);
  if (dn) return dn;
  const u = formatUsername(profile);
  if (u) return u;
  if (isPlaceholderUsername(cleanStr(profile?.username))) {
    return placeholderNeutralLabel(t);
  }
  return UNKNOWN;
}

/**
 * Primary + secondary identity pair for hero/card layouts.
 *   primary   = localized display_name (or legacy display_name), falling back
 *               to @handle, suppressing placeholders
 *   secondary = @handle (only if we already used display_name as primary)
 * Placeholder usernames never appear in either slot. Pass `t` to
 * localize the neutral placeholder label. Pass `locale` (QA 2026-07-28)
 * for author-owned KO/EN name resolution.
 */
export function formatIdentityPair(
  profile: IdentityInput | null | undefined,
  t?: Translator,
  locale?: Locale,
): { primary: string; secondary: string } {
  const dn = locale && profile
    ? (pickLocalizedDisplayName(profile, locale).trim() || cleanStr(profile?.display_name))
    : cleanStr(profile?.display_name);
  const handle = formatUsername(profile);
  if (dn && handle) return { primary: dn, secondary: handle };
  if (dn) return { primary: dn, secondary: "" };
  if (handle) return { primary: handle, secondary: "" };
  if (isPlaceholderUsername(cleanStr(profile?.username))) {
    return { primary: placeholderNeutralLabel(t), secondary: "" };
  }
  return { primary: UNKNOWN, secondary: "" };
}

/** Small helper: `true` if this profile should not expose its `/u/<username>` link
 *  in public listings (placeholder handle). Intended for contexts where
 *  we want to show the person but not link to a broken profile URL. */
export function hasPublicLinkableUsername(
  profile: IdentityInput | null | undefined
): boolean {
  const u = cleanStr(profile?.username);
  if (!u) return false;
  return !isPlaceholderUsername(u);
}

export type IdentityRoleChip = {
  key: RoleKey;
  label: string;
  isPrimary: boolean;
};

/** Ordered role chips: primary first, then additional unique roles. */
export function formatRoleChips(
  profile: IdentityInput | null | undefined,
  t: (key: string) => string,
  options?: { max?: number }
): IdentityRoleChip[] {
  const max = options?.max ?? 4;
  const roles = normalizeRoleList(profile?.roles);
  const primaryRaw = cleanStr(profile?.main_role).toLowerCase();
  const primary = (roles.includes(primaryRaw as RoleKey) ? primaryRaw : roles[0] ?? null) as RoleKey | null;

  const ordered: RoleKey[] = [];
  if (primary) ordered.push(primary);
  for (const r of roles) {
    if (r !== primary && !ordered.includes(r)) ordered.push(r);
  }

  return ordered.slice(0, max).map((key, i) => ({
    key,
    label: roleLabel(key, t),
    isPrimary: i === 0 && !!primary,
  }));
}

/** Acting-as banner label (delegate operating another profile).
 *  Ex: "Acting as @gallery-foo (작가 위임)" */
export function formatActingAsLabel(
  subject: IdentityInput | null | undefined,
  t: (key: string) => string
): string {
  const name = formatDisplayName(subject);
  const handle = formatUsername(subject);
  const suffix = handle && handle !== name ? ` ${handle}` : "";
  return `${t("identity.actingAs")}: ${name}${suffix}`;
}
