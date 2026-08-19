/**
 * P1 Display / Hang Simulation — spaces CRUD + loaders.
 *
 * Reuses the project's client pattern: `import { supabase } from "./client"`
 * gives us the RLS-scoped anon client for both browser and server
 * components (server routes that hold their own JWT can pass a
 * `SupabaseClient` via the `client` field where accepted). Mirrors
 * `src/lib/supabase/shortlists.ts` which is the closest existing lib
 * (parent → children with owner-scoped RLS + share-token public view).
 *
 * Every mutation runs through `resolveEntitlementFor` so simulation is
 * gated by the same spine the rest of the app uses:
 *   • `simulation.2d`        → space create / edit (`space.created` counted).
 *   • `simulation.2d.export` → share/export (`render.exported` counted).
 *
 * `getSpaceByShareToken` deliberately only reads columns already
 * exposed on the public artwork surface (title, image, dims) so a
 * shared space cannot leak private drafts even if a placement points
 * at an artwork the artist later hid. Reuses
 * `src/lib/supabase/artworks.ts` conventions.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase as defaultClient } from "./client";
import { getArtworkImageUrl } from "./artworks";
import { recordUsageEvent } from "@/lib/metering";
import { USAGE_KEYS } from "@/lib/metering/usageKeys";
import {
  resolveEntitlementFor,
  type EntitlementDecision,
  type FeatureKey,
} from "@/lib/entitlements";
import { pickLocalizedArtworkTitle } from "@/lib/i18n/pickLocalized";
import type { Locale } from "@/lib/i18n/locale";
import {
  rowToScenePlacement,
  rowToSceneSpace,
  scenePlacementUpsertToRow,
  sceneSpaceInsertToRow,
  sceneSpaceUpdateToRow,
  sceneSurfaceInsertToRow,
  sceneSurfaceUpdateToRow,
  type ArtworkThumbForScene,
  type ScenePlacement,
  type SceneSpace,
  type SceneSpaceUpdate,
  type ScenePlacementUpsert,
  type SceneSurfaceUpdate,
  type SpaceKind,
} from "@/lib/simulation/scene";

/**
 * 2026-08-19 (personal cutouts fix) — per-user cutout row shape,
 * used to overlay the current viewer's private cutouts on top of the
 * artist-published `artwork_images` rows in the renderer.
 */
type PersonalCutoutRow = {
  artwork_id: string;
  view_type: "cutout" | "cutout_alpha" | string;
  storage_path: string;
  px_width: number | null;
  px_height: number | null;
};

// ─── Errors ─────────────────────────────────────────────────────────

/**
 * Thrown when the entitlement resolver rejects a simulation mutation.
 * UI consumers should catch and render the paywall CTA — the
 * `decision.paywallHint` carries the recommended upgrade plan.
 */
export class SimulationEntitlementError extends Error {
  readonly decision: EntitlementDecision;
  constructor(decision: EntitlementDecision, message?: string) {
    super(
      message ??
        `SimulationEntitlementError: ${decision.featureKey} blocked (${decision.source})`,
    );
    this.name = "SimulationEntitlementError";
    this.decision = decision;
  }
}

// ─── Local types ────────────────────────────────────────────────────

/** Full scene payload consumed by the editor + share view. */
export type SpaceScene = {
  space: SceneSpace;
  /** Keyed by `artwork_id` — the exact shape `renderScene2D` expects. */
  artworks: Map<string, ArtworkThumbForScene>;
};

/** Loader options common to server and client. */
type LoaderOptions = {
  client?: SupabaseClient;
  /** Locale for artwork title picking (defaults to `"en"` for shared views). */
  locale?: Locale;
};

// ─── Internal helpers ───────────────────────────────────────────────

const SPACE_SELECT = `
  id,
  owner_id,
  title,
  kind,
  unit,
  source_shortlist_id,
  width_cm,
  height_cm,
  depth_cm,
  photo_storage_path,
  photo_original_storage_path,
  photo_width_px,
  photo_height_px,
  share_token,
  is_active,
  expires_at,
  created_at,
  updated_at,
  space_surfaces(
    id, space_id, role, surface_index, width_cm, height_cm, photo_corners, pose, created_at
  ),
  space_placements(
    id, space_id, surface_id, artwork_id,
    x_cm, y_cm, z_cm, rot_x_deg, rot_y_deg, rot_z_deg,
    width_cm, height_cm, depth_cm, z_order, created_at, updated_at
  )
`;

