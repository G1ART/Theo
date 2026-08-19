/**
 * P1 Display / Hang Simulation — renderer-agnostic scene model.
 *
 * This module is the single TypeScript-side mirror of the three tables
 * added by `supabase/migrations/20260818000000_spaces_schema.sql`
 * (`spaces`, `space_surfaces`, `space_placements`). Both renderers —
 * the P1 2D room-photo view and the future P2 parametric 3D view —
 * consume the exact same `SceneSpace` shape; the 2D path just
 * projects a subset (x/y_cm, rot_z_deg, width/height_cm) while the 3D
 * path reads the full pose. Keeping the model unified avoids a
 * schema rewrite when 3D lands.
 *
 * Validation
 * ----------
 * The project intentionally has no `zod` dependency (see `package.json`
 * — the "no new dependencies" constraint on this chunk). The
 * `SceneSpaceSchema` / `SceneSurfaceSchema` / `ScenePlacementSchema`
 * exports expose a **zod-compatible surface** (`safeParse` / `parse`)
 * built on lightweight in-file validators. Consumers (Chunk C editor,
 * upcoming API routes) can therefore write
 *
 *   const parsed = SceneSpaceSchema.safeParse(row);
 *
 * without knowing which validator implementation is behind it. If we
 * later adopt zod, the schemas can be re-exported from a real zod
 * module and no call site changes.
 *
 * The `Insert*` / `Update*` variants strip server-managed fields
 * (`id`, `created_at`, `updated_at`, `share_token`) so the same shape
 * can be used both as the persisted row type and as the payload
 * accepted by `spaces.ts` mutators.
 */

// ─── Shared primitives ──────────────────────────────────────────────

/** A single normalized image-space point in [0, 1] × [0, 1]. */
export type NormalizedPoint = { x: number; y: number };

/**
 * The four projected corners of a `wall` (or other planar) surface on
 * the room photo. Order matches `homographyForCorners` from
 * `@/lib/image/enhancement/homography`: **top-left, top-right,
 * bottom-right, bottom-left**, all normalized to the photo's pixel
 * space so we survive display-size resizes without re-picking.
 */
export type PhotoCorners = {
  tl: NormalizedPoint;
  tr: NormalizedPoint;
  br: NormalizedPoint;
  bl: NormalizedPoint;
};

/** Space kind — mirrors `spaces.kind`. */
export type SpaceKind = "room_photo_2d" | "parametric_3d";

/** Display unit — mirrors `spaces.unit`. Stored dimensions are always cm. */
export type SpaceUnit = "cm" | "in";

/**
 * Surface role — mirrors `space_surfaces.role`. The P1 room-photo
 * flow always seeds a single `wall`; other roles are reserved for
 * the 3D renderer.
 */
export type SurfaceRole = "wall" | "floor" | "ceiling" | "freestanding";

// ─── Row types (camelCase mirror of the DB) ─────────────────────────

/** Mirrors `space_placements`. */
export type ScenePlacement = {
  id: string;
  spaceId: string;
  surfaceId: string | null;
  artworkId: string;
  xCm: number;
  yCm: number;
  zCm: number;
  rotXDeg: number;
  rotYDeg: number;
  rotZDeg: number;
  widthCm: number | null;
  heightCm: number | null;
  depthCm: number | null;
  zOrder: number;
  createdAt: string;
  updatedAt: string;
};

/** Mirrors `space_surfaces`. */
export type SceneSurface = {
  id: string;
  spaceId: string;
  role: SurfaceRole;
  surfaceIndex: number;
  widthCm: number | null;
  heightCm: number | null;
  /** Normalized corners on the room photo. Null until the user calibrates. */
  photoCorners: PhotoCorners | null;
  /** Reserved pose blob for the 3D renderer; JSON pass-through. */
  pose: Record<string, unknown> | null;
  createdAt: string;
};

/** Mirrors `spaces` and folds child rows for renderer convenience. */
export type SceneSpace = {
  id: string;
  ownerId: string;
  title: string;
  kind: SpaceKind;
  unit: SpaceUnit;
  sourceShortlistId: string | null;
  widthCm: number | null;
  heightCm: number | null;
  depthCm: number | null;
  photoStoragePath: string | null;
  photoOriginalStoragePath: string | null;
  photoWidthPx: number | null;
  photoHeightPx: number | null;
  shareToken: string;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  surfaces: SceneSurface[];
  placements: ScenePlacement[];
};

// ─── Insert / update payloads ───────────────────────────────────────

/**
 * Insert payload for a `spaces` row. Server-managed columns
 * (`id`, `share_token`, `created_at`, `updated_at`) and folded children
 * (`surfaces`, `placements`) are omitted; RLS fills `owner_id` from
 * `auth.uid()` client-side callers via `spaces.ts`.
 */
