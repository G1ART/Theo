import { supabase } from "./client";
import { removeStorageFiles } from "./storage";
import { recordUsageEvent } from "@/lib/metering";
import { USAGE_KEYS } from "@/lib/metering/usageKeys";
import { recordActingContextEvent } from "@/lib/delegation/actingContext";
import { isPublicSurfaceVisible } from "@/lib/feed/visibility";

const BUCKET = "artworks";

export function getStorageUrl(path: string): string {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export type ImageVariant = "thumb" | "medium" | "avatar" | "original";

const VARIANT_TRANSFORM: Record<
  Exclude<ImageVariant, "original">,
  { width: number; height: number; quality?: number }
> = {
  thumb: { width: 400, height: 400, quality: 70 },
  medium: { width: 1200, height: 1200, quality: 80 },
  avatar: { width: 96, height: 96, quality: 75 },
};

/** Get image URL with optional resize. thumb=feed/grid, medium=detail, avatar=profile pics. */
export function getArtworkImageUrl(
  path: string,
  variant: ImageVariant = "original"
): string {
  if (variant === "original") {
    return getStorageUrl(path);
  }
  const transform = VARIANT_TRANSFORM[variant];
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path, {
    transform: { ...transform, resize: "contain" },
  });
  return data.publicUrl;
}

export type ArtworkRow = {
  id: string;
  title: string | null;
  year: number | null;
  medium: string | null;
  story: string | null;
  pricing_mode: string | null;
  is_price_public: boolean | null;
  price_usd: number | null;
  price_input_amount: number | null;
  price_input_currency: string | null;
  fx_rate_to_usd: number | null;
  fx_date: string | null;
  ownership_status: string | null;
  artist_id: string;
  visibility: string | null;
  created_at: string | null;
  provenance_visible?: boolean | null;
};

export type ArtworkImageViewType =
  | "wall_mounted"
  | "detail"
  | "angle"
  | "in_situ"
  | "other";

export type ArtworkImage = {
  storage_path: string;
  sort_order?: number;
  /** QA 2026-06-26 (#5) — perspective tag for the carousel label.
   *  Always defined post-migration; legacy reads fall back to
   *  `wall_mounted` (the historical implicit value). */
  view_type?: ArtworkImageViewType | string | null;
  /**
   * 2026-07-20 (feed image standardization) — optional per-image display
   * adjustments (brightness / contrast / saturation / crop) applied on
   * grid/feed surfaces only. Original storage pixels are never modified.
   * NULL = render original as before. See `src/lib/image/displayAdjust.ts`.
   */
  display_adjust?: import("@/lib/image/displayAdjust").DisplayAdjust | null;
};
export type ArtistProfile = {
  id?: string;
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  main_role?: string | null;
  roles?: string[] | null;
} | null;

export type ArtworkClaim = {
  id?: string;
  claim_type: string;
  subject_profile_id: string;
  artist_profile_id?: string | null;
  external_artist_id?: string | null;
  created_at?: string | null;
  /** pending = request awaiting artist confirmation; confirmed = visible in provenance */
  status?: string | null;
  /** past = ended, current = ongoing, future = scheduled. For INVENTORY/CURATED/EXHIBITED. */
  period_status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  profiles: { username: string | null; display_name: string | null } | null;
  // QA 2026-06-27: invite_email is intentionally NOT embedded in public
  // artwork payloads (PII). Read it via getExternalArtistInviteEmail (owner only).
  external_artists?: { display_name: string } | null;
};

const CLAIM_STATUS_CONFIRMED = "confirmed";

/** Base artwork shape returned from list/get with embedded images and profile. */
export type Artwork = {
  id: string;
  title: string | null;
  year: number | null;
  medium: string | null;
  size: string | null;
  /** 사용자 입력 단위 보존: 'cm' | 'in' | null (null = 기존/호수 등) */
  size_unit?: "cm" | "in" | null;
  story: string | null;
  visibility: string | null;
  /** 업로드 당사자(레코드 생성자). 삭제 권한에 사용 */
  created_by?: string | null;
  pricing_mode: string | null;
  is_price_public: boolean | null;
  price_usd: number | null;
  price_input_amount: number | null;
  price_input_currency: string | null;
  fx_rate_to_usd: number | null;
  fx_date: string | null;
  ownership_status: string | null;
  artist_id: string;
  artist_sort_order: number | null;
  created_at: string | null;
  artwork_images: ArtworkImage[] | null;
  profiles: ArtistProfile;
  claims?: ArtworkClaim[] | null;
  provenance_visible?: boolean | null;
  /** Filled when user applied website-assisted import metadata (audit / trust UI). */
  website_import_provenance?: Record<string, unknown> | null;
};

/**
 * "Effective" identifiers for permission predicates. A single uuid (the
 * legacy shape) still works; passing an array lets callers fold an
 * acting-as principal id alongside the operator's session uid so that
 * claim-bearing screens (artwork detail / edit) recognise principal-owned
 * works and claims when an account-scope delegate is operating on them.
 *
 * Order matters for `getMyClaim` only — the *first* matching id wins, so
 * callers that prefer the principal persona should list it first.
 */
type UserIdLike = string | string[] | null | undefined;

function normalizeUserIds(input: UserIdLike): string[] {
  if (!input) return [];
  const arr = typeof input === "string" ? [input] : input;
  const out: string[] = [];
  for (const x of arr) {
    if (typeof x === "string" && x && !out.includes(x)) out.push(x);
  }
  return out;
}

/** User can edit artwork if they are artist or have a confirmed claim. */
export function canEditArtwork(artwork: Artwork, userId: UserIdLike): boolean {
  const ids = normalizeUserIds(userId);
  if (ids.length === 0) return false;
  if (ids.includes(artwork.artist_id)) return true;
  const claims = artwork.claims ?? [];
  return claims.some(
    (c) =>
      ids.includes(c.subject_profile_id) &&
      (c.status == null || c.status === CLAIM_STATUS_CONFIRMED)
  );
}

/** Can delete: artist, created_by(업로더), or anyone who has a claim (uploader/lister). */
export function canDeleteArtwork(artwork: Artwork, userId: UserIdLike): boolean {
  const ids = normalizeUserIds(userId);
  if (ids.length === 0) return false;
  if (ids.includes(artwork.artist_id)) return true;
  if (artwork.created_by != null && ids.includes(artwork.created_by)) return true;
  const claims = artwork.claims ?? [];
  return claims.some((c) => ids.includes(c.subject_profile_id));
}

/**
 * Get the current user's claim (any status; for edit flow or pending check).
 * When passed an array, the *first* id with a matching claim wins so a
 * principal claim is preferred over the operator's during acting-as.
 */
export function getMyClaim(artwork: Artwork, userId: UserIdLike): ArtworkClaim | null {
  const ids = normalizeUserIds(userId);
  if (ids.length === 0) return null;
  const claims = artwork.claims ?? [];
  for (const id of ids) {
    const match = claims.find((c) => c.subject_profile_id === id);
    if (match) return match;
  }
  return null;
}

/** Confirmed claims only (for provenance display). */
function getConfirmedClaims(artwork: Artwork): ArtworkClaim[] {
  const claims = artwork.claims ?? [];
  return claims.filter((c) => c.status == null || c.status === CLAIM_STATUS_CONFIRMED);
}