/**
 * The set of artwork columns that are safe to include on a **public**
 * share view. Nothing more than what already ships in
 * `artworks_select_public` (title / image / bilingual pair /
 * dimensions / work_form). No pricing, no ownership, no story text.
 *
 * `artwork_images.width` / `.height` are the source-file pixel
 * dimensions (populated by the auto-compression pass in
 * `20260728100000_artwork_images_auto_compression.sql`; NULL for
 * pre-compression legacy rows). The 2D renderer uses them to warn
 * when the image aspect disagrees with the placement's physical
 * aspect — a strong signal that the upload contains background
 * padding around the painting.
 */
const PUBLIC_ARTWORK_SELECT = `
  id,
  title,
  title_ko,
  title_en,
  visibility,
  work_form,
  width_cm,
  height_cm,
  depth_cm,
  artwork_images(storage_path, sort_order, view_type, width, height)
`;

/**
 * Display Simulation Phase 2 (2026-08-20) — which `view_type` rows
 * the renderer wants. The DB check constraint allows more values
 * (`detail`, `angle`, `in_situ`, `other`) but those are UI-only
 * variants for the artwork detail carousel; the simulation renderer
 * never uses them, so we filter client-side to keep the payload small
 * and the row-picker unambiguous.
 */
const RENDERER_VIEW_TYPES = new Set<string>([
  "wall_mounted",
  "cutout",
  "cutout_alpha",
]);

/**
 * Owner-side artwork columns — same shape as above (we do NOT read
 * pricing / claims / story here even for the owner, because the
 * renderer just needs a thumbnail). Kept as a separate constant so we
 * can widen it later (e.g. for a private-only "hidden" tag) without
 * touching the public path.
 */
const OWNER_ARTWORK_SELECT = PUBLIC_ARTWORK_SELECT;

type RawArtworkRow = {
  id: string;
  title: string | null;
  title_ko: string | null;
  title_en: string | null;
  visibility: string | null;
  work_form:
    | "flat_2d"
    | "relief"
    | "sculpture_3d"
    | "installation"
    | "time_based"
    | null;
  width_cm: number | null;
  height_cm: number | null;
  depth_cm: number | null;
  artwork_images:
    | {
        storage_path: string | null;
        sort_order: number | null;
        view_type?: string | null;
        width?: number | null;
        height?: number | null;
      }[]
    | null;
};

type ArtworkImageRow = NonNullable<RawArtworkRow["artwork_images"]>[number];