export type SceneSpaceInsert = {
  ownerId: string;
  title: string;
  kind?: SpaceKind;
  unit?: SpaceUnit;
  sourceShortlistId?: string | null;
  widthCm?: number | null;
  heightCm?: number | null;
  depthCm?: number | null;
  photoStoragePath?: string | null;
  photoOriginalStoragePath?: string | null;
  photoWidthPx?: number | null;
  photoHeightPx?: number | null;
  isActive?: boolean;
  expiresAt?: string | null;
};

/** Partial patch for a `spaces` header — all fields optional. */
export type SceneSpaceUpdate = Partial<
  Omit<SceneSpaceInsert, "ownerId">
>;

/** Insert payload for a `space_surfaces` row. */
export type SceneSurfaceInsert = {
  spaceId: string;
  role?: SurfaceRole;
  surfaceIndex?: number;
  widthCm?: number | null;
  heightCm?: number | null;
  photoCorners?: PhotoCorners | null;
  pose?: Record<string, unknown> | null;
};

/** Partial patch for a `space_surfaces` row. */
export type SceneSurfaceUpdate = Partial<
  Omit<SceneSurfaceInsert, "spaceId">
>;

/** Insert payload for a `space_placements` row. */
export type ScenePlacementInsert = {
  spaceId: string;
  surfaceId?: string | null;
  artworkId: string;
  xCm?: number;
  yCm?: number;
  zCm?: number;
  rotXDeg?: number;
  rotYDeg?: number;
  rotZDeg?: number;
  widthCm?: number | null;
  heightCm?: number | null;
  depthCm?: number | null;
  zOrder?: number;
};

/** Partial patch for a `space_placements` row. */
export type ScenePlacementUpdate = Partial<
  Omit<ScenePlacementInsert, "spaceId" | "artworkId">
>;

/**
 * Placement input for `upsertPlacements` — accepts both new
 * (`id === undefined`) and existing rows.
 */
export type ScenePlacementUpsert = ScenePlacementInsert & {
  id?: string;
};

// ─── Artwork thumbnail bag used by the renderers ────────────────────

/**
 * Minimal artwork shape the 2D renderer needs. Loaders in `spaces.ts`
 * populate this per placement so `renderer2d.ts` never needs to
 * re-fetch. Bilingual title picking is done at load time (locale is
 * passed to the loader) so the render pipeline stays synchronous.
 */
export type ArtworkThumbForScene = {
  id: string;
  title: string;
  imageUrl: string | null;
  /** Canonical dimensions in cm — falls back to placement override when null. */
  widthCm: number | null;
  heightCm: number | null;
  depthCm: number | null;
  /**
   * Pixel dimensions of the source image at `imageUrl` (from
   * `artwork_images.width/height`, the first `sort_order` row).
   * Null for legacy rows uploaded before the auto-compression pass
   * (which populates these) landed. The 2D renderer uses these to:
   *
   *   1. Warn when the image's aspect ratio disagrees with the
   *      placement's physical aspect — a strong signal that the
   *      uploaded photo contains background padding (the "wall
   *      around the painting" case in the P1 quality report).
   *   2. Offer a "fit to image aspect" inspector action so the user
   *      can snap the placement to the true image proportions
   *      without editing `artworks.width_cm/height_cm` (which would
   *      leak into every other placement of the same work).
   *
   * Both features gracefully skip when either dimension is null.
   */
  imagePxWidth: number | null;
  imagePxHeight: number | null;
  /** Dimensionality bucket used to decide which renderer path applies. */
  workForm:
    | "flat_2d"
    | "relief"
    | "sculpture_3d"
    | "installation"
    | "time_based";
};

// ─── Row ↔ camelCase mappers ────────────────────────────────────────

type SnakePoint = { x?: unknown; y?: unknown };
type SnakePhotoCorners = {
  tl?: SnakePoint;
  tr?: SnakePoint;
  br?: SnakePoint;
  bl?: SnakePoint;
};

