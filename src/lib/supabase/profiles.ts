import { supabase } from "./client";
import { saveProfileUnified } from "./profileSaveUnified";
import { PROFILE_ME_SELECT } from "./selectors";

/** Canonical profile row shape returned by getMyProfile (matches PROFILE_ME_SELECT). */
export type Profile = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  location: string | null;
  website: string | null;
  main_role: string | null;
  roles: string[] | null;
  is_public: boolean | null;
  profile_details: Record<string, unknown> | null;
  profile_completeness: number | null;
  profile_updated_at: string | null;
  education: unknown[] | null;
  career_stage?: string | null;
  age_band?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  themes?: string[] | null;
  mediums?: string[] | null;
  styles?: string[] | null;
  keywords?: string[] | null;
  price_band?: string | null;
  acquisition_channels?: string[] | null;
  affiliation?: string | null;
  program_focus?: string[] | null;
  residencies?: unknown;
  exhibitions?: unknown;
  awards?: unknown;
  // P1-0 Profile Identity Surface
  cover_image_url?: string | null;
  cover_image_position_y?: number | null;
  artist_statement?: string | null;
  artist_statement_hero_image_url?: string | null;
  artist_statement_updated_at?: string | null;
};

/**
 * Loosely-typed CV entries. The underlying `profiles.education /
 * exhibitions / awards / residencies` jsonb columns are user-authored
 * arrays; the public lookup RPC (`lookup_profile_by_username`) coalesces
 * `null` to `[]`. Each entry is a free-form record — the UI normalizes
 * fields it knows about (school / program / year / type for education,
 * title / venue / city / year for exhibitions, etc.) and shows the rest
 * as a short fallback line.
 */
export type CvEntry = Record<string, unknown>;

export type ProfilePublic = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  location: string | null;
  website: string | null;
  main_role: string | null;
  roles: string[] | null;
  is_public?: boolean;
  /** Subset of profile_details exposed on public username lookup (portfolio tabs only). */
  studio_portfolio?: Record<string, unknown> | null;
  // P1-0 Profile Identity Surface (public projection)
  cover_image_url?: string | null;
  cover_image_position_y?: number | null;
  artist_statement?: string | null;
  artist_statement_hero_image_url?: string | null;
  artist_statement_updated_at?: string | null;
  // Public CV slice (lookup_profile_cv migration)
  education?: CvEntry[] | null;
  /** Free-form text exhibition history kept on the profile (distinct from
   * the structured exhibitions table — see `ExhibitionWithCredits`). */
  exhibitions_cv?: CvEntry[] | null;
  awards?: CvEntry[] | null;
  residencies?: CvEntry[] | null;
  // QA 2026-06-26 (#6): optional CV PDF download path (artworks bucket).
  cv_pdf_path?: string | null;
};

/**
 * Meta-card slice returned for private accounts. Mirrors the JSONB shape
 * returned by `public.lookup_profile_by_username()` when `is_public=false`:
 *   id, username, display_name, avatar_url, main_role, roles, bio,
 *   is_public:false, viewer_follow_status.
 *
 * Sensitive portfolio fields (themes, mediums, studio_portfolio, statement,
 * cover image, location, website, exhibitions, awards, etc.) are
 * intentionally omitted on the SQL side.
 */
export type PrivateProfileCard = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  main_role: string | null;
  roles: string[] | null;
  bio: string | null;
  is_public: false;
  viewer_follow_status: "none" | "pending" | "accepted";
};