function safePx(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Pick the primary display row (`view_type='wall_mounted'` or
 * legacy default) plus, when present, the Phase 2 cutout sibling
 * rows. We filter by `RENDERER_VIEW_TYPES` so a detail crop or
 * in-situ shot never accidentally shows up as the placement image.
 * Returns `null` for each slot when no matching row exists.
 */
function pickRendererImages(row: RawArtworkRow): {
  primary: ArtworkImageRow | null;
  cutout: ArtworkImageRow | null;
  cutoutAlpha: ArtworkImageRow | null;
} {
  const imgs = Array.isArray(row.artwork_images)
    ? row.artwork_images.filter((r): r is ArtworkImageRow => !!r)
    : [];
  const sorted = [...imgs].sort(
    (a, b) => (a?.sort_order ?? 0) - (b?.sort_order ?? 0),
  );
  let primary: ArtworkImageRow | null = null;
  let cutout: ArtworkImageRow | null = null;
  let cutoutAlpha: ArtworkImageRow | null = null;
  for (const r of sorted) {
    const vt = typeof r.view_type === "string" ? r.view_type : null;
    if (vt === "cutout_alpha") {
      if (!cutoutAlpha) cutoutAlpha = r;
    } else if (vt === "cutout") {
      if (!cutout) cutout = r;
    } else if (vt == null || RENDERER_VIEW_TYPES.has(vt) || vt === "wall_mounted") {
      if (!primary) primary = r;
    }
  }
  // If no explicitly `wall_mounted` row exists (very old data), fall
  // back to the first sort_order row so the placement still renders.
  if (!primary && sorted.length > 0) {
    const firstNonCutout = sorted.find(
      (r) => r.view_type !== "cutout" && r.view_type !== "cutout_alpha",
    );
    primary = firstNonCutout ?? sorted[0] ?? null;
  }
  return { primary, cutout, cutoutAlpha };
}

/**
 * 2026-08-19 (personal cutouts fix) — merge the current viewer's
 * private cutouts on top of the artist-published rows. Personal wins
 * when both exist for the same view_type (Track 1 or Track 2).
 */
function overlayPersonalCutouts(
  base: {
    cutout: ArtworkImageRow | null;
    cutoutAlpha: ArtworkImageRow | null;
  },
  personal: PersonalCutoutRow[] | undefined,
): { cutout: ArtworkImageRow | null; cutoutAlpha: ArtworkImageRow | null } {
  if (!personal || personal.length === 0) return base;
  let cutout = base.cutout;
  let cutoutAlpha = base.cutoutAlpha;
  for (const p of personal) {
    if (!p?.storage_path) continue;
    const asRow: ArtworkImageRow = {
      storage_path: p.storage_path,
      sort_order: null,
      view_type: p.view_type,
      width: p.px_width,
      height: p.px_height,
    };
    if (p.view_type === "cutout_alpha") cutoutAlpha = asRow;
    else if (p.view_type === "cutout") cutout = asRow;
  }
  return { cutout, cutoutAlpha };
}

function rowToArtworkThumb(
  row: RawArtworkRow,
  locale: Locale,
  personalCutouts?: PersonalCutoutRow[],
): ArtworkThumbForScene {
  const picked = pickRendererImages(row);
  const merged = overlayPersonalCutouts(
    { cutout: picked.cutout, cutoutAlpha: picked.cutoutAlpha },
    personalCutouts,
  );
  const primaryPath = picked.primary?.storage_path ?? null;
  const cutoutPath = merged.cutout?.storage_path ?? null;
  const cutoutAlphaPath = merged.cutoutAlpha?.storage_path ?? null;
  return {
    id: row.id,
    title: pickLocalizedArtworkTitle(row, locale),
    imageUrl: primaryPath ? getArtworkImageUrl(primaryPath, "medium") : null,
    widthCm: row.width_cm,
    heightCm: row.height_cm,
    depthCm: row.depth_cm,
    imagePxWidth: safePx(picked.primary?.width),
    imagePxHeight: safePx(picked.primary?.height),
    // Phase 2 (2026-08-20) — additive cutout URLs. Renderer prefers
    // cutout_alpha > cutout > primary; consumers can also branch on
    // these to suppress warnings that only apply to the padded
    // primary (e.g. the aspect-mismatch banner).
    //
    // 2026-08-19 (personal cutouts fix) — personal (viewer-private)
    // cutouts overlay the artist-published rows so non-artist Space
    // owners see their own Track 1 / Track 2 results even though RLS
    // stops them from writing to `artwork_images` globally.
    cutoutImageUrl: cutoutPath ? getArtworkImageUrl(cutoutPath, "medium") : null,
    cutoutImagePxWidth: safePx(merged.cutout?.width),
    cutoutImagePxHeight: safePx(merged.cutout?.height),
    cutoutAlphaImageUrl: cutoutAlphaPath
      ? getArtworkImageUrl(cutoutAlphaPath, "medium")
      : null,
    cutoutAlphaImagePxWidth: safePx(merged.cutoutAlpha?.width),
    cutoutAlphaImagePxHeight: safePx(merged.cutoutAlpha?.height),
    workForm: row.work_form ?? "flat_2d",
  };
}

/**
 * 2026-08-19 (personal cutouts fix) — fetch the current session
 * user's rows from `artwork_user_cutouts` for the given artwork ids.
 * RLS enforces the `user_id = auth.uid()` filter so we can omit it
 * on the client. Returns a map keyed by `artwork_id → rows[]` (both
 * `cutout` and `cutout_alpha` may co-exist per artwork).
 *
 * Anonymous callers skip this entirely — the table has no `anon`
 * grants, and public-share views should not leak personal touch-ups.
 */
async function fetchPersonalCutouts(
  client: SupabaseClient,
  artworkIds: string[],
): Promise<Map<string, PersonalCutoutRow[]>> {
  const out = new Map<string, PersonalCutoutRow[]>();
  if (artworkIds.length === 0) return out;
  const {
    data: { session },
  } = await client.auth.getSession();
  if (!session?.user?.id) return out;
  const uniq = Array.from(new Set(artworkIds));
  const { data, error } = await client
    .from("artwork_user_cutouts")
    .select("artwork_id, view_type, storage_path, px_width, px_height")
    .in("artwork_id", uniq);
  if (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[spaces] fetchPersonalCutouts failed", error.message);
    }
    return out;
  }
  for (const row of (data ?? []) as PersonalCutoutRow[]) {
    const list = out.get(row.artwork_id) ?? [];
    list.push(row);
    out.set(row.artwork_id, list);
  }
  return out;
}