function coercePoint(input: unknown): NormalizedPoint | null {
  if (!input || typeof input !== "object") return null;
  const p = input as SnakePoint;
  const x = Number(p.x);
  const y = Number(p.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function coercePhotoCorners(input: unknown): PhotoCorners | null {
  if (!input || typeof input !== "object") return null;
  const c = input as SnakePhotoCorners;
  const tl = coercePoint(c.tl);
  const tr = coercePoint(c.tr);
  const br = coercePoint(c.br);
  const bl = coercePoint(c.bl);
  if (!tl || !tr || !br || !bl) return null;
  return { tl, tr, br, bl };
}

function toStr(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function toNum(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function toNullableNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function toBool(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/** Map a snake_case `space_placements` row to `ScenePlacement`. */
export function rowToScenePlacement(row: Record<string, unknown>): ScenePlacement {
  return {
    id: toStr(row.id),
    spaceId: toStr(row.space_id),
    surfaceId: (row.surface_id as string | null) ?? null,
    artworkId: toStr(row.artwork_id),
    xCm: toNum(row.x_cm),
    yCm: toNum(row.y_cm),
    zCm: toNum(row.z_cm),
    rotXDeg: toNum(row.rot_x_deg),
    rotYDeg: toNum(row.rot_y_deg),
    rotZDeg: toNum(row.rot_z_deg),
    widthCm: toNullableNum(row.width_cm),
    heightCm: toNullableNum(row.height_cm),
    depthCm: toNullableNum(row.depth_cm),
    zOrder: Math.trunc(toNum(row.z_order)),
    createdAt: toStr(row.created_at),
    updatedAt: toStr(row.updated_at),
  };
}

/** Map a snake_case `space_surfaces` row to `SceneSurface`. */
export function rowToSceneSurface(row: Record<string, unknown>): SceneSurface {
  const role = toStr(row.role, "wall") as SurfaceRole;
  return {
    id: toStr(row.id),
    spaceId: toStr(row.space_id),
    role,
    surfaceIndex: Math.trunc(toNum(row.surface_index)),
    widthCm: toNullableNum(row.width_cm),
    heightCm: toNullableNum(row.height_cm),
    photoCorners: coercePhotoCorners(row.photo_corners),
    pose:
      row.pose && typeof row.pose === "object" && !Array.isArray(row.pose)
        ? (row.pose as Record<string, unknown>)
        : null,
    createdAt: toStr(row.created_at),
  };
}

/**
 * Map a snake_case `spaces` row (plus optionally embedded surfaces +
 * placements from a PostgREST select) to `SceneSpace`. Children default
 * to `[]` when absent.
 */
export function rowToSceneSpace(row: Record<string, unknown>): SceneSpace {
  const kind = toStr(row.kind, "room_photo_2d") as SpaceKind;
  const unit = toStr(row.unit, "cm") as SpaceUnit;
  const surfacesRaw = Array.isArray(row.space_surfaces) ? row.space_surfaces : [];
  const placementsRaw = Array.isArray(row.space_placements) ? row.space_placements : [];
  const surfaces = surfacesRaw
    .map((r) => rowToSceneSurface(r as Record<string, unknown>))
    .sort((a, b) => a.surfaceIndex - b.surfaceIndex);
  const placements = placementsRaw
    .map((r) => rowToScenePlacement(r as Record<string, unknown>))
    .sort((a, b) => a.zOrder - b.zOrder);
  return {
    id: toStr(row.id),
    ownerId: toStr(row.owner_id),
    title: toStr(row.title, "Untitled space"),
    kind,
    unit,
    sourceShortlistId: (row.source_shortlist_id as string | null) ?? null,
    widthCm: toNullableNum(row.width_cm),
    heightCm: toNullableNum(row.height_cm),
    depthCm: toNullableNum(row.depth_cm),
    photoStoragePath: (row.photo_storage_path as string | null) ?? null,
    photoOriginalStoragePath: (row.photo_original_storage_path as string | null) ?? null,
    photoWidthPx:
      row.photo_width_px == null ? null : Math.trunc(toNum(row.photo_width_px)),
    photoHeightPx:
      row.photo_height_px == null ? null : Math.trunc(toNum(row.photo_height_px)),
    shareToken: toStr(row.share_token),
    isActive: toBool(row.is_active, true),
    expiresAt: (row.expires_at as string | null) ?? null,
    createdAt: toStr(row.created_at),
    updatedAt: toStr(row.updated_at),
    surfaces,
    placements,
  };
}

// ─── DB payload builders (camelCase → snake_case) ───────────────────
//
// Small helpers so `spaces.ts` doesn't have to hand-roll the mapping.
// Each strips `undefined` (so PATCH semantics are honoured — a missing
// field means "don't touch") but preserves explicit `null` (so callers
// can clear an override).

function put<T extends Record<string, unknown>>(
  target: T,
  key: string,
  value: unknown,
): void {
  if (value !== undefined) {
    (target as Record<string, unknown>)[key] = value;
  }
}

/** Build a snake_case insert row for `spaces` from a camelCase payload. */
export function sceneSpaceInsertToRow(input: SceneSpaceInsert): Record<string, unknown> {
  const row: Record<string, unknown> = {
    owner_id: input.ownerId,
    title: input.title,
  };
  put(row, "kind", input.kind);
  put(row, "unit", input.unit);
  put(row, "source_shortlist_id", input.sourceShortlistId);
  put(row, "width_cm", input.widthCm);
  put(row, "height_cm", input.heightCm);
  put(row, "depth_cm", input.depthCm);
  put(row, "photo_storage_path", input.photoStoragePath);
  put(row, "photo_original_storage_path", input.photoOriginalStoragePath);
  put(row, "photo_width_px", input.photoWidthPx);
  put(row, "photo_height_px", input.photoHeightPx);
  put(row, "is_active", input.isActive);
  put(row, "expires_at", input.expiresAt);
  return row;
}

/** Build a snake_case patch row for `spaces`. */
export function sceneSpaceUpdateToRow(input: SceneSpaceUpdate): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  put(row, "title", input.title);
  put(row, "kind", input.kind);
  put(row, "unit", input.unit);
  put(row, "source_shortlist_id", input.sourceShortlistId);
  put(row, "width_cm", input.widthCm);
  put(row, "height_cm", input.heightCm);
  put(row, "depth_cm", input.depthCm);
  put(row, "photo_storage_path", input.photoStoragePath);
  put(row, "photo_original_storage_path", input.photoOriginalStoragePath);
  put(row, "photo_width_px", input.photoWidthPx);
  put(row, "photo_height_px", input.photoHeightPx);
  put(row, "is_active", input.isActive);
  put(row, "expires_at", input.expiresAt);
  return row;
}

/** Build a snake_case insert row for `space_surfaces`. */
export function sceneSurfaceInsertToRow(input: SceneSurfaceInsert): Record<string, unknown> {
  const row: Record<string, unknown> = {
    space_id: input.spaceId,
  };
  put(row, "role", input.role);
  put(row, "surface_index", input.surfaceIndex);
  put(row, "width_cm", input.widthCm);
  put(row, "height_cm", input.heightCm);
  put(row, "photo_corners", input.photoCorners);
  put(row, "pose", input.pose);
  return row;
}

/** Build a snake_case patch row for `space_surfaces`. */
export function sceneSurfaceUpdateToRow(input: SceneSurfaceUpdate): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  put(row, "role", input.role);
  put(row, "surface_index", input.surfaceIndex);
  put(row, "width_cm", input.widthCm);
  put(row, "height_cm", input.heightCm);
  put(row, "photo_corners", input.photoCorners);
  put(row, "pose", input.pose);
  return row;
}

/** Build a snake_case insert row for `space_placements`. */
export function scenePlacementInsertToRow(
  input: ScenePlacementInsert,
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    space_id: input.spaceId,
    artwork_id: input.artworkId,
  };
  put(row, "surface_id", input.surfaceId);
  put(row, "x_cm", input.xCm);
  put(row, "y_cm", input.yCm);
  put(row, "z_cm", input.zCm);
  put(row, "rot_x_deg", input.rotXDeg);
  put(row, "rot_y_deg", input.rotYDeg);
  put(row, "rot_z_deg", input.rotZDeg);
  put(row, "width_cm", input.widthCm);
  put(row, "height_cm", input.heightCm);
  put(row, "depth_cm", input.depthCm);
  put(row, "z_order", input.zOrder);
  return row;
}

/** Build a snake_case upsert row for `space_placements` (keeps `id` when set). */
export function scenePlacementUpsertToRow(
  input: ScenePlacementUpsert,
): Record<string, unknown> {
  const row = scenePlacementInsertToRow(input);
  if (input.id) row.id = input.id;
  return row;
}

// ─── Lightweight validators (zod-compatible surface) ────────────────
//
// We publish a tiny `{ safeParse, parse }` interface so downstream code
// (and any future editor tooling) can treat these as if they were zod
// schemas. If the project later takes a `zod` dependency, replace the
// bodies below with the equivalent `z.object({...})` — no call site
// changes required.

export type ParseSuccess<T> = { success: true; data: T };
export type ParseFailure = { success: false; error: SceneValidationError };
export type ParseResult<T> = ParseSuccess<T> | ParseFailure;

export class SceneValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`SceneValidationError: ${issues.join("; ")}`);
    this.name = "SceneValidationError";
    this.issues = issues;
  }
}