export async function lookupPublicProfileByUsername(username: string): Promise<{
  data: ProfilePublic | null;
  privateCard: PrivateProfileCard | null;
  isPrivate: boolean;
  notFound: boolean;
  error: unknown;
}> {
  const { data, error } = await supabase.rpc("lookup_profile_by_username", {
    p_username: username.trim().toLowerCase(),
  });

  if (error) {
    return {
      data: null,
      privateCard: null,
      isPrivate: false,
      notFound: true,
      error,
    };
  }

  const raw = data as Record<string, unknown> | null;
  const isPrivate = !!raw && raw.is_public === false;
  const notFound = !raw;

  if (notFound) {
    return {
      data: null,
      privateCard: null,
      isPrivate: false,
      notFound: true,
      error: null,
    };
  }

  if (isPrivate) {
    const status = String(raw?.viewer_follow_status ?? "none");
    const privateCard: PrivateProfileCard = {
      id: String(raw?.id ?? ""),
      username: raw?.username != null ? String(raw.username) : null,
      display_name: raw?.display_name != null ? String(raw.display_name) : null,
      avatar_url: raw?.avatar_url != null ? String(raw.avatar_url) : null,
      main_role: raw?.main_role != null ? String(raw.main_role) : null,
      roles: Array.isArray(raw?.roles) ? (raw.roles as string[]) : null,
      bio: raw?.bio != null ? String(raw.bio) : null,
      is_public: false,
      viewer_follow_status:
        status === "accepted" || status === "pending" ? status : "none",
    };
    return {
      data: null,
      privateCard,
      isPrivate: true,
      notFound: false,
      error: null,
    };
  }

  const sp = raw?.studio_portfolio;
  const parsed: ProfilePublic = {
    id: String(raw?.id ?? ""),
    username: raw?.username != null ? String(raw.username) : null,
    display_name: raw?.display_name != null ? String(raw.display_name) : null,
    avatar_url: raw?.avatar_url != null ? String(raw.avatar_url) : null,
    bio: raw?.bio != null ? String(raw.bio) : null,
    location: raw?.location != null ? String(raw.location) : null,
    website: raw?.website != null ? String(raw.website) : null,
    main_role: raw?.main_role != null ? String(raw.main_role) : null,
    roles: Array.isArray(raw?.roles) ? (raw.roles as string[]) : null,
    is_public: raw?.is_public === true,
    studio_portfolio:
      sp != null && typeof sp === "object" && !Array.isArray(sp) ? (sp as Record<string, unknown>) : null,
    cover_image_url: stringFieldOrNull(raw?.cover_image_url),
    cover_image_position_y: numberFieldOrNull(raw?.cover_image_position_y),
    artist_statement: stringFieldOrNull(raw?.artist_statement),
    artist_statement_hero_image_url: stringFieldOrNull(raw?.artist_statement_hero_image_url),
    artist_statement_updated_at: stringFieldOrNull(raw?.artist_statement_updated_at),
    education: cvArrayOrNull(raw?.education),
    exhibitions_cv: cvArrayOrNull(raw?.exhibitions_cv),
    awards: cvArrayOrNull(raw?.awards),
    residencies: cvArrayOrNull(raw?.residencies),
    cv_pdf_path: stringFieldOrNull(raw?.cv_pdf_path),
  };

  return {
    data: parsed,
    privateCard: null,
    isPrivate: false,
    notFound: false,
    error: null,
  };
}

function stringFieldOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length ? trimmed : null;
}

function cvArrayOrNull(v: unknown): CvEntry[] | null {
  if (!Array.isArray(v)) return null;
  const out: CvEntry[] = [];
  for (const item of v) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      out.push(item as CvEntry);
    }
  }
  return out.length ? out : null;
}

function numberFieldOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Public listing of profiles for the Explore Artists tab. Public read
 * (RLS: is_public=true only), filtered by role when requested. No sensitive
 * fields (email/details) are selected; only the identity slice needed for
 * a lightweight artist card.
 */
export type ProfileListItem = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  main_role: string | null;
  roles: string[] | null;
  bio: string | null;
};

export type ProfileListCursor = { created_at: string; id: string };