/**
 * Phase 3 (2026-08-19) — light-weight refetch of a single artwork's
 * scene-thumb, used after silent Track 1 auto-crop lands a new
 * `cutout` sibling row. Replaces the ex-`await load()` full-space
 * hydration path so the editor never blinks. Uses `OWNER_ARTWORK_SELECT`
 * because the caller is always the space owner (RLS is enforced
 * server-side; a non-owner never lands in this editor).
 */
export async function getArtworkSceneThumb(
  artworkId: string,
  options: LoaderOptions = {},
): Promise<{ data: ArtworkThumbForScene | null; error: unknown }> {
  const client = options.client ?? defaultClient;
  const locale = options.locale ?? "en";
  const { data, error } = await client
    .from("artworks")
    .select(OWNER_ARTWORK_SELECT)
    .eq("id", artworkId)
    .maybeSingle();
  if (error) return { data: null, error };
  if (!data) return { data: null, error: null };
  // 2026-08-19 (personal cutouts fix) — refetch may fire right after
  // a non-artist viewer lands a personal cutout; overlay their private
  // rows so the aspect-snap + toast logic upstream sees the fresh URL.
  const personalMap = await fetchPersonalCutouts(client, [artworkId]);
  return {
    data: rowToArtworkThumb(
      data as unknown as RawArtworkRow,
      locale,
      personalMap.get(artworkId),
    ),
    error: null,
  };
}

async function fetchArtworkThumbs(
  client: SupabaseClient,
  artworkIds: string[],
  selectCols: string,
  locale: Locale,
  publicOnly: boolean,
  /**
   * 2026-08-19 (personal cutouts fix) — when true, overlay the
   * caller's `artwork_user_cutouts` rows on top of the global
   * `artwork_images` rows. Set to false for the public share path
   * so anonymous viewers never see a personal touch-up.
   */
  includePersonalCutouts = false,
): Promise<Map<string, ArtworkThumbForScene>> {
  const out = new Map<string, ArtworkThumbForScene>();
  if (artworkIds.length === 0) return out;
  const uniq = Array.from(new Set(artworkIds));
  let q = client.from("artworks").select(selectCols).in("id", uniq);
  if (publicOnly) q = q.eq("visibility", "public");
  const { data, error } = await q;
  if (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[spaces] fetchArtworkThumbs failed", error.message);
    }
    return out;
  }
  const personalMap = includePersonalCutouts
    ? await fetchPersonalCutouts(client, uniq)
    : new Map<string, PersonalCutoutRow[]>();
  for (const row of (data ?? []) as unknown as RawArtworkRow[]) {
    out.set(row.id, rowToArtworkThumb(row, locale, personalMap.get(row.id)));
  }
  return out;
}

async function assertEntitlementOrThrow(
  featureKey: FeatureKey,
  userId: string,
  client: SupabaseClient,
): Promise<EntitlementDecision> {
  const decision = await resolveEntitlementFor({
    featureKey,
    userId,
    client,
  });
  if (!decision.allowed) throw new SimulationEntitlementError(decision);
  return decision;
}

async function requireSessionUserId(client: SupabaseClient): Promise<string> {
  const {
    data: { session },
  } = await client.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Not authenticated");
  return userId;
}

/** Utility: bump `spaces.updated_at` so listMySpaces order stays fresh. */
async function touchSpace(client: SupabaseClient, spaceId: string): Promise<void> {
  const { error } = await client
    .from("spaces")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", spaceId);
  if (error && process.env.NODE_ENV !== "production") {
    console.warn("[spaces] touchSpace failed", error.message);
  }
}

// ─── Listing / loading ──────────────────────────────────────────────

/**
 * List the caller's own spaces, ordered by `updated_at desc`.
 * `is_active=false` (soft-deleted) rows are excluded. Header-only —
 * surfaces and placements are not embedded (heavier joins are only
 * for `getSpaceById`).
 */