/**
 * Minimal schema surface — a superset of what our call sites need,
 * but a strict subset of zod's contract so a future swap is a
 * one-line change per schema.
 */
export type SceneSchema<T> = {
  parse(input: unknown): T;
  safeParse(input: unknown): ParseResult<T>;
};

function makeSchema<T>(check: (input: unknown, issues: string[]) => T | null): SceneSchema<T> {
  return {
    safeParse(input: unknown): ParseResult<T> {
      const issues: string[] = [];
      const value = check(input, issues);
      if (issues.length === 0 && value !== null) {
        return { success: true, data: value };
      }
      return { success: false, error: new SceneValidationError(issues) };
    },
    parse(input: unknown): T {
      const parsed = this.safeParse(input);
      if (parsed.success) return parsed.data;
      throw parsed.error;
    },
  };
}

// ── primitive checkers ──
function checkStr(v: unknown, field: string, issues: string[]): string {
  if (typeof v !== "string" || v.length === 0) {
    issues.push(`${field} must be a non-empty string`);
    return "";
  }
  return v;
}
function checkOptStr(v: unknown, field: string, issues: string[]): string | null {
  if (v == null) return null;
  if (typeof v !== "string") {
    issues.push(`${field} must be a string when present`);
    return null;
  }
  return v;
}
function checkNum(v: unknown, field: string, issues: string[], fallback = 0): number {
  if (v == null) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    issues.push(`${field} must be a finite number`);
    return fallback;
  }
  return n;
}
function checkOptNum(v: unknown, field: string, issues: string[]): number | null {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    issues.push(`${field} must be a finite number when present`);
    return null;
  }
  return n;
}
function checkBool(v: unknown, field: string, issues: string[], fallback = true): boolean {
  if (v == null) return fallback;
  if (typeof v !== "boolean") {
    issues.push(`${field} must be a boolean`);
    return fallback;
  }
  return v;
}
function checkEnum<T extends string>(
  v: unknown,
  allowed: readonly T[],
  field: string,
  issues: string[],
  fallback: T,
): T {
  if (v == null) return fallback;
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
    issues.push(`${field} must be one of: ${allowed.join(", ")}`);
    return fallback;
  }
  return v as T;
}