export async function listPublicProfiles(options: {
  role?: string | null;
  limit?: number;
  cursor?: ProfileListCursor | null;
} = {}): Promise<{
  data: ProfileListItem[];
  nextCursor: ProfileListCursor | null;
  error: unknown;
}> {
  const { role = null, limit = 24, cursor = null } = options;
  const pageSize = Math.min(Math.max(limit, 1), 60);
  const requestLimit = pageSize + 1;

  let query = supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url, main_role, roles, bio, created_at")
    .eq("is_public", true)
    .not("username", "is", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(requestLimit);

  if (role) {
    // Match either main_role or any of the roles[] array entries.
    query = query.or(`main_role.eq.${role},roles.cs.{${role}}`);
  }

  if (cursor) {
    const createdAt = cursor.created_at.replace(/"/g, '\\"');
    const id = cursor.id.replace(/"/g, '\\"');
    query = query.or(
      `created_at.lt."${createdAt}",and(created_at.eq."${createdAt}",id.lt."${id}")`
    );
  }

  const { data, error } = await query;
  const rows = (data ?? []) as Array<Record<string, unknown>>;

  let nextCursor: ProfileListCursor | null = null;
  if (rows.length > pageSize) {
    const overflow = rows[pageSize];
    const createdAt = overflow?.created_at != null ? String(overflow.created_at) : null;
    const id = overflow?.id != null ? String(overflow.id) : null;
    if (createdAt && id) nextCursor = { created_at: createdAt, id };
  }

  const trimmed = rows.slice(0, pageSize).map((r) => ({
    id: String(r.id ?? ""),
    username: r.username != null ? String(r.username) : null,
    display_name: r.display_name != null ? String(r.display_name) : null,
    avatar_url: r.avatar_url != null ? String(r.avatar_url) : null,
    main_role: r.main_role != null ? String(r.main_role) : null,
    roles: Array.isArray(r.roles) ? (r.roles as string[]) : null,
    bio: r.bio != null ? String(r.bio) : null,
  }));

  return { data: trimmed, nextCursor, error };
}

export async function checkUsernameExists(
  username: string,
  excludeUserId?: string
) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", username.toLowerCase())
    .maybeSingle();
  if (error) return { exists: false, error };
  const exists = !!data && data.id !== excludeUserId;
  return { exists, error: null };
}

/**
 * Username availability via the `check_username_availability` RPC
 * (Onboarding Identity Overhaul, Track G). The RPC is authoritative
 * because it reuses the same `is_placeholder_username` SQL helper as
 * the auth-state RPC and knows about reserved names.
 *
 * Returns a small union so UI can render a precise message. On a
 * network / RPC error we return `"error"` instead of silently
 * treating the handle as available.
 */
export type UsernameAvailabilityReason =
  | "available"
  | "self"
  | "taken"
  | "invalid"
  | "reserved"
  | "empty"
  | "error";

export async function checkUsernameAvailability(
  username: string
): Promise<{ available: boolean; reason: UsernameAvailabilityReason }> {
  const normalized = (username ?? "").trim().toLowerCase();
  if (!normalized) return { available: false, reason: "empty" };
  const { data, error } = await supabase.rpc("check_username_availability", {
    p_username: normalized,
  });
  if (error) return { available: false, reason: "error" };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    return { available: false, reason: "error" };
  }
  const r = row as { available?: unknown; reason?: unknown };
  const reasonStr = typeof r.reason === "string" ? r.reason : "error";
  const reason: UsernameAvailabilityReason = (
    ["available", "self", "taken", "invalid", "reserved", "empty", "error"] as const
  ).includes(reasonStr as UsernameAvailabilityReason)
    ? (reasonStr as UsernameAvailabilityReason)
    : "error";
  return { available: !!r.available, reason };
}

export async function getMyProfile(): Promise<{
  data: Profile | null;
  error: unknown;
}> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { data: null, error: null };
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_ME_SELECT)
    .eq("id", session.user.id)
    .single();
  return { data: data as Profile | null, error };
}