export async function listMySpaces(
  options: LoaderOptions & { forProfileId?: string | null } = {},
): Promise<{ data: SceneSpace[]; error: unknown }> {
  const client = options.client ?? defaultClient;
  const {
    data: { session },
  } = await client.auth.getSession();
  if (!session?.user?.id) return { data: [], error: null };
  const ownerId = options.forProfileId ?? session.user.id;
  const { data, error } = await client
    .from("spaces")
    .select(SPACE_SELECT)
    .eq("owner_id", ownerId)
    .eq("is_active", true)
    .order("updated_at", { ascending: false });
  if (error) return { data: [], error };
  return {
    data: (data ?? []).map((r) => rowToSceneSpace(r as Record<string, unknown>)),
    error: null,
  };
}

/**
 * Get a full scene the caller owns (RLS enforced). Returns `null`
 * when the id is unknown OR the caller doesn't own it.
 */
export async function getSpaceById(
  id: string,
  options: LoaderOptions = {},
): Promise<{ data: SpaceScene | null; error: unknown }> {
  const client = options.client ?? defaultClient;
  const locale = options.locale ?? "en";
  const { data, error } = await client
    .from("spaces")
    .select(SPACE_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) return { data: null, error };
  if (!data) return { data: null, error: null };
  const space = rowToSceneSpace(data as Record<string, unknown>);
  const artworkIds = space.placements.map((p) => p.artworkId);
  const artworks = await fetchArtworkThumbs(
    client,
    artworkIds,
    OWNER_ARTWORK_SELECT,
    locale,
    /* publicOnly */ false,
    /* includePersonalCutouts */ true,
  );
  return { data: { space, artworks }, error: null };
}

/**
 * Fetch a scene by its opaque share token. Works for both anonymous
 * and authenticated callers.
 *
 * Backed by the `public.get_space_by_share_token(uuid)` SECURITY
 * DEFINER RPC (migration `20260818100000_space_share_rpc.sql`) —
 * the `spaces` / `space_surfaces` / `space_placements` tables are
 * closed to anon RLS to prevent share_token enumeration, so we
 * pivot on a challenge-response function that requires the caller
 * to already know the token.
 *
 * Gating (`is_active = true` AND `expires_at IS NULL OR expires_at
 * > now()`) and artwork public-only filtering both live inside the
 * RPC; the client just deserializes the payload with the same
 * `rowToSceneSpace` / `rowToArtworkThumb` helpers as `getSpaceById`.
 * The placement row itself is still returned so the UI can say
 * "this artwork is no longer available" if the join drops.
 */
export async function getSpaceByShareToken(
  token: string,
  options: LoaderOptions = {},
): Promise<{ data: SpaceScene | null; error: unknown }> {
  const client = options.client ?? defaultClient;
  const locale = options.locale ?? "en";
  const { data, error } = await client.rpc("get_space_by_share_token", {
    _token: token,
  });
  if (error) return { data: null, error };
  if (data == null) return { data: null, error: null };
  const payload = data as {
    space_row?: Record<string, unknown> | null;
    artwork_rows?: RawArtworkRow[] | null;
  };
  if (!payload.space_row) return { data: null, error: null };
  const space = rowToSceneSpace(payload.space_row);
  const artworks = new Map<string, ArtworkThumbForScene>();
  for (const row of payload.artwork_rows ?? []) {
    artworks.set(row.id, rowToArtworkThumb(row, locale));
  }
  return { data: { space, artworks }, error: null };
}

// ─── Creation ───────────────────────────────────────────────────────

export type CreateSpaceOptions = {
  title: string;
  kind?: SpaceKind;
  client?: SupabaseClient;
};

/**
 * Create an empty space (no seeded placements) after the resolver
 * green-lights `simulation.2d`. Emits `simulation.space.created` on
 * success so the lifetime ceiling counts it.
 *
 * A single `role='wall'` surface (`surface_index=0`) is seeded eagerly
 * — every editor handler (wall-dims input, tap-to-place, AI apply)
 * dereferences `state.space.surfaces[0]`, so without a seeded row
 * the whole editor no-ops. `widthCm` / `heightCm` / `photoCorners`
 * are left null so the user still calibrates via the AI card or the
 * manual "정확한 스케일" flow (unlike the shortlist path which seeds
 * a fallback quad because it opens straight into a placement layout).
 * If the surface insert fails, we roll the space insert back so the
 * caller never observes a half-created scene.
 */