function checkPhotoCorners(
  v: unknown,
  field: string,
  issues: string[],
): PhotoCorners | null {
  if (v == null) return null;
  const parsed = coercePhotoCorners(v);
  if (!parsed) {
    issues.push(`${field} must be {tl,tr,br,bl} of {x,y} numbers`);
    return null;
  }
  // Bounds sanity check — the picker constrains to [0,1] × [0,1].
  for (const [k, p] of Object.entries(parsed)) {
    if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) {
      issues.push(`${field}.${k} must be normalized to [0,1]`);
    }
  }
  return parsed;
}

const SPACE_KINDS: readonly SpaceKind[] = ["room_photo_2d", "parametric_3d"];
const SPACE_UNITS: readonly SpaceUnit[] = ["cm", "in"];
const SURFACE_ROLES: readonly SurfaceRole[] = [
  "wall",
  "floor",
  "ceiling",
  "freestanding",
];

// ── row schemas ──

export const SceneSurfaceSchema: SceneSchema<SceneSurface> = makeSchema((input, issues) => {
  if (!input || typeof input !== "object") {
    issues.push("SceneSurface: input must be an object");
    return null;
  }
  const raw = input as Record<string, unknown>;
  const id = checkStr(raw.id, "id", issues);
  const spaceId = checkStr(raw.spaceId ?? raw.space_id, "spaceId", issues);
  const role = checkEnum(raw.role, SURFACE_ROLES, "role", issues, "wall");
  const surfaceIndex = Math.trunc(
    checkNum(raw.surfaceIndex ?? raw.surface_index, "surfaceIndex", issues, 0),
  );
  const widthCm = checkOptNum(raw.widthCm ?? raw.width_cm, "widthCm", issues);
  const heightCm = checkOptNum(raw.heightCm ?? raw.height_cm, "heightCm", issues);
  const photoCorners = checkPhotoCorners(
    raw.photoCorners ?? raw.photo_corners,
    "photoCorners",
    issues,
  );
  const poseRaw = raw.pose;
  const pose =
    poseRaw && typeof poseRaw === "object" && !Array.isArray(poseRaw)
      ? (poseRaw as Record<string, unknown>)
      : null;
  const createdAt = checkStr(raw.createdAt ?? raw.created_at, "createdAt", issues);
  if (issues.length > 0) return null;
  return {
    id,
    spaceId,
    role,
    surfaceIndex,
    widthCm,
    heightCm,
    photoCorners,
    pose,
    createdAt,
  };
});

export const ScenePlacementSchema: SceneSchema<ScenePlacement> = makeSchema(
  (input, issues) => {
    if (!input || typeof input !== "object") {
      issues.push("ScenePlacement: input must be an object");
      return null;
    }
    const raw = input as Record<string, unknown>;
    const id = checkStr(raw.id, "id", issues);
    const spaceId = checkStr(raw.spaceId ?? raw.space_id, "spaceId", issues);
    const surfaceId = checkOptStr(
      raw.surfaceId ?? raw.surface_id,
      "surfaceId",
      issues,
    );
    const artworkId = checkStr(raw.artworkId ?? raw.artwork_id, "artworkId", issues);
    const xCm = checkNum(raw.xCm ?? raw.x_cm, "xCm", issues, 0);
    const yCm = checkNum(raw.yCm ?? raw.y_cm, "yCm", issues, 0);
    const zCm = checkNum(raw.zCm ?? raw.z_cm, "zCm", issues, 0);
    const rotXDeg = checkNum(raw.rotXDeg ?? raw.rot_x_deg, "rotXDeg", issues, 0);
    const rotYDeg = checkNum(raw.rotYDeg ?? raw.rot_y_deg, "rotYDeg", issues, 0);
    const rotZDeg = checkNum(raw.rotZDeg ?? raw.rot_z_deg, "rotZDeg", issues, 0);
    const widthCm = checkOptNum(raw.widthCm ?? raw.width_cm, "widthCm", issues);
    const heightCm = checkOptNum(raw.heightCm ?? raw.height_cm, "heightCm", issues);
    const depthCm = checkOptNum(raw.depthCm ?? raw.depth_cm, "depthCm", issues);
    const zOrder = Math.trunc(
      checkNum(raw.zOrder ?? raw.z_order, "zOrder", issues, 0),
    );
    const createdAt = checkStr(raw.createdAt ?? raw.created_at, "createdAt", issues);
    const updatedAt = checkStr(raw.updatedAt ?? raw.updated_at, "updatedAt", issues);
    if (issues.length > 0) return null;
    return {
      id,
      spaceId,
      surfaceId,
      artworkId,
      xCm,
      yCm,
      zCm,
      rotXDeg,
      rotYDeg,
      rotZDeg,
      widthCm,
      heightCm,
      depthCm,
      zOrder,
      createdAt,
      updatedAt,
    };
  },
);