/** Fetch profile by id. Allowed when caller is self or account-scope delegate (RLS). For "acting as" display. */
export async function getProfileById(profileId: string): Promise<{
  data: Profile | null;
  error: unknown;
}> {
  if (!profileId) return { data: null, error: null };
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_ME_SELECT)
    .eq("id", profileId)
    .single();
  return { data: data as Profile | null, error };
}

/** Get own profile as ProfilePublic. Used when viewing own private profile. */
export async function getMyProfileAsPublic(): Promise<{
  data: ProfilePublic | null;
  error: unknown;
}> {
  const { data, error } = await getMyProfile();
  if (error || !data) return { data: null, error };
  const row = data as Record<string, unknown>;
  const details = row?.profile_details as Record<string, unknown> | null | undefined;
  const sp = details?.studio_portfolio;
  const parsed: ProfilePublic = {
    id: String(row?.id ?? ""),
    username: row?.username != null ? String(row.username) : null,
    display_name: row?.display_name != null ? String(row.display_name) : null,
    avatar_url: row?.avatar_url != null ? String(row.avatar_url) : null,
    bio: row?.bio != null ? String(row.bio) : null,
    location: row?.location != null ? String(row.location) : null,
    website: row?.website != null ? String(row.website) : null,
    main_role: row?.main_role != null ? String(row.main_role) : null,
    roles: Array.isArray(row?.roles) ? (row.roles as string[]) : null,
    is_public: row?.is_public === true,
    studio_portfolio:
      sp != null && typeof sp === "object" && !Array.isArray(sp) ? (sp as Record<string, unknown>) : null,
    cover_image_url: stringFieldOrNull(row?.cover_image_url),
    cover_image_position_y: numberFieldOrNull(row?.cover_image_position_y),
    artist_statement: stringFieldOrNull(row?.artist_statement),
    artist_statement_hero_image_url: stringFieldOrNull(row?.artist_statement_hero_image_url),
    artist_statement_updated_at: stringFieldOrNull(row?.artist_statement_updated_at),
    cv_pdf_path: stringFieldOrNull(row?.cv_pdf_path),
  };
  return { data: parsed, error: null };
}

type UpsertProfileParams = {
  username: string;
  display_name?: string;
  main_role?: string;
  roles?: string[];
};

export type EducationEntry = {
  school?: string | null;
  program?: string | null;
  year?: string | number | null;
  type?: string | null;
};

export type UpdateProfileParams = {
  display_name?: string | null;
  bio?: string | null;
  location?: string | null;
  website?: string | null;
  avatar_url?: string | null;
  main_role?: string | null;
  roles?: string[] | null;
  is_public?: boolean;
  career_stage?: string | null;
  age_band?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  themes?: string[] | null;
  mediums?: string[] | null;
  styles?: string[] | null;
  keywords?: string[] | null;
  education?: EducationEntry[] | null;
  price_band?: string | null;
  acquisition_channels?: string[] | null;
  affiliation?: string | null;
  program_focus?: string[] | null;
  residencies?: unknown[] | null;
  exhibitions?: unknown[] | null;
  awards?: unknown[] | null;
  profile_completeness?: number | null;
  profile_updated_at?: string | null;
  // P1-0 identity surface
  cover_image_url?: string | null;
  cover_image_position_y?: number | null;
  artist_statement?: string | null;
  artist_statement_hero_image_url?: string | null;
};

/** Base-only columns for profiles table (no details). */
const BASE_PROFILE_KEYS = [
  "display_name",
  "bio",
  "location",
  "website",
  "avatar_url",
  "main_role",
  "roles",
  "is_public",
  "education",
  "profile_completeness",
  "profile_updated_at",
  // P1-0 identity surface
  "cover_image_url",
  "cover_image_position_y",
  "artist_statement",
  "artist_statement_hero_image_url",
] as const;

export type UpdateProfileBaseParams = {
  display_name?: string | null;
  bio?: string | null;
  location?: string | null;
  website?: string | null;
  avatar_url?: string | null;
  main_role?: string | null;
  roles?: string[] | null;
  is_public?: boolean;
  education?: EducationEntry[] | null;
  profile_completeness?: number | null;
  profile_updated_at?: string | null;
  // P1-0 identity surface
  cover_image_url?: string | null;
  cover_image_position_y?: number | null;
  artist_statement?: string | null;
  artist_statement_hero_image_url?: string | null;
};