export async function createEmptySpace(
  options: CreateSpaceOptions,
): Promise<{ data: SceneSpace | null; error: unknown }> {
  const client = options.client ?? defaultClient;
  const userId = await requireSessionUserId(client);
  await assertEntitlementOrThrow("simulation.2d", userId, client);

  const insertRow = sceneSpaceInsertToRow({
    ownerId: userId,
    title: options.title,
    kind: options.kind ?? "room_photo_2d",
  });
  const { data, error } = await client
    .from("spaces")
    .insert(insertRow)
    .select(SPACE_SELECT)
    .single();
  if (error) return { data: null, error };

  const space = rowToSceneSpace(data as Record<string, unknown>);

  const surfaceRow = sceneSurfaceInsertToRow({
    spaceId: space.id,
    role: "wall",
    surfaceIndex: 0,
    widthCm: null,
    heightCm: null,
    photoCorners: null,
  });
  const { error: surfaceErr } = await client
    .from("space_surfaces")
    .insert(surfaceRow);
  if (surfaceErr) {
    // Roll back the parent space so we never leave the caller with a
    // headless space (which would silently no-op every editor handler).
    await client.from("spaces").delete().eq("id", space.id);
    return { data: null, error: surfaceErr };
  }

  await recordUsageEvent(
    {
      userId,
      key: USAGE_KEYS.SIMULATION_SPACE_CREATED,
      featureKey: "simulation.2d",
      metadata: { space_id: space.id, kind: space.kind, seeded_from: null },
    },
    { client },
  );

  // Re-select so the returned scene carries the seeded surface (the
  // initial insert response was captured before the child row landed).
  const { data: finalRow, error: finalErr } = await client
    .from("spaces")
    .select(SPACE_SELECT)
    .eq("id", space.id)
    .single();
  if (finalErr) return { data: space, error: null };
  return {
    data: rowToSceneSpace(finalRow as Record<string, unknown>),
    error: null,
  };
}

export type CreateFromShortlistOptions = {
  title?: string;
  client?: SupabaseClient;
  /**
   * Locale for the auto-picked title fallback when the caller omits
   * `title` and the shortlist has bilingual naming. Defaults to `"en"`.
   */
  locale?: Locale;
};

/**
 * Seed a new space from a shortlist:
 *   1. Copy the shortlist title (or the caller-supplied `title`).
 *   2. Insert one `role='wall'` surface (`surface_index = 0`).
 *   3. Copy each item's `artwork_id` into a placement with
 *      `z_order = position` and evenly spaced x offsets so the
 *      editor opens on a non-degenerate layout.
 *   4. Emit `simulation.space.created`.
 *
 * `source_shortlist_id` is stamped on the space so future edits know
 * where it came from (shortlist deletes set the FK to null).
 */