export const SceneSpaceSchema: SceneSchema<SceneSpace> = makeSchema((input, issues) => {
  if (!input || typeof input !== "object") {
    issues.push("SceneSpace: input must be an object");
    return null;
  }
  const raw = input as Record<string, unknown>;
  const id = checkStr(raw.id, "id", issues);
  const ownerId = checkStr(raw.ownerId ?? raw.owner_id, "ownerId", issues);
  const title = checkStr(raw.title, "title", issues);
  const kind = checkEnum(raw.kind, SPACE_KINDS, "kind", issues, "room_photo_2d");
  const unit = checkEnum(raw.unit, SPACE_UNITS, "unit", issues, "cm");
  const sourceShortlistId = checkOptStr(
    raw.sourceShortlistId ?? raw.source_shortlist_id,
    "sourceShortlistId",
    issues,
  );
  const widthCm = checkOptNum(raw.widthCm ?? raw.width_cm, "widthCm", issues);
  const heightCm = checkOptNum(raw.heightCm ?? raw.height_cm, "heightCm", issues);
  const depthCm = checkOptNum(raw.depthCm ?? raw.depth_cm, "depthCm", issues);
  const photoStoragePath = checkOptStr(
    raw.photoStoragePath ?? raw.photo_storage_path,
    "photoStoragePath",
    issues,
  );
  const photoOriginalStoragePath = checkOptStr(
    raw.photoOriginalStoragePath ?? raw.photo_original_storage_path,
    "photoOriginalStoragePath",
    issues,
  );
  const photoWidthPx = checkOptNum(
    raw.photoWidthPx ?? raw.photo_width_px,
    "photoWidthPx",
    issues,
  );
  const photoHeightPx = checkOptNum(
    raw.photoHeightPx ?? raw.photo_height_px,
    "photoHeightPx",
    issues,
  );
  const shareToken = checkStr(raw.shareToken ?? raw.share_token, "shareToken", issues);
  const isActive = checkBool(raw.isActive ?? raw.is_active, "isActive", issues, true);
  const expiresAt = checkOptStr(raw.expiresAt ?? raw.expires_at, "expiresAt", issues);
  const createdAt = checkStr(raw.createdAt ?? raw.created_at, "createdAt", issues);
  const updatedAt = checkStr(raw.updatedAt ?? raw.updated_at, "updatedAt", issues);

  const surfacesRaw = raw.surfaces ?? raw.space_surfaces ?? [];
  const placementsRaw = raw.placements ?? raw.space_placements ?? [];
  if (!Array.isArray(surfacesRaw)) issues.push("surfaces must be an array");
  if (!Array.isArray(placementsRaw)) issues.push("placements must be an array");

  const surfaces: SceneSurface[] = [];
  if (Array.isArray(surfacesRaw)) {
    for (const s of surfacesRaw) {
      const parsed = SceneSurfaceSchema.safeParse(s);
      if (parsed.success) surfaces.push(parsed.data);
      else issues.push(`surface: ${parsed.error.issues.join(", ")}`);
    }
  }
  const placements: ScenePlacement[] = [];
  if (Array.isArray(placementsRaw)) {
    for (const p of placementsRaw) {
      const parsed = ScenePlacementSchema.safeParse(p);
      if (parsed.success) placements.push(parsed.data);
      else issues.push(`placement: ${parsed.error.issues.join(", ")}`);
    }
  }
  if (issues.length > 0) return null;

  return {
    id,
    ownerId,
    title,
    kind,
    unit,
    sourceShortlistId,
    widthCm,
    heightCm,
    depthCm,
    photoStoragePath,
    photoOriginalStoragePath,
    photoWidthPx: photoWidthPx == null ? null : Math.trunc(photoWidthPx),
    photoHeightPx: photoHeightPx == null ? null : Math.trunc(photoHeightPx),
    shareToken,
    isActive,
    expiresAt,
    createdAt,
    updatedAt,
    surfaces: surfaces.sort((a, b) => a.surfaceIndex - b.surfaceIndex),
    placements: placements.sort((a, b) => a.zOrder - b.zOrder),
  };
});

// ── insert / update schemas ──