/** Update only base profile fields via RPC (no direct PATCH). */
export async function updateMyProfileBase(partial: UpdateProfileBaseParams) {
  const updates: Record<string, unknown> = {};
  for (const key of BASE_PROFILE_KEYS) {
    if (key in partial && partial[key] !== undefined) {
      updates[key] = partial[key];
    }
  }
  if (Object.keys(updates).length === 0) {
    return { data: null, error: null };
  }
  const res = await saveProfileUnified({
    basePatch: updates,
    detailsPatch: {},
    completeness: (partial.profile_completeness ?? null) as number | null,
  });
  if (!res.ok) return { data: null, error: res };
  return { data: res.data as { id: string; username: string | null } & Record<string, unknown>, error: null };
}

/** Patch update via RPC (no direct PATCH). Skips if patch empty. */
export async function updateMyProfileBasePatch(patch: Partial<UpdateProfileBaseParams>): Promise<{
  data: { id: string; username: string | null; profile_completeness: number | null; profile_details: Record<string, unknown> | null } | null;
  error: unknown;
  skipped?: boolean;
}> {
  const allowed = new Set(BASE_PROFILE_KEYS);
  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (allowed.has(key as (typeof BASE_PROFILE_KEYS)[number]) && value !== undefined) {
      updates[key] = value;
    }
  }
  if (Object.keys(updates).length === 0) {
    return { data: null, error: null, skipped: true };
  }
  const res = await saveProfileUnified({
    basePatch: updates,
    detailsPatch: {},
    completeness: (patch.profile_completeness ?? null) as number | null,
  });
  if (!res.ok) return { data: null, error: res };
  return {
    data: res.data as { id: string; username: string | null; profile_completeness: number | null; profile_details: Record<string, unknown> | null },
    error: null,
  };
}

/** Update profile via RPC (no direct PATCH). Base fields in basePatch, details in detailsPatch. */
export async function updateMyProfile(partial: UpdateProfileParams) {
  const baseKeys = [
    "display_name", "bio", "location", "website", "avatar_url", "main_role", "roles", "is_public",
    "education", "profile_completeness", "profile_updated_at",
    "cover_image_url", "cover_image_position_y", "artist_statement", "artist_statement_hero_image_url",
  ] as const;
  const detailKeys = [
    "career_stage", "age_band", "city", "region", "country", "themes", "mediums", "styles",
    "keywords", "price_band", "acquisition_channels", "affiliation", "program_focus",
    "residencies", "exhibitions", "awards",
  ] as const;
  const basePatch: Record<string, unknown> = {};
  const detailsPatch: Record<string, unknown> = {};
  for (const k of baseKeys) {
    if (k in partial && partial[k] !== undefined) basePatch[k] = partial[k];
  }
  for (const k of detailKeys) {
    if (k in partial && partial[k] !== undefined) detailsPatch[k] = partial[k];
  }
  if (Object.keys(basePatch).length === 0 && Object.keys(detailsPatch).length === 0) {
    return { data: null, error: null };
  }
  const res = await saveProfileUnified({
    basePatch,
    detailsPatch,
    completeness: (partial.profile_completeness ?? null) as number | null,
  });
  if (!res.ok) return { data: null, error: res };
  return { data: res.data, error: null };
}

/** Onboarding: create/update profile via RPC (no direct upsert). */
export async function upsertProfile(params: UpsertProfileParams) {
  const { username, ...rest } = params;
  const res = await saveProfileUnified({
    basePatch: { username: username.toLowerCase(), ...rest },
    detailsPatch: {},
    completeness: null,
  });
  if (!res.ok) return { data: null, error: res };
  return { data: res.data, error: null };
}