export async function createSpaceFromShortlist(
  shortlistId: string,
  options: CreateFromShortlistOptions = {},
): Promise<{ data: SceneSpace | null; error: unknown }> {
  const client = options.client ?? defaultClient;
  const userId = await requireSessionUserId(client);
  await assertEntitlementOrThrow("simulation.2d", userId, client);

  // Read shortlist header + item order from the tables directly —
  // RLS already scopes it to boards the caller can read (owner /
  // collaborator / public if room_active). We only need the artwork
  // ids and order, so we don't route through `getRoomByToken`.
  const { data: shortlistRow, error: shortlistErr } = await client
    .from("shortlists")
    .select("id, title, owner_id")
    .eq("id", shortlistId)
    .maybeSingle();
  if (shortlistErr) return { data: null, error: shortlistErr };
  if (!shortlistRow) return { data: null, error: new Error("Shortlist not found") };
  const { data: itemsRaw, error: itemsErr } = await client
    .from("shortlist_items")
    .select("id, artwork_id, position, created_at")
    .eq("shortlist_id", shortlistId)
    .not("artwork_id", "is", null)
    .order("position")
    .order("created_at");
  if (itemsErr) return { data: null, error: itemsErr };
  const items = (itemsRaw ?? []) as {
    id: string;
    artwork_id: string;
    position: number;
    created_at: string;
  }[];

  const title = options.title?.trim() || shortlistRow.title || "Untitled space";

  const insertRow = sceneSpaceInsertToRow({
    ownerId: userId,
    title,
    kind: "room_photo_2d",
    sourceShortlistId: shortlistId,
  });
  const { data: spaceRow, error: spaceErr } = await client
    .from("spaces")
    .insert(insertRow)
    .select(SPACE_SELECT)
    .single();
  if (spaceErr) return { data: null, error: spaceErr };
  const space = rowToSceneSpace(spaceRow as Record<string, unknown>);

  // Seed a single wall surface with an axis-aligned normalized quad
  // (10 % inset) so the editor has usable calibration until the user
  // uploads a room photo + drags corners.
  const surfaceRow = sceneSurfaceInsertToRow({
    spaceId: space.id,
    role: "wall",
    surfaceIndex: 0,
    widthCm: null,
    heightCm: null,
    photoCorners: {
      tl: { x: 0.1, y: 0.1 },
      tr: { x: 0.9, y: 0.1 },
      br: { x: 0.9, y: 0.9 },
      bl: { x: 0.1, y: 0.9 },
    },
  });
  const { data: surfaceInserted, error: surfaceErr } = await client
    .from("space_surfaces")
    .insert(surfaceRow)
    .select("id")
    .single();
  if (surfaceErr) return { data: null, error: surfaceErr };
  const surfaceId = (surfaceInserted as { id: string }).id;

  // Even x-spacing across a nominal 400 cm wall so nothing lands on
  // top of another placement. Callers can move them freely afterwards.
  const spacingCm = 60;
  const yCm = 150;
  if (items.length > 0) {
    const placementRows = items.map((item, idx) => ({
      space_id: space.id,
      surface_id: surfaceId,
      artwork_id: item.artwork_id,
      x_cm: (idx + 1) * spacingCm,
      y_cm: yCm,
      z_cm: 0,
      rot_x_deg: 0,
      rot_y_deg: 0,
      rot_z_deg: 0,
      z_order: item.position ?? idx,
    }));
    const { error: placementErr } = await client
      .from("space_placements")
      .insert(placementRows);
    if (placementErr) return { data: null, error: placementErr };
  }

  await recordUsageEvent(
    {
      userId,
      key: USAGE_KEYS.SIMULATION_SPACE_CREATED,
      featureKey: "simulation.2d",
      metadata: {
        space_id: space.id,
        kind: space.kind,
        seeded_from: "shortlist",
        shortlist_id: shortlistId,
        seeded_placements: items.length,
      },
    },
    { client },
  );

  // Re-fetch so the returned scene has the seeded surface + placements.
  const { data: finalRow, error: finalErr } = await client
    .from("spaces")
    .select(SPACE_SELECT)
    .eq("id", space.id)
    .single();
  if (finalErr) return { data: space, error: null };
  return {
    data: rowToSceneSpace(finalRow as Record<string, unknown>),
    error: null,
  };
}

// ─── Space header ───────────────────────────────────────────────────

/**
 * Patch a `spaces` header row. Auto-bumps `updated_at` so
 * `listMySpaces` ordering stays intuitive. RLS enforces ownership.
 */
export async function updateSpace(
  id: string,
  patch: SceneSpaceUpdate,
  options: { client?: SupabaseClient } = {},
): Promise<{ error: unknown }> {
  const client = options.client ?? defaultClient;
  const row = sceneSpaceUpdateToRow(patch);
  row.updated_at = new Date().toISOString();
  const { error } = await client.from("spaces").update(row).eq("id", id);
  return { error };
}

/**
 * Soft-delete: flip `is_active = false`. Preserves history so
 * `simulation.2d`'s lifetime counter (which sums
 * `simulation.space.created` events, not row count) is stable.
 * `deleteSpace` is deliberately soft; a hard delete belongs in a
 * separate purge job.
 */
export async function deleteSpace(
  id: string,
  options: { client?: SupabaseClient } = {},
): Promise<{ error: unknown }> {
  const client = options.client ?? defaultClient;
  const { error } = await client
    .from("spaces")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id);
  return { error };
}

// ─── Surfaces ───────────────────────────────────────────────────────

/**
 * Patch a `space_surfaces` row — the Chunk C corner picker hook calls
 * this every drag-end with `{ widthCm, heightCm, photoCorners }`.
 * RLS enforces ownership via `is_space_owner`.
 */
export async function updateSurface(
  id: string,
  patch: SceneSurfaceUpdate,
  options: { client?: SupabaseClient; spaceIdForTouch?: string } = {},
): Promise<{ error: unknown }> {
  const client = options.client ?? defaultClient;
  const row = sceneSurfaceUpdateToRow(patch);
  const { error } = await client.from("space_surfaces").update(row).eq("id", id);
  if (!error && options.spaceIdForTouch) {
    await touchSpace(client, options.spaceIdForTouch);
  }
  return { error };
}

