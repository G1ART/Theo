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
  rowToSceneSpace,
  scenePlacementUpsertToRow,
  sceneSpaceInsertToRow,
  sceneSpaceUpdateToRow,
  sceneSurfaceInsertToRow,
  sceneSurfaceUpdateToRow,
  type ArtworkThumbForScene,
  type SceneSpace,
  type SceneSpaceUpdate,
  type ScenePlacementUpsert,
  type SceneSurfaceUpdate,
  type SpaceKind,
} from "@/lib/simulation/scene";

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
  artwork_images(storage_path, sort_order, view_type)
`;

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
      }[]
    | null;
};

function firstImagePath(row: RawArtworkRow): string | null {
  const imgs = Array.isArray(row.artwork_images) ? [...row.artwork_images] : [];
  imgs.sort((a, b) => (a?.sort_order ?? 0) - (b?.sort_order ?? 0));
  return imgs[0]?.storage_path ?? null;
}

function rowToArtworkThumb(
  row: RawArtworkRow,
  locale: Locale,
): ArtworkThumbForScene {
  const path = firstImagePath(row);
  return {
    id: row.id,
    title: pickLocalizedArtworkTitle(row, locale),
    imageUrl: path ? getArtworkImageUrl(path, "medium") : null,
    widthCm: row.width_cm,
    heightCm: row.height_cm,
    depthCm: row.depth_cm,
    workForm: row.work_form ?? "flat_2d",
  };
}

async function fetchArtworkThumbs(
  client: SupabaseClient,
  artworkIds: string[],
  selectCols: string,
  locale: Locale,
  publicOnly: boolean,
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
  for (const row of (data ?? []) as unknown as RawArtworkRow[]) {
    out.set(row.id, rowToArtworkThumb(row, locale));
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
 * Uses `.upsert(rows, { onConflict: 'id' })` so the round trip stays
 * a single request — same pattern PostgREST's `Prefer: resolution=
 * merge-duplicates` uses under the hood.
 */
export async function upsertPlacements(
  spaceId: string,
  placementRows: ScenePlacementUpsert[],
  options: { client?: SupabaseClient } = {},
): Promise<{ error: unknown }> {
  const client = options.client ?? defaultClient;
  if (placementRows.length === 0) return { error: null };
  const rows = placementRows.map((p) => {
    if (p.spaceId !== spaceId) {
      throw new Error(
        `upsertPlacements: placement.spaceId (${p.spaceId}) must match spaceId (${spaceId})`,
      );
    }
    return scenePlacementUpsertToRow(p);
  });
  const { error } = await client
    .from("space_placements")
    .upsert(rows, { onConflict: "id" });
  if (!error) await touchSpace(client, spaceId);
  return { error };
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