export const SceneSpaceInsertSchema: SceneSchema<SceneSpaceInsert> = makeSchema(
  (input, issues) => {
    if (!input || typeof input !== "object") {
      issues.push("SceneSpaceInsert: input must be an object");
      return null;
    }
    const raw = input as Record<string, unknown>;
    const ownerId = checkStr(raw.ownerId, "ownerId", issues);
    const title = checkStr(raw.title, "title", issues);
    if (issues.length > 0) return null;
    const kind = raw.kind === undefined
      ? undefined
      : checkEnum(raw.kind, SPACE_KINDS, "kind", issues, "room_photo_2d");
    const unit = raw.unit === undefined
      ? undefined
      : checkEnum(raw.unit, SPACE_UNITS, "unit", issues, "cm");
    if (issues.length > 0) return null;
    return {
      ownerId,
      title,
      ...(kind !== undefined && { kind }),
      ...(unit !== undefined && { unit }),
      ...(raw.sourceShortlistId !== undefined && {
        sourceShortlistId: raw.sourceShortlistId as string | null,
      }),
      ...(raw.widthCm !== undefined && {
        widthCm: raw.widthCm as number | null,
      }),
      ...(raw.heightCm !== undefined && {
        heightCm: raw.heightCm as number | null,
      }),
      ...(raw.depthCm !== undefined && {
        depthCm: raw.depthCm as number | null,
      }),
      ...(raw.photoStoragePath !== undefined && {
        photoStoragePath: raw.photoStoragePath as string | null,
      }),
      ...(raw.photoOriginalStoragePath !== undefined && {
        photoOriginalStoragePath: raw.photoOriginalStoragePath as string | null,
      }),
      ...(raw.photoWidthPx !== undefined && {
        photoWidthPx: raw.photoWidthPx as number | null,
      }),
      ...(raw.photoHeightPx !== undefined && {
        photoHeightPx: raw.photoHeightPx as number | null,
      }),
      ...(raw.isActive !== undefined && { isActive: Boolean(raw.isActive) }),
      ...(raw.expiresAt !== undefined && {
        expiresAt: raw.expiresAt as string | null,
      }),
    };
  },
);

export const SceneSpaceUpdateSchema: SceneSchema<SceneSpaceUpdate> = makeSchema(
  (input, issues) => {
    if (!input || typeof input !== "object") {
      issues.push("SceneSpaceUpdate: input must be an object");
      return null;
    }
    const raw = input as Record<string, unknown>;
    const out: SceneSpaceUpdate = {};
    if (raw.title !== undefined) out.title = checkStr(raw.title, "title", issues);
    if (raw.kind !== undefined) {
      out.kind = checkEnum(raw.kind, SPACE_KINDS, "kind", issues, "room_photo_2d");
    }
    if (raw.unit !== undefined) {
      out.unit = checkEnum(raw.unit, SPACE_UNITS, "unit", issues, "cm");
    }
    if (raw.sourceShortlistId !== undefined) {
      out.sourceShortlistId = raw.sourceShortlistId as string | null;
    }
    if (raw.widthCm !== undefined) out.widthCm = raw.widthCm as number | null;
    if (raw.heightCm !== undefined) out.heightCm = raw.heightCm as number | null;
    if (raw.depthCm !== undefined) out.depthCm = raw.depthCm as number | null;
    if (raw.photoStoragePath !== undefined) {
      out.photoStoragePath = raw.photoStoragePath as string | null;
    }
    if (raw.photoOriginalStoragePath !== undefined) {
      out.photoOriginalStoragePath = raw.photoOriginalStoragePath as string | null;
    }
    if (raw.photoWidthPx !== undefined) {
      out.photoWidthPx = raw.photoWidthPx as number | null;
    }
    if (raw.photoHeightPx !== undefined) {
      out.photoHeightPx = raw.photoHeightPx as number | null;
    }
    if (raw.isActive !== undefined) out.isActive = Boolean(raw.isActive);
    if (raw.expiresAt !== undefined) out.expiresAt = raw.expiresAt as string | null;
    if (issues.length > 0) return null;
    return out;
  },
);

export const SceneSurfaceInsertSchema: SceneSchema<SceneSurfaceInsert> = makeSchema(
  (input, issues) => {
    if (!input || typeof input !== "object") {
      issues.push("SceneSurfaceInsert: input must be an object");
      return null;
    }
    const raw = input as Record<string, unknown>;
    const spaceId = checkStr(raw.spaceId, "spaceId", issues);
    if (issues.length > 0) return null;
    const out: SceneSurfaceInsert = { spaceId };
    if (raw.role !== undefined) {
      out.role = checkEnum(raw.role, SURFACE_ROLES, "role", issues, "wall");
    }
    if (raw.surfaceIndex !== undefined) {
      out.surfaceIndex = Math.trunc(
        checkNum(raw.surfaceIndex, "surfaceIndex", issues, 0),
      );
    }
    if (raw.widthCm !== undefined) out.widthCm = raw.widthCm as number | null;
    if (raw.heightCm !== undefined) out.heightCm = raw.heightCm as number | null;
    if (raw.photoCorners !== undefined) {
      out.photoCorners = checkPhotoCorners(
        raw.photoCorners,
        "photoCorners",
        issues,
      );
    }
    if (raw.pose !== undefined) {
      const p = raw.pose;
      out.pose =
        p && typeof p === "object" && !Array.isArray(p)
          ? (p as Record<string, unknown>)
          : null;
    }
    if (issues.length > 0) return null;
    return out;
  },
);