// ─── Placements ─────────────────────────────────────────────────────

/**
 * Batch upsert placements. Rows with an `id` are updated; rows
 * without one are inserted (`gen_random_uuid()` fills the id). All
 * rows must belong to `spaceId` — this is enforced client-side
 * (defensive), then again server-side via the `space_id = spaceId`
 * predicate on the RLS policy.
 *
 * Uses `.upsert(rows, { onConflict: 'id' }).select()` so callers get
 * the server-materialized rows back in a single round trip. Phase 3
 * (2026-08-19) relies on this to swap client-side `tmp_` ids for
 * server-generated UUIDs in-place — no more full-scene re-hydrate
 * after every drag / tap-to-place, which is what caused the "page
 * refresh" feel.
 */
export async function upsertPlacements(
  spaceId: string,
  placementRows: ScenePlacementUpsert[],
  options: { client?: SupabaseClient } = {},
): Promise<{ data: ScenePlacement[] | null; error: unknown }> {
  const client = options.client ?? defaultClient;
  if (placementRows.length === 0) return { data: [], error: null };
  const rows = placementRows.map((p) => {
    if (p.spaceId !== spaceId) {
      throw new Error(
        `upsertPlacements: placement.spaceId (${p.spaceId}) must match spaceId (${spaceId})`,
      );
    }
    return scenePlacementUpsertToRow(p);
  });
  const { data, error } = await client
    .from("space_placements")
    .upsert(rows, { onConflict: "id" })
    .select();
  if (error) return { data: null, error };
  await touchSpace(client, spaceId);
  const mapped = ((data ?? []) as Record<string, unknown>[]).map((r) =>
    rowToScenePlacement(r),
  );
  return { data: mapped, error: null };
}

export async function deletePlacement(
  id: string,
  options: { client?: SupabaseClient; spaceIdForTouch?: string } = {},
): Promise<{ error: unknown }> {
  const client = options.client ?? defaultClient;
  const { error } = await client.from("space_placements").delete().eq("id", id);
  if (!error && options.spaceIdForTouch) {
    await touchSpace(client, options.spaceIdForTouch);
  }
  return { error };
}

// ─── Export / share stub (`simulation.2d.export`) ───────────────────

export type ExportSpaceResult = {
  /** Absolute URL of the exported/shared artifact (image or share view). */
  url: string;
  /** Optional metadata Chunk C can attach to the toast / activity log. */
  meta: Record<string, unknown>;
};

/**
 * Placeholder export path. Chunk C will finish the actual image
 * rendering (server-side canvas or client compositing) and swap the
 * return payload. What is finalized here:
 *
 *   1. Entitlement gate on `simulation.2d.export` (Free plan is
 *      excluded from the feature allowlist so the resolver blocks
 *      before quota is even consulted).
 *   2. `simulation.render.exported` usage event so the monthly cap
 *      counts every share/export attempt.
 *   3. Deterministic share URL (`/space/{share_token}`) so Chunk C
 *      can wire the copy-link button today.
 *
 * Throws `SimulationEntitlementError` when the resolver rejects.
 */
export async function exportSpace(
  id: string,
  options: {
    client?: SupabaseClient;
    /**
     * Optional origin for building the share URL. Defaults to
     * `window.location.origin` on the browser and empty on the
     * server (Chunk C will pass the request origin explicitly for
     * SSR share previews).
     */
    origin?: string;
    /** `image` = downloadable PNG, `share` = public read link. */
    mode?: "image" | "share";
  } = {},
): Promise<ExportSpaceResult> {
  const client = options.client ?? defaultClient;
  const userId = await requireSessionUserId(client);
  await assertEntitlementOrThrow("simulation.2d.export", userId, client);

  const { data: row, error } = await client
    .from("spaces")
    .select("id, share_token")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new Error("Space not found");

  const origin =
    options.origin ??
    (typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "");
  const shareToken = (row as { share_token: string }).share_token;
  const url = `${origin}/space/${shareToken}`;

  await recordUsageEvent(
    {
      userId,
      key: USAGE_KEYS.SIMULATION_RENDER_EXPORTED,
      featureKey: "simulation.2d.export",
      metadata: {
        space_id: id,
        mode: options.mode ?? "share",
      },
    },
    { client },
  );

  return {
    url,
    meta: {
      mode: options.mode ?? "share",
      share_token: shareToken,
      space_id: id,
    },
  };
}