/** Pick primary claim for display (CREATED first, else first; confirmed only). */
export function getPrimaryClaim(artwork: Artwork): ArtworkClaim | null {
  const claims = getConfirmedClaims(artwork);
  const created = claims.find((c) => c.claim_type === "CREATED");
  return created ?? claims[0] ?? null;
}

/**
 * Derive the primary artist label for display.
 * Priority:
 * 1) External artist name from any claim (pre-onboarding invited artist)
 * 2) Artist profile display_name
 * 3) Artist profile username (as @username)
 */
export function getArtworkArtistLabel(
  artwork: Artwork | ArtworkWithLikes
): { label: string | null; profileUsername: string | null } {
  const claims = (artwork as any).claims as ArtworkClaim[] | undefined;
  if (claims && claims.length > 0) {
    // Use first external artist name if present (invited, not yet onboarded).
    const withExternal = claims.find(
      (c) =>
        (c as any).external_artists &&
        typeof (c as any).external_artists.display_name === "string" &&
        (c as any).external_artists.display_name.trim() !== ""
    ) as (ArtworkClaim & { external_artists?: { display_name?: string | null } }) | undefined;
    if (withExternal && withExternal.external_artists?.display_name) {
      const name = withExternal.external_artists.display_name.trim();
      if (name) {
        return { label: name, profileUsername: null };
      }
    }
  }

  const artist = (artwork as any).profiles as ArtistProfile | null | undefined;
  const username = artist?.username ?? null;
  const displayName =
    typeof artist?.display_name === "string" && artist.display_name.trim()
      ? artist.display_name.trim()
      : null;
  const label = displayName || (username ? "@" + username : null);
  return { label, profileUsername: username };
}

/**
 * The claim whose `external_artists.display_name` is used as the artwork's
 * displayed artist label (first such claim — mirrors `getArtworkArtistLabel`).
 * Returns null for works authored by an onboarded artist.
 */
export function getExternalArtistClaim(
  artwork: Artwork | ArtworkWithLikes
): (ArtworkClaim & { external_artists?: { display_name?: string | null } }) | null {
  const claims = (artwork as any).claims as ArtworkClaim[] | undefined;
  if (!claims || claims.length === 0) return null;
  const found = claims.find(
    (c) =>
      (c as any).external_artists &&
      typeof (c as any).external_artists.display_name === "string" &&
      (c as any).external_artists.display_name.trim() !== ""
  );
  return (found as (ArtworkClaim & { external_artists?: { display_name?: string | null } }) | undefined) ?? null;
}

/**
 * True when the credited artist is an external (invited, not-yet-onboarded)
 * artist rather than an onboarded profile. In that case the artwork's
 * `artist_id`/`profiles` point at the uploading account (e.g. a gallery), and
 * the real artist name lives on the external claim.
 */
export function isExternalArtistArtwork(
  artwork: Artwork | ArtworkWithLikes
): boolean {
  return getExternalArtistClaim(artwork) != null;
}

/**
 * Stable grouping key for "by artist" sections (exhibition pages).
 *
 * External invited artists must group by their `external_artist_id` so that
 * several different invited artists uploaded by a single gallery (which share
 * the gallery's `artist_id`) don't collapse into one section credited to the
 * first artist. Onboarded artists keep grouping by `artist_id`.
 */
export function getArtworkArtistGroupKey(
  artwork: Artwork | ArtworkWithLikes
): string {
  const externalClaim = getExternalArtistClaim(artwork);
  if (externalClaim) {
    // After the 2026-06-30 dedupe migration, `external_artists` is one row
    // per artist (per inviter), so `external_artist_id` is a STABLE identity:
    // every work credited to the same invited artist now shares one id, while
    // genuine homonyms (distinct rows / emails) keep distinct ids and split
    // into separate sections. Prefer the id; fall back to the normalized name
    // only when the id is somehow missing.
    if (externalClaim.external_artist_id) {
      return `ext:${externalClaim.external_artist_id}`;
    }
    const name = externalClaim.external_artists?.display_name?.trim().toLowerCase();
    if (name) return `extname:${name}`;
  }
  const artistId = (artwork as any).artist_id as string | null | undefined;
  if (artistId) return artistId;
  const { label } = getArtworkArtistLabel(artwork);
  return `extname:${(label ?? "unknown").toLowerCase()}`;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$", KRW: "₩", EUR: "€", GBP: "£", JPY: "¥",
};

/**
 * Canonical price display for an artwork.
 * Shows input currency first; USD approximation as secondary when FX metadata exists.
 * @param t i18n function for "artwork.priceUponRequest", "artwork.priceHidden"
 */
export function getArtworkPriceDisplay(
  artwork: Artwork | ArtworkWithLikes,
  t: (key: string) => string
): string {
  if (artwork.pricing_mode === "inquire") return t("artwork.priceUponRequest");
  if (!artwork.is_price_public) return t("artwork.priceHidden");

  const inputAmt = artwork.price_input_amount;
  const inputCur = artwork.price_input_currency;
  const priceUsd = artwork.price_usd;
  const fxRate = artwork.fx_rate_to_usd;

  if (inputAmt != null && inputCur) {
    const sym = CURRENCY_SYMBOLS[inputCur] ?? "";
    const formatted = `${sym}${Number(inputAmt).toLocaleString()} ${inputCur}`;
    if (inputCur === "USD") return formatted;
    if (priceUsd != null && fxRate != null) {
      return `${formatted} (≈ $${Number(priceUsd).toLocaleString()} USD)`;
    }
    return formatted;
  }

  if (priceUsd != null) {
    return `$${Number(priceUsd).toLocaleString()} USD`;
  }

  return t("artwork.priceHidden");
}

/** Whether the viewer can see full provenance (curator, collector, etc.). */
export function canViewProvenance(artwork: Artwork, userId: string | null): boolean {
  if (artwork.provenance_visible !== false) return true;
  if (!userId) return false;
  if (artwork.artist_id === userId) return true;
  const claims = artwork.claims ?? [];
  return claims.some((c) => c.subject_profile_id === userId);
}

/** Claims sorted for display: CREATED first, then by created_at (newest first); confirmed only. */
export function getProvenanceClaims(artwork: Artwork): ArtworkClaim[] {
  const claims = [...getConfirmedClaims(artwork)];
  const created = claims.find((c) => c.claim_type === "CREATED");
  const rest = claims.filter((c) => c.claim_type !== "CREATED");
  rest.sort((a, b) => {
    const at = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
    return bt - at;
  });
  return created ? [created, ...rest] : rest;
}

export type ArtworkWithLikes = Artwork & { likes_count: number };

/** 최신 탭: created_at, id. 인기 탭: likes_count, created_at, id */
export type ArtworkCursor = {
  created_at: string;
  id: string;
  likes_count?: number;
};

type ListOptions = {
  limit?: number;
  sort?: "latest" | "popular";
  cursor?: ArtworkCursor | null;
};