export const SceneSurfaceUpdateSchema: SceneSchema<SceneSurfaceUpdate> = makeSchema(
  (input, issues) => {
    if (!input || typeof input !== "object") {
      issues.push("SceneSurfaceUpdate: input must be an object");
      return null;
    }
    const raw = input as Record<string, unknown>;
    const out: SceneSurfaceUpdate = {};
    if (raw.role !== undefined) {
      out.role = checkEnum(raw.role, SURFACE_ROLES, "role", issues, "wall");
    }
    if (raw.surfaceIndex !== undefined) {
      out.surfaceIndex = Math.trunc(
        checkNum(raw.surfaceIndex, "surfaceIndex", issues, 0),
      );
    }
    if (raw.widthCm !== undefined) out.widthCm = raw.widthCm as number | null;
    if (raw.heightCm !== undefined) out.heightCm = raw.heightCm as number | null;
    if (raw.photoCorners !== undefined) {
      out.photoCorners = checkPhotoCorners(
        raw.photoCorners,
        "photoCorners",
        issues,
      );
    }
    if (raw.pose !== undefined) {
      const p = raw.pose;
      out.pose =
        p && typeof p === "object" && !Array.isArray(p)
          ? (p as Record<string, unknown>)
          : null;
    }
    if (issues.length > 0) return null;
    return out;
  },
);

export const ScenePlacementInsertSchema: SceneSchema<ScenePlacementInsert> = makeSchema(
  (input, issues) => {
    if (!input || typeof input !== "object") {
      issues.push("ScenePlacementInsert: input must be an object");
      return null;
    }
    const raw = input as Record<string, unknown>;
    const spaceId = checkStr(raw.spaceId, "spaceId", issues);
    const artworkId = checkStr(raw.artworkId, "artworkId", issues);
    if (issues.length > 0) return null;
    const out: ScenePlacementInsert = { spaceId, artworkId };
    if (raw.surfaceId !== undefined) out.surfaceId = raw.surfaceId as string | null;
    if (raw.xCm !== undefined) out.xCm = checkNum(raw.xCm, "xCm", issues, 0);
    if (raw.yCm !== undefined) out.yCm = checkNum(raw.yCm, "yCm", issues, 0);
    if (raw.zCm !== undefined) out.zCm = checkNum(raw.zCm, "zCm", issues, 0);
    if (raw.rotXDeg !== undefined) {
      out.rotXDeg = checkNum(raw.rotXDeg, "rotXDeg", issues, 0);
    }
    if (raw.rotYDeg !== undefined) {
      out.rotYDeg = checkNum(raw.rotYDeg, "rotYDeg", issues, 0);
    }
    if (raw.rotZDeg !== undefined) {
      out.rotZDeg = checkNum(raw.rotZDeg, "rotZDeg", issues, 0);
    }
    if (raw.widthCm !== undefined) out.widthCm = raw.widthCm as number | null;
    if (raw.heightCm !== undefined) out.heightCm = raw.heightCm as number | null;
    if (raw.depthCm !== undefined) out.depthCm = raw.depthCm as number | null;
    if (raw.zOrder !== undefined) {
      out.zOrder = Math.trunc(checkNum(raw.zOrder, "zOrder", issues, 0));
    }
    if (issues.length > 0) return null;
    return out;
  },
);

export const ScenePlacementUpdateSchema: SceneSchema<ScenePlacementUpdate> = makeSchema(
  (input, issues) => {
    if (!input || typeof input !== "object") {
      issues.push("ScenePlacementUpdate: input must be an object");
      return null;
    }
    const raw = input as Record<string, unknown>;
    const out: ScenePlacementUpdate = {};
    if (raw.surfaceId !== undefined) out.surfaceId = raw.surfaceId as string | null;
    if (raw.xCm !== undefined) out.xCm = checkNum(raw.xCm, "xCm", issues, 0);
    if (raw.yCm !== undefined) out.yCm = checkNum(raw.yCm, "yCm", issues, 0);
    if (raw.zCm !== undefined) out.zCm = checkNum(raw.zCm, "zCm", issues, 0);
    if (raw.rotXDeg !== undefined) {
      out.rotXDeg = checkNum(raw.rotXDeg, "rotXDeg", issues, 0);
    }
    if (raw.rotYDeg !== undefined) {
      out.rotYDeg = checkNum(raw.rotYDeg, "rotYDeg", issues, 0);
    }
    if (raw.rotZDeg !== undefined) {
      out.rotZDeg = checkNum(raw.rotZDeg, "rotZDeg", issues, 0);
    }
    if (raw.widthCm !== undefined) out.widthCm = raw.widthCm as number | null;
    if (raw.heightCm !== undefined) out.heightCm = raw.heightCm as number | null;
    if (raw.depthCm !== undefined) out.depthCm = raw.depthCm as number | null;
    if (raw.zOrder !== undefined) {
      out.zOrder = Math.trunc(checkNum(raw.zOrder, "zOrder", issues, 0));
    }
    if (issues.length > 0) return null;
    return out;
  },
);