const ARTWORK_SELECT = `
  id,
  title,
  year,
  medium,
  size,
  size_unit,
  story,
  visibility,
  created_by,
  pricing_mode,
  is_price_public,
  price_usd,
  price_input_amount,
  price_input_currency,
  fx_rate_to_usd,
  fx_date,
  ownership_status,
  artist_id,
  artist_sort_order,
  created_at,
  provenance_visible,
  website_import_provenance,
  likes_count,
  artwork_images(storage_path, sort_order, view_type, display_adjust),
  profiles!artist_id(id, username, display_name, avatar_url, bio, main_role, roles, is_public),
  artwork_likes(count),
  claims(id, claim_type, subject_profile_id, artist_profile_id, external_artist_id, created_at, status, period_status, start_date, end_date, profiles!subject_profile_id(username, display_name), external_artists(display_name))
`;

export async function listPublicArtworks(
  options: ListOptions = {}
): Promise<{
  data: ArtworkWithLikes[];
  nextCursor: ArtworkCursor | null;
  error: unknown;
}> {
  const { limit = 50, sort = "latest", cursor = null } = options;
  // Cap raised from 30 → 100. The salon feed deliberately requests
  // FEED_PAGE_SIZE = 60 to keep the first paint dense; capping at 30
  // silently halved the requested page and made `nextCursor` go null
  // sooner than the dataset warranted.
  const pageSize = Math.min(limit, 100);
  const requestLimit = pageSize + 1;
  const isPopular = sort === "popular";

  let query = supabase
    .from("artworks")
    .select(ARTWORK_SELECT)
    .eq("visibility", "public")
    .limit(requestLimit);

  if (isPopular) {
    query = query
      .order("likes_count", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (cursor) {
      // Some rows have NULL likes_count (legacy / not-yet-aggregated).
      // Falling back to 0 keeps cursor pagination consistent — we never
      // silently bail out on the cursor and start the page over.
      const lc = Number(cursor.likes_count ?? 0);
      const createdAt = String(cursor.created_at).replace(/"/g, '\\"');
      const id = String(cursor.id).replace(/"/g, '\\"');
      query = query.or(
        `likes_count.lt.${lc},and(likes_count.eq.${lc},created_at.lt."${createdAt}"),and(likes_count.eq.${lc},created_at.eq."${createdAt}",id.lt."${id}")`
      );
    }
  } else {
    query = query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (cursor) {
      const createdAt = cursor.created_at.replace(/"/g, '\\"');
      const id = cursor.id.replace(/"/g, '\\"');
      query = query.or(
        `created_at.lt."${createdAt}",and(created_at.eq."${createdAt}",id.lt."${id}")`
      );
    }
  }

  const { data, error } = await query;
  // Two-stage materialization: keep the *raw* fetched list (only normalized,
  // not yet filtered) for cursor decisions, and the *visible* list for
  // rendering. `isPublicSurfaceVisible` is a defensive client-side guard
  // against RLS edge cases (e.g. private profile leak); when it drops rows,
  // the visible list shrinks but the dataset boundary did NOT move, so we
  // must continue to issue a cursor. Previously the cursor was decided on
  // the post-filter length — any time the filter dropped >=1 row out of a
  // pageSize+1 fetch, `nextCursor` came back null and infinite scroll
  // halted even though the DB still had unseen rows.
  const raw = (data ?? []).map((r) =>
    normalizeArtworkRow(r as Record<string, unknown>)
  );
  const visible = raw.filter(isPublicSurfaceVisible) as ArtworkWithLikes[];

  let nextCursor: ArtworkCursor | null = null;
  if (raw.length > pageSize && raw[pageSize]) {
    const next = raw[pageSize];
    if (next.created_at != null && next.id) {
      nextCursor = {
        created_at: next.created_at,
        id: next.id,
        // popular: always carry likes_count (0 for nullable legacy rows)
        // so the cursor is unambiguous on the next page.
        ...(isPopular && { likes_count: Number(next.likes_count ?? 0) }),
      };
    }
  }
  const resultList =
    visible.length > pageSize ? visible.slice(0, pageSize) : visible;

  return {
    data: resultList,
    nextCursor,
    error,
  };
}

/** Extract likes count from raw PostgREST artwork_likes shape. Always returns a number. */
export function extractLikesCount(row: Record<string, unknown> | null | undefined): number {
  const v = row?.artwork_likes;
  // PostgREST aggregated select often returns [{ count: <number|string> }]
  if (Array.isArray(v) && v.length > 0 && v[0] != null && typeof v[0] === "object" && "count" in v[0]) {
    const n = Number((v[0] as { count: unknown }).count);
    return Number.isFinite(n) ? n : 0;
  }
  // Sometimes it can return a single object
  if (v != null && typeof v === "object" && "count" in v) {
    const n = Number((v as { count: unknown }).count);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function normalizeArtworkRow(r: Record<string, unknown>): ArtworkWithLikes {
  const fromColumn =
    r.likes_count != null && Number.isFinite(Number(r.likes_count))
      ? Number(r.likes_count)
      : null;
  const likes_count = fromColumn ?? extractLikesCount(r);
  return { ...r, likes_count } as ArtworkWithLikes;
}

/**
 * Defensive client-side filter for *public surfaces* (feed, discovery,
 * profile lanes, etc.). The canonical guard against private-artist
 * leakage lives in RLS (`artworks_select_public` joins
 * `is_artist_publicly_visible`), but the previous QA report
 * (2026-04-29) found that "알 수 없는 사용자" was still appearing on
 * the feed for private artists' works — meaning a row slipped through
 * RLS but the joined `profiles` row was filtered out by
 * `profiles_select_*` policies, leaving an orphan card with no
 * attributable artist.
 *
 * Drop those orphans on the client so a single misaligned policy
 * cannot leak content. Authenticated owner / follower / delegate
 * surfaces use their own listing helpers and stay unaffected.
 *
 * Implementation lives in `@/lib/feed/visibility` so it stays import-safe
 * from pure / testable code paths (the supabase client module has
 * top-level side effects).
 */
export { isPublicSurfaceVisible } from "@/lib/feed/visibility";

type FollowingOptions = {
  limit?: number;
  /** Keyset cursor; when set, only the following-artists stream is paginated (no merged “my claimed” merge). */
  cursor?: ArtworkCursor | null;
  /** When true and `cursor` is null, merge public artworks the user claims (subject) into the first page. */
  mergeOwnClaimedWorks?: boolean;
  /** Pre-resolved following IDs — skips internal follows query when provided. */
  followingIds?: string[];
};

export async function listFollowingArtworks(
  options: FollowingOptions = {}
): Promise<{ data: ArtworkWithLikes[]; nextCursor: ArtworkCursor | null; error: unknown }> {
  const {
    limit = 50,
    cursor = null,
    mergeOwnClaimedWorks = cursor == null,
  } = options;

  // Cap raised from 30 → 100 to honour FEED_PAGE_SIZE = 60. See
  // `listPublicArtworks` rationale.
  const pageSize = Math.min(limit, 100);
  const requestLimit = pageSize + 1;

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { data: [], nextCursor: null, error: null };

  const [resolvedFollowIds, claimRes] = await Promise.all([
    options.followingIds
      ? Promise.resolve(options.followingIds)
      : supabase
          .from("follows")
          .select("following_id")
          .eq("follower_id", session.user.id)
          .eq("status", "accepted")
          .then(({ data }) => (data ?? []).map((r) => r.following_id)),
    supabase.from("claims").select("work_id").eq("subject_profile_id", session.user.id).not("work_id", "is", null),
  ]);

  const followingIds = new Set(resolvedFollowIds);
  const myWorkIds = new Set((claimRes.data ?? []).map((r) => r.work_id).filter(Boolean));

  const artistIds = [...followingIds];
  const hasFollowing = artistIds.length > 0;

  let list: ArtworkWithLikes[] = [];
  let nextCursor: ArtworkCursor | null = null;

  if (hasFollowing) {
    let query = supabase
      .from("artworks")
      .select(ARTWORK_SELECT)
      .eq("visibility", "public")
      .in("artist_id", artistIds)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(requestLimit);

    if (cursor && cursor.created_at && cursor.id) {
      const createdAt = String(cursor.created_at).replace(/"/g, '\\"');
      const id = String(cursor.id).replace(/"/g, '\\"');
      query = query.or(
        `created_at.lt."${createdAt}",and(created_at.eq."${createdAt}",id.lt."${id}")`
      );
    }

    const { data, error } = await query;
    if (error) return { data: [], nextCursor: null, error };
    list = (data ?? []).map((r) => normalizeArtworkRow(r as Record<string, unknown>) as ArtworkWithLikes);

    const resultList = list.length > pageSize ? list.slice(0, pageSize) : list;
    if (list.length > pageSize && list[pageSize]) {
      const next = list[pageSize];
      if (next.created_at != null && next.id) {
        nextCursor = { created_at: next.created_at, id: next.id };
      }
    }
    list = resultList;
  }

  if (mergeOwnClaimedWorks && myWorkIds.size > 0) {
    const idsToFetch = [...myWorkIds].filter((id) => !list.some((a) => a.id === id)).slice(0, pageSize);
    if (idsToFetch.length > 0) {
      const { data, error } = await supabase
        .from("artworks")
        .select(ARTWORK_SELECT)
        .eq("visibility", "public")
        .in("id", idsToFetch);
      if (!error && data?.length) {
        const mine = (data ?? []).map((r) => normalizeArtworkRow(r as Record<string, unknown>) as ArtworkWithLikes);
        const seen = new Set(list.map((a) => a.id));
        for (const a of mine) {
          if (!seen.has(a.id)) {
            seen.add(a.id);
            list.push(a);
          }
        }
        list.sort(
          (a, b) =>
            new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
        );
        list = list.slice(0, pageSize);
      }
    }
  }

  return { data: list, nextCursor, error: null };
}

type MyArtworksOptions = {
  limit?: number;
  /**
   * `forProfileId` (acting-as): when an account-scope delegate operates
   * on behalf of a principal, set this to the principal's profile id so
   * the listing reflects the principal's library. RLS allows the read
   * via the existing select-side delegate policies.
   */
  forProfileId?: string | null;
};

export async function listMyArtworks(
  options: MyArtworksOptions & { publicOnly?: boolean } = {}
): Promise<{ data: ArtworkWithLikes[]; error: unknown }> {
  const { limit = 50, publicOnly = false, forProfileId = null } = options;

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { data: [], error: null };

  const artistId = forProfileId ?? session.user.id;
  let query = supabase
    .from("artworks")
    .select(ARTWORK_SELECT)
    .eq("artist_id", artistId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (publicOnly) {
    query = query.eq("visibility", "public");
  }

  const { data, error } = await query;

  if (error) return { data: [], error };
  return {
    data: (data ?? []).map((r) => normalizeArtworkRow(r as Record<string, unknown>)) as ArtworkWithLikes[],
    error: null,
  };
}

/** Owner library: filters, search, keyset pagination (created_at + id, or likes + created_at + id). */
export type MyLibrarySort = "created_at" | "likes" | "artist_sort";

export type MyLibraryListOptions = {
  limit?: number;
  cursor?: ArtworkCursor | null;
  /** all | public | draft */
  visibility?: "all" | "public" | "draft";
  ownershipStatus?: string | null;
  pricingMode?: string | null;
  search?: string;
  sort?: MyLibrarySort;
  createdBy?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  /** Acting-as principal scope (defaults to session uid when null/omitted). */
  forProfileId?: string | null;
};

export async function listMyArtworksForLibrary(
  options: MyLibraryListOptions = {}
): Promise<{
  data: ArtworkWithLikes[];
  nextCursor: ArtworkCursor | null;
  error: unknown;
}> {
  const {
    limit = 40,
    cursor = null,
    visibility = "all",
    ownershipStatus = null,
    pricingMode = null,
    search = "",
    sort = "created_at",
    createdBy = null,
    dateFrom = null,
    dateTo = null,
    forProfileId = null,
  } = options;

  const pageSize = Math.min(limit, 50);
  const requestLimit = pageSize + 1;

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { data: [], nextCursor: null, error: null };

  const artistId = forProfileId ?? session.user.id;
  let query = supabase
    .from("artworks")
    .select(ARTWORK_SELECT)
    .eq("artist_id", artistId);

  if (visibility === "public") query = query.eq("visibility", "public");
  else if (visibility === "draft") query = query.eq("visibility", "draft");

  if (ownershipStatus) query = query.eq("ownership_status", ownershipStatus);
  if (pricingMode) query = query.eq("pricing_mode", pricingMode);
  if (createdBy) query = query.eq("created_by", createdBy);
  if (search.trim()) query = query.ilike("title", `%${search.trim().replace(/%/g, "\\%")}%`);
  if (dateFrom) query = query.gte("created_at", dateFrom);
  if (dateTo) query = query.lte("created_at", dateTo);

  const isPopular = sort === "likes";
  if (sort === "artist_sort") {
    query = query
      .order("artist_sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
  } else if (isPopular) {
    query = query
      .order("likes_count", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (cursor && cursor.likes_count != null) {
      const lc = Number(cursor.likes_count);
      const createdAt = String(cursor.created_at).replace(/"/g, '\\"');
      const id = String(cursor.id).replace(/"/g, '\\"');
      query = query.or(
        `likes_count.lt.${lc},and(likes_count.eq.${lc},created_at.lt."${createdAt}"),and(likes_count.eq.${lc},created_at.eq."${createdAt}",id.lt."${id}")`
      );
    }
  } else {
    query = query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (cursor?.created_at && cursor?.id) {
      const createdAt = String(cursor.created_at).replace(/"/g, '\\"');
      const id = String(cursor.id).replace(/"/g, '\\"');
      query = query.or(
        `created_at.lt."${createdAt}",and(created_at.eq."${createdAt}",id.lt."${id}")`
      );
    }
  }

  query = query.limit(requestLimit);

  const { data, error } = await query;
  if (error) return { data: [], nextCursor: null, error };

  const list = (data ?? []).map((r) => normalizeArtworkRow(r as Record<string, unknown>)) as ArtworkWithLikes[];
  const resultList = list.length > pageSize ? list.slice(0, pageSize) : list;
  let nextCursor: ArtworkCursor | null = null;
  if (list.length > pageSize && list[pageSize]) {
    const next = list[pageSize];
    if (next.created_at && next.id) {
      nextCursor = {
        created_at: next.created_at,
        id: next.id,
        ...(isPopular && next.likes_count != null && { likes_count: Number(next.likes_count) }),
      };
    }
  }

  return { data: resultList, nextCursor, error: null };
}

type ByArtistOptions = { limit?: number };

export async function listPublicArtworksByArtistId(
  artistId: string,
  options: ByArtistOptions = {}
): Promise<{ data: ArtworkWithLikes[]; error: unknown }> {
  const { limit = 50 } = options;

  const { data, error } = await supabase
    .from("artworks")
    .select(ARTWORK_SELECT)
    .eq("artist_id", artistId)
    .eq("visibility", "public")
    .order("artist_sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return { data: [], error };
  return {
    data: (data ?? [])
      .map((r) => normalizeArtworkRow(r as Record<string, unknown>))
      .filter(isPublicSurfaceVisible) as ArtworkWithLikes[],
    error: null,
  };
}

/** Artworks listed by profile (collector/curator/gallerist: subject in claims). */
export async function listPublicArtworksListedByProfileId(
  profileId: string,
  options: ByArtistOptions = {}
): Promise<{ data: ArtworkWithLikes[]; error: unknown }> {
  const { limit = 50 } = options;

  const { data: claimRows } = await supabase
    .from("claims")
    .select("work_id")
    .eq("subject_profile_id", profileId)
    .not("work_id", "is", null)
    .eq("visibility", "public");

  const workIds = [...new Set((claimRows ?? []).map((r) => r.work_id).filter(Boolean))] as string[];
  if (workIds.length === 0) return { data: [], error: null };

  const { data, error } = await supabase
    .from("artworks")
    .select(ARTWORK_SELECT)
    .in("id", workIds)
    .eq("visibility", "public")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return { data: [], error };
  return {
    data: (data ?? [])
      .map((r) => normalizeArtworkRow(r as Record<string, unknown>))
      .filter(isPublicSurfaceVisible) as ArtworkWithLikes[],
    error: null,
  };
}

/** Artworks for a profile: as artist + as lister. Used for discovery feed. */
export async function listPublicArtworksForProfile(
  profileId: string,
  options: ByArtistOptions = {}
): Promise<{ data: ArtworkWithLikes[]; error: unknown }> {
  const { limit = 6 } = options;
  const [asArtist, asLister] = await Promise.all([
    listPublicArtworksByArtistId(profileId, { limit }),
    listPublicArtworksListedByProfileId(profileId, { limit }),
  ]);
  const seen = new Set<string>();
  const merged: ArtworkWithLikes[] = [];
  const add = (a: ArtworkWithLikes) => {
    if (seen.has(a.id)) return;
    seen.add(a.id);
    merged.push(a);
  };
  (asArtist.data ?? []).forEach(add);
  (asLister.data ?? []).forEach(add);
  merged.sort(
    (a, b) =>
      new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
  );
  return { data: merged.slice(0, limit), error: null };
}

/** Batch update artwork sort order for current user's profile (profile-specific ordering). */
export async function updateMyArtworkOrder(
  orderedIds: string[],
  profileId?: string
): Promise<{ error: unknown }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id)
    return { error: new Error("Not authenticated") };
  if (orderedIds.length === 0) return { error: null };

  const targetProfileId = profileId ?? session.user.id;

  // Verify user has permission for all artworks (either artist or has claim)
  // Fetch artworks with claims to check permissions
  const { data: artworks, error: fetchError } = await supabase
    .from("artworks")
    .select(`
      id,
      artist_id,
      claims(id, subject_profile_id)
    `)
    .in("id", orderedIds);
  
  if (fetchError) return { error: fetchError };
  if (!artworks || artworks.length !== orderedIds.length) {
    return { error: new Error("Some artworks not found or access denied") };
  }

  // Check permissions: user must be artist or have a claim for each artwork
  for (const artwork of artworks) {
    const isArtist = artwork.artist_id === targetProfileId;
    const claims = (artwork.claims ?? []) as Array<{ subject_profile_id: string }>;
    const hasClaim = claims.some((c) => c.subject_profile_id === targetProfileId);
    if (!isArtist && !hasClaim) {
      return { error: new Error("Permission denied for some artworks") };
    }
  }

  // Delete existing profile orders for these artworks
  const { error: deleteError } = await supabase
    .from("profile_artwork_orders")
    .delete()
    .eq("profile_id", targetProfileId)
    .in("artwork_id", orderedIds);
  if (deleteError) return { error: deleteError };

  // Insert new profile-specific orders
  const orders = orderedIds.map((id, idx) => ({
    profile_id: targetProfileId,
    artwork_id: id,
    sort_order: idx,
    updated_at: new Date().toISOString(),
  }));

  const { error: insertError } = await supabase
    .from("profile_artwork_orders")
    .insert(orders);

  if (insertError) return { error: insertError };

  // Also update artist_sort_order if user is the artist (for backward compatibility)
  const artistArtworks = artworks.filter((a) => a.artist_id === targetProfileId);
  if (artistArtworks.length > 0) {
    const artistOrderedIds = orderedIds.filter((id) =>
      artistArtworks.some((a) => a.id === id)
    );
    const artistItems = artistOrderedIds.map((id, idx) => ({ id, idx }));
    const errors: unknown[] = [];
    await runWithLimit(artistItems, async ({ id, idx }) => {
      const { error } = await supabase
        .from("artworks")
        .update({
          artist_sort_order: idx,
          artist_sort_updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("artist_id", targetProfileId);
      if (error) errors.push(error);
    });
    if (errors.length > 0) return { error: errors[0] };
  }

  return { error: null };
}

/** Get profile-specific sort orders for artworks. Returns a map of artwork_id -> sort_order. */
export async function getProfileArtworkOrders(
  profileId: string,
  artworkIds: string[]
): Promise<{ data: Map<string, number>; error: unknown }> {
  if (artworkIds.length === 0) return { data: new Map(), error: null };

  const { data, error } = await supabase
    .from("profile_artwork_orders")
    .select("artwork_id, sort_order")
    .eq("profile_id", profileId)
    .in("artwork_id", artworkIds);

  if (error) return { data: new Map(), error };

  const orderMap = new Map<string, number>();
  (data ?? []).forEach((row) => {
    orderMap.set(row.artwork_id, row.sort_order);
  });

  return { data: orderMap, error: null };
}

/** Apply profile-specific ordering to artworks. Falls back to artist_sort_order if no profile order exists. */
export function applyProfileOrdering(
  artworks: ArtworkWithLikes[],
  profileOrderMap: Map<string, number>
): ArtworkWithLikes[] {
  return [...artworks].sort((a, b) => {
    const aProfileOrder = profileOrderMap.get(a.id);
    const bProfileOrder = profileOrderMap.get(b.id);

    // If both have profile orders, use them
    if (aProfileOrder != null && bProfileOrder != null) {
      return aProfileOrder - bProfileOrder;
    }

    // If only one has profile order, it comes first
    if (aProfileOrder != null) return -1;
    if (bProfileOrder != null) return 1;

    // Fallback to artist_sort_order
    const aArtistOrder = a.artist_sort_order ?? Infinity;
    const bArtistOrder = b.artist_sort_order ?? Infinity;
    if (aArtistOrder !== bArtistOrder) {
      return aArtistOrder - bArtistOrder;
    }

    // Final fallback: created_at (newest first)
    const aTime = new Date(a.created_at ?? 0).getTime();
    const bTime = new Date(b.created_at ?? 0).getTime();
    return bTime - aTime;
  });
}

// MVP: KRW to USD rate - replace with real rate service later
const KRW_TO_USD_RATE =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_KRW_TO_USD_RATE
    ? parseFloat(process.env.NEXT_PUBLIC_KRW_TO_USD_RATE)
    : 0.00075;

export type CreateArtworkPayload = {
  title: string;
  year: number;
  medium: string;
  size: string;
  /** 사용자 입력 단위: 'cm' | 'in' | null */
  size_unit?: "cm" | "in" | null;
  story?: string | null;
  ownership_status: string;
  pricing_mode: "fixed" | "inquire";
  is_price_public?: boolean;
  price_input_amount?: number | null;
  price_input_currency?: string | null;
  /** Override artist (for OWNS/INVENTORY; default = session user) */
  artist_id?: string | null;
};

export async function createArtwork(
  payload: CreateArtworkPayload
): Promise<{ data: string | null; error: unknown }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id)
    return { data: null, error: new Error("Not authenticated") };

  const today = new Date().toISOString().split("T")[0];
  let price_usd: number | null = null;
  let fx_rate_to_usd: number | null = null;
  let fx_date: string | null = null;
  let price_input_amount: number | null = null;
  let price_input_currency: string | null = null;
  let is_price_public = false;

  if (payload.pricing_mode === "fixed" && payload.price_input_amount != null) {
    price_input_amount = payload.price_input_amount;
    price_input_currency = payload.price_input_currency ?? "USD";
    is_price_public = payload.is_price_public ?? false;

    if (price_input_currency === "USD") {
      price_usd = price_input_amount;
      fx_rate_to_usd = 1;
      fx_date = today;
    } else if (price_input_currency === "KRW") {
      fx_rate_to_usd = KRW_TO_USD_RATE;
      price_usd = price_input_amount * fx_rate_to_usd;
      fx_date = today;
    }
  }

  const artistId = payload.artist_id ?? session.user.id;
  const { data, error } = await supabase
    .from("artworks")
    .insert({
      artist_id: artistId,
      created_by: session.user.id,
      title: payload.title,
      year: payload.year,
      medium: payload.medium,
      size: payload.size,
      size_unit: payload.size_unit ?? null,
      story: payload.story ?? null,
      visibility: "public",
      ownership_status: payload.ownership_status,
      pricing_mode: payload.pricing_mode,
      is_price_public,
      price_input_amount,
      price_input_currency,
      fx_rate_to_usd,
      fx_date,
      price_usd,
    })
    .select("id")
    .single();

  if (error) return { data: null, error };
  return { data: (data as { id: string })?.id ?? null, error: null };
}

export async function getArtworkById(
  id: string
): Promise<{ data: ArtworkWithLikes | null; error: unknown }> {
  const { data, error } = await supabase
    .from("artworks")
    .select(
      `
      id,
      title,
      year,
      medium,
      size,
      size_unit,
      story,
      visibility,
      created_by,
      pricing_mode,
      is_price_public,
      price_usd,
      price_input_amount,
      price_input_currency,
      fx_rate_to_usd,
      fx_date,
      ownership_status,
      artist_id,
      artist_sort_order,
      created_at,
      provenance_visible,
      artwork_images(storage_path, sort_order, view_type, display_adjust),
      profiles!artist_id(id, username, display_name, avatar_url, bio, main_role, roles),
      artwork_likes(count),
      claims(id, claim_type, subject_profile_id, artist_profile_id, external_artist_id, created_at, status, period_status, start_date, end_date, profiles!subject_profile_id(username, display_name), external_artists(display_name))
    `
    )
    .eq("id", id)
    .single();

  if (error) return { data: null, error };
  return {
    data: data ? (normalizeArtworkRow(data as Record<string, unknown>) as ArtworkWithLikes) : null,
    error: null,
  };
}

/** Fetch multiple artworks by id (e.g. for exhibition works list). Returns in arbitrary order. */
export async function getArtworksByIds(
  ids: string[]
): Promise<{ data: ArtworkWithLikes[]; error: unknown }> {
  if (ids.length === 0) return { data: [], error: null };
  const { data, error } = await supabase
    .from("artworks")
    .select(
      `
      id,
      title,
      year,
      medium,
      size,
      story,
      visibility,
      pricing_mode,
      is_price_public,
      price_usd,
      price_input_amount,
      price_input_currency,
      fx_rate_to_usd,
      fx_date,
      ownership_status,
      artist_id,
      artist_sort_order,
      created_at,
      provenance_visible,
      artwork_images(storage_path, sort_order, view_type, display_adjust),
      profiles!artist_id(id, username, display_name, avatar_url, bio, main_role, roles),
      artwork_likes(count),
      claims(id, claim_type, subject_profile_id, artist_profile_id, external_artist_id, created_at, status, period_status, start_date, end_date, profiles!subject_profile_id(username, display_name), external_artists(display_name))
    `
    )
    .in("id", ids);

  if (error) return { data: [], error };
  const rows = (data ?? []) as Record<string, unknown>[];
  return {
    data: rows.map((r) => normalizeArtworkRow(r) as ArtworkWithLikes),
    error: null,
  };
}

export async function attachArtworkImage(
  artworkId: string,
  storagePath: string,
  opts?: {
    sortOrder?: number;
    /** QA 2026-06-26 (#5) — perspective tag for the carousel.
     *  Falls back to 'wall_mounted' (the historical implicit value). */
    viewType?: ArtworkImageViewType | string | null;
    /**
     * 2026-07-20 (feed image standardization) — optional per-image
     * display adjustments applied on grid/feed surfaces only. Original
     * storage pixels are never modified. Pass `null` (or omit) to
     * render the original as before.
     */
    displayAdjust?:
      | import("@/lib/image/displayAdjust").DisplayAdjust
      | null;
  },
) {
  const payload: Record<string, unknown> = {
    artwork_id: artworkId,
    storage_path: storagePath,
    sort_order: opts?.sortOrder ?? 0,
    view_type: opts?.viewType ?? "wall_mounted",
  };
  if (opts?.displayAdjust !== undefined) {
    payload.display_adjust = opts.displayAdjust;
  }
  return supabase.from("artwork_images").insert(payload);
}

/**
 * 2026-07-20 (feed image standardization) — patch the `display_adjust`
 * JSON for a specific `artwork_images` row (identified by artwork +
 * storage_path). Pass `null` to reset to "render original".
 */
export async function updateArtworkImageDisplayAdjust(
  artworkId: string,
  storagePath: string,
  displayAdjust:
    | import("@/lib/image/displayAdjust").DisplayAdjust
    | null,
) {
  return supabase
    .from("artwork_images")
    .update({ display_adjust: displayAdjust })
    .eq("artwork_id", artworkId)
    .eq("storage_path", storagePath);
}

export async function deleteArtwork(artworkId: string) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { error: new Error("Not authenticated") };
  // RLS allows delete when artist_id = auth.uid() or user has claim (lister)
  const { error } = await supabase.from("artworks").delete().eq("id", artworkId);
  return { error };
}

/** Delete artwork with cascade: storage files → artwork_images → artworks. Artist or lister (has claim). */
export async function deleteArtworkCascade(
  artworkId: string
): Promise<{ error: unknown }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id)
    return { error: new Error("Not authenticated") };

  // Use getArtworkById to get full artwork with claims (respects RLS properly)
  // Then use canDeleteArtwork to check permission (same logic used in UI)
  const { data: artwork, error: fetchError } = await getArtworkById(artworkId);
  if (fetchError || !artwork) {
    return { error: new Error("Artwork not found") };
  }

  if (!canDeleteArtwork(artwork, session.user.id)) {
    return { error: new Error("Artwork not found or not owned by you") };
  }

  const { data: images } = await supabase
    .from("artwork_images")
    .select("storage_path")
    .eq("artwork_id", artworkId);

  const paths = (images ?? []).map((r) => (r as { storage_path: string }).storage_path);
  if (paths.length > 0) {
    const { error: storageErr } = await removeStorageFiles(paths);
    if (storageErr) {
      const isDev = process.env.NODE_ENV === "development";
      const logPayload = {
        event: "storage_delete_failed",
        artworkId,
        paths,
        error: storageErr instanceof Error ? storageErr.message : String(storageErr),
      };
      if (typeof console !== "undefined") {
        if (isDev) {
          console.warn("[deleteArtworkCascade] Storage delete failed, continuing DB cleanup. Orphan paths:", logPayload);
        } else {
          console.error("[deleteArtworkCascade] storage_delete_failed", JSON.stringify(logPayload));
        }
      }
    }
  }

  const { error: imgErr } = await supabase
    .from("artwork_images")
    .delete()
    .eq("artwork_id", artworkId);
  if (imgErr) return { error: imgErr };

  // Delete artwork (RLS allows if artist or has claim; no need to filter by artist_id here)
  const { error } = await supabase
    .from("artworks")
    .delete()
    .eq("id", artworkId);
  return { error };
}

const CONCURRENCY = 5;
function runWithLimit<T>(items: T[], fn: (x: T) => Promise<unknown>): Promise<void> {
  let idx = 0;
  async function worker(): Promise<void> {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i]);
    }
  }
  const workers = Array(Math.min(CONCURRENCY, items.length)).fill(0).map(() => worker());
  return Promise.all(workers).then(() => {});
}

/** Delete multiple artworks with cascade. Owner-only, concurrency=5. */
export async function deleteArtworksBatch(
  ids: string[],
  options?: { concurrency?: number }
): Promise<{ okIds: string[]; failed: Array<{ id: string; error: unknown }> }> {
  const concurrency = options?.concurrency ?? 5;
  const okIds: string[] = [];
  const failed: Array<{ id: string; error: unknown }> = [];
  const items = ids.map((id) => ({ id }));

  await runWithLimit(items, async ({ id }) => {
    const res = await deleteArtworkCascade(id);
    if (res.error) {
      failed.push({ id, error: res.error });
    } else {
      okIds.push(id);
    }
  });

  return { okIds, failed };
}

/** Delete multiple drafts with cascade. Owner-only, batches with concurrency limit. */
export async function deleteDraftArtworks(
  ids: string[]
): Promise<{ error: unknown }> {
  if (ids.length === 0) return { error: null };
  const errors: unknown[] = [];
  await runWithLimit(ids, async (id) => {
    const res = await deleteArtworkCascade(id);
    if (res.error) errors.push(res.error);
  });
  return { error: errors.length > 0 ? errors[0] : null };
}

export type DraftArtworkPayload = {
  title: string;
};

/** Optional forProfileId: when acting as account delegate, create on behalf of that profile. RLS allows only if caller is delegate. */
export async function createDraftArtwork(
  payload: DraftArtworkPayload,
  options?: { forProfileId?: string }
): Promise<{ data: string | null; error: unknown }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id)
    return { data: null, error: new Error("Not authenticated") };

  const artistId = options?.forProfileId ?? session.user.id;
  const { data, error } = await supabase
    .from("artworks")
    .insert({
      artist_id: artistId,
      created_by: session.user.id,
      title: payload.title || "Untitled",
      visibility: "draft",
      ownership_status: "available",
      pricing_mode: "inquire",
      size: "",
    })
    .select("id")
    .single();

  if (error) return { data: null, error };
  const newArtworkId = (data as { id: string })?.id ?? null;
  await recordUsageEvent({
    userId: session.user.id,
    key: USAGE_KEYS.ARTWORK_UPLOADED,
    metadata: {
      artwork_id: newArtworkId,
      artist_id: artistId,
      acting_as: options?.forProfileId && options.forProfileId !== session.user.id,
    },
  });
  if (options?.forProfileId && options.forProfileId !== session.user.id && newArtworkId) {
    await recordActingContextEvent({
      subjectProfileId: options.forProfileId,
      action: "artwork.create_draft",
      resourceType: "artwork",
      resourceId: newArtworkId,
      payload: { title: payload.title ?? null },
    });
  }
  return { data: newArtworkId, error: null };
}

export type UpdateArtworkPayload = Partial<{
  title: string | null;
  year: number | null;
  medium: string | null;
  size: string | null;
  size_unit: "cm" | "in" | null;
  story: string | null;
  ownership_status: string | null;
  pricing_mode: "fixed" | "inquire" | null;
  is_price_public: boolean;
  price_input_amount: number | null;
  price_input_currency: string | null;
  visibility: "draft" | "public";
  artist_id: string | null;
  provenance_visible?: boolean | null;
  website_import_provenance?: Record<string, unknown> | null;
}>;

export async function updateArtwork(
  id: string,
  partial: UpdateArtworkPayload,
  options?: {
    /**
     * When the operator is acting-as a principal, callers should pass
     * the principal's profile id here. We use it (a) to filter the
     * audit insert to genuine delegated mutations and (b) to log the
     * change keys so the principal can review what was edited from
     * their delegation activity drawer. Best-effort; never blocks UX.
     */
    actingSubjectProfileId?: string | null;
    /** Override audit action label, e.g. "bulk.artwork.update". */
    auditAction?: "artwork.update" | "bulk.artwork.update";
  }
): Promise<{ error: unknown }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id)
    return { error: new Error("Not authenticated") };

  // RLS allows update when artist or lister (has claim)
  const { error } = await supabase.from("artworks").update(partial).eq("id", id);

  if (
    !error &&
    options?.actingSubjectProfileId &&
    options.actingSubjectProfileId !== session.user.id
  ) {
    await recordActingContextEvent({
      subjectProfileId: options.actingSubjectProfileId,
      action: options.auditAction ?? "artwork.update",
      resourceType: "artwork",
      resourceId: id,
      payload: { changedKeys: Object.keys(partial) },
    });
  }

  return { error };
}

export async function listMyDraftArtworks(
  options: { limit?: number; forProfileId?: string | null } = {}
): Promise<{ data: ArtworkWithLikes[]; error: unknown }> {
  const { limit = 100, forProfileId } = options;

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { data: [], error: null };

  const artistFilter = forProfileId && forProfileId !== session.user.id ? forProfileId : session.user.id;

  const { data, error } = await supabase
    .from("artworks")
    .select(ARTWORK_SELECT)
    .eq("artist_id", artistFilter)
    .eq("visibility", "draft")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return { data: [], error };
  return {
    data: (data ?? []).map((r) => normalizeArtworkRow(r as Record<string, unknown>)) as ArtworkWithLikes[],
    error: null,
  };
}

export function validatePublish(artwork: Artwork): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!artwork.title?.trim()) missing.push("title");
  if (!artwork.ownership_status) missing.push("ownership_status");
  if (!artwork.pricing_mode) missing.push("pricing_mode");
  const images = artwork.artwork_images ?? [];
  if (images.length < 1) missing.push("image");
  return { ok: missing.length === 0, missing };
}

export async function publishArtworks(
  ids: string[],
  options?: { forProfileId?: string | null }
): Promise<{ error: unknown }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id)
    return { error: new Error("Not authenticated") };
  if (ids.length === 0) return { error: null };

  // When acting-as, drafts were created under the principal's `artist_id`,
  // so filter on that. Otherwise default to the caller. RLS independently
  // enforces that the caller is either the artist or an active account
  // delegate writer for the principal.
  const artistFilter = options?.forProfileId ?? session.user.id;
  const { error } = await supabase
    .from("artworks")
    .update({ visibility: "public" })
    .eq("artist_id", artistFilter)
    .in("id", ids)
    .eq("visibility", "draft");

  if (
    !error &&
    options?.forProfileId &&
    options.forProfileId !== session.user.id &&
    ids.length > 0
  ) {
    // Best-effort audit so the principal sees a "bulk publish" entry in
    // their delegation activity drawer. We log per-id to keep the
    // resource_id usable for downstream linking. Failures are swallowed.
    for (const id of ids) {
      await recordActingContextEvent({
        subjectProfileId: options.forProfileId,
        action: "artwork.publish",
        resourceType: "artwork",
        resourceId: id,
        payload: null,
      });
    }
  }

  return { error };
}

export type PublishWithProvenanceOptions = {
  intent: "CREATED" | "OWNS" | "INVENTORY" | "CURATED";
  artistProfileId?: string | null;
  externalArtistDisplayName?: string | null;
  externalArtistEmail?: string | null;
  /** For INVENTORY/CURATED/EXHIBITED: past/current/future */
  period_status?: "past" | "current" | "future" | null;
  /**
   * Acting-as override. When the caller is operating as an account-scope
   * delegate of `onBehalfOfProfileId`, the drafts were created under that
   * principal's `artist_id` and any CREATED-class claim must be filed
   * under them. Server-side RPCs / RLS still enforce the delegation
   * writer check before honouring this.
   */
  onBehalfOfProfileId?: string | null;
};

export type PublishWithProvenanceResult = {
  /** Per-work outcome (in input order). */
  results: Array<{ id: string; ok: true } | { id: string; ok: false; error: unknown }>;
  /** Convenience: id of first failure, if any. */
  firstError?: unknown;
  /** Set to a single error when the call could not start at all
   *  (e.g. unauthenticated). For per-work failures, see `results`. */
  error: unknown;
  inviteSent?: boolean;
  inviteFailed?: boolean;
};

/**
 * Publish a batch of draft artworks, filing the matching provenance
 * claim per work. Returns per-work outcomes so the caller can show a
 * partial-success summary ("3 of 5 published, 2 failed: …") instead of
 * an opaque "Publish failed" toast.
 *
 * QA 2026-06-26 (#8) — the previous implementation passed both
 * `workId` and `projectId` to the claim RPC, which the server rejects
 * with `exactly one of work_id, project_id required`. That is why
 * every CURATED bulk publish from "전시 → 작품 추가 → 일괄 업로드"
 * silently failed and left drafts behind. We now file work-scoped
 * claims only; exhibition wiring is the caller's job via
 * `addWorkToExhibition`, exactly mirroring the single-upload flow.
 */
export async function publishArtworksWithProvenance(
  ids: string[],
  opts: PublishWithProvenanceOptions
): Promise<PublishWithProvenanceResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) {
    const err = new Error("Not authenticated");
    return { results: [], error: err, firstError: err };
  }
  if (ids.length === 0) return { results: [], error: null };

  const { createClaimForExistingArtist, createExternalArtistAndClaim } = await import("@/lib/provenance/rpc");

  const claimPayload: { period_status?: "past" | "current" | "future" } = {};
  if (opts.intent === "INVENTORY" || opts.intent === "CURATED") {
    if (opts.period_status != null) claimPayload.period_status = opts.period_status;
  }
  // When acting-as, both the CREATED-class claim's artist *and* subject
  // must point at the principal. Without this, the artwork's artist_id
  // pointed to the principal but the claim subject pointed to the
  // operator — leaving the work simultaneously on two profiles.
  const subjectOverride = opts.onBehalfOfProfileId ?? null;

  const results: PublishWithProvenanceResult["results"] = [];
  let firstError: unknown = undefined;

  for (const id of ids) {
    let claimErr: unknown = null;
    if (opts.intent === "CREATED") {
      const { error } = await createClaimForExistingArtist({
        artistProfileId: subjectOverride ?? session.user.id,
        claimType: "CREATED",
        workId: id,
        visibility: "public",
        subjectProfileId: subjectOverride ?? undefined,
      });
      claimErr = error;
    } else if (opts.externalArtistDisplayName) {
      const { error } = await createExternalArtistAndClaim({
        displayName: opts.externalArtistDisplayName,
        inviteEmail: opts.externalArtistEmail ?? null,
        claimType: opts.intent,
        workId: id,
        // QA 2026-06-26 (#8) — DO NOT pass projectId here. Exhibition
        // linking happens after publish via addWorkToExhibition.
        visibility: "public",
        ...claimPayload,
        subjectProfileId: subjectOverride ?? undefined,
      });
      claimErr = error;
    } else if (opts.artistProfileId) {
      const { error } = await createClaimForExistingArtist({
        artistProfileId: opts.artistProfileId,
        claimType: opts.intent,
        workId: id,
        // QA 2026-06-26 (#8) — see note above.
        visibility: "public",
        ...claimPayload,
        subjectProfileId: subjectOverride ?? undefined,
      });
      claimErr = error;
      if (!claimErr) {
        const { error: upErr } = await supabase
          .from("artworks")
          .update({ artist_id: opts.artistProfileId })
          .eq("id", id);
        if (upErr) claimErr = upErr;
      }
    }

    if (claimErr) {
      results.push({ id, ok: false, error: claimErr });
      if (firstError === undefined) firstError = claimErr;
      continue;
    }

    // Only flip to public when the claim landed. A failed claim leaves
    // the artwork as `draft` so the user can fix the cause and retry
    // exactly the failed entries (instead of silently shipping
    // half-attributed work to the public feed).
    const { error: pubErr } = await supabase
      .from("artworks")
      .update({ visibility: "public" })
      .eq("id", id)
      .eq("visibility", "draft");
    if (pubErr) {
      results.push({ id, ok: false, error: pubErr });
      if (firstError === undefined) firstError = pubErr;
      continue;
    }
    results.push({ id, ok: true });
  }

  let inviteSent = false;
  let inviteFailed = false;
  if (opts.externalArtistEmail?.trim() && opts.externalArtistDisplayName) {
    const { sendMagicLink } = await import("@/lib/supabase/auth");
    const { error: inviteErr } = await sendMagicLink(opts.externalArtistEmail.trim());
    inviteSent = !inviteErr;
    if (inviteErr) inviteFailed = true;
  }
  return { results, firstError, error: null, inviteSent, inviteFailed };
}

export async function recordArtworkView(artworkId: string) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) return { error: new Error("Not authenticated") };
  return supabase.from("artwork_views").insert({
    artwork_id: artworkId,
    viewer_id: session.user.id,
  });
}
