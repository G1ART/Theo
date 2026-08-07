/**
 * Theo Image Enhance (Beta) — shared type contract.
 *
 * 2026-08-05. This module is the single source of truth for the shape of
 * an "enhancement recipe" and its serialized metadata. Both the local
 * flat-artwork engine (browser, canvas/OpenCV) and the object hybrid
 * pipeline (Photoroom + sharp on the server) emit the same envelope so
 * the four upload paths (single, bulk, exhibition single, exhibition
 * bulk) can persist and re-render in a uniform way.
 *
 * Non-goals: this file must NEVER expose secrets or provider URLs. The
 * `EnhancementMeta` written to the database is safe to render back to
 * the artist and to public callers reading `artwork_images.enhancement_meta`.
 */

/** User-facing mode. `auto` is the app default; the client resolves it
 *  into `flat` / `object` via the analyzer's rectangle-confidence. */
export type EnhancementMode = "auto" | "flat" | "object";

/** Which pipeline produced the display file. */
export type EnhancementProvider = "local_opencv" | "photoroom_hybrid";

/** Discrete stages an enhancement request passes through. Exposed so
 *  UI can render "processing / previewing / uploading" states. */
export type EnhancementStage =
  | "quality"
  | "detect"
  | "process"
  | "encode"
  | "compare"
  | "upload";

/** Normalized [0,1] corner in original-image space. */
export type NormalizedPoint = [number, number];

/**
 * Flat artwork parameters. `sourceCorners` are the four corner points
 * (TL, TR, BR, BL) the local engine warped from. `tone` is the same
 * ±15% clamped brightness/contrast/saturation triple the analyzer
 * suggests. `sharpen` is a scalar 0..1 (small unsharp mask). `bezelPx`
 * is the white bezel added around the warped image (as a fraction of
 * the shorter edge, typically ~0.02).
 */
export type FlatRecipe = {
  sourceCorners: [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint] | null;
  tone: { b: number; c: number; s: number };
  sharpen: number;
  bezel: number;
};

/** Object segmentation parameters. Padding + bezel are both fractions
 *  of the shorter edge of the composited canvas. */
export type ObjectRecipe = {
  padding: number;
  bezel: number;
};

export type EnhancementRecipe =
  | { kind: "flat"; params: FlatRecipe }
  | { kind: "object"; params: ObjectRecipe };

/**
 * Serialized payload written to `artwork_images.enhancement_meta` /
 * `exhibition_media.enhancement_meta`. This shape is deliberately
 * JSON-serializable — no Blob, no File, no ArrayBuffer.
 *
 * Explicitly NOT included: any API key, any provider URL, any raw
 * bytes, any request id that leaks user PII.
 */
export type EnhancementMeta = {
  provider: EnhancementProvider;
  mode: EnhancementMode;
  recipe: EnhancementRecipe;
  /** Provider confidence in the auto-selected mode, 0..1. `null` for
   *  user-forced modes. */
  confidence: number | null;
  /** SHA-256 hex of the ORIGINAL file bytes at enhancement time. Lets
   *  us detect drift if the original is later replaced. */
  sourceHashSha256: string;
  /** ISO timestamp of enhancement completion. */
  processedAtIso: string;
  /** End-to-end latency of the pipeline, in ms. */
  latencyMs: number;
  /** Versions of the pieces that produced the result. Bump when the
   *  recipe schema or the pipeline changes. */
  versions: {
    schema: number;
    engine: string;
  };
};

/** Current schema version for `EnhancementMeta`. Bump when readers must
 *  discriminate between old and new payloads. */
export const ENHANCEMENT_META_SCHEMA_VERSION = 1;

/** Bounds for how much tone the local engine is allowed to shift. */
export const ENHANCEMENT_TONE_CAP = 0.15;

/** Clamp a tone value into the ±cap window around 1.0. */
export function clampTone(value: number, cap: number = ENHANCEMENT_TONE_CAP): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1 + cap, Math.max(1 - cap, value));
}

/** Round to three decimals so the persisted payload stays compact. */
export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Runtime type guard used by DB readers. */
export function isEnhancementMeta(raw: unknown): raw is EnhancementMeta {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  return (
    (o.provider === "local_opencv" || o.provider === "photoroom_hybrid") &&
    (o.mode === "auto" || o.mode === "flat" || o.mode === "object") &&
    typeof o.sourceHashSha256 === "string" &&
    typeof o.processedAtIso === "string" &&
    typeof o.latencyMs === "number" &&
    !!o.recipe &&
    typeof o.recipe === "object"
  );
}

/**
 * Normalize a caller-provided meta into the canonical shape written to
 * the DB. Missing / malformed fields fall back to safe defaults; a
 * completely bogus payload returns `null` so callers can persist
 * `null` (= no meta) rather than half-baked JSON.
 */
export function normalizeEnhancementMeta(
  input: unknown,
): EnhancementMeta | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const provider =
    raw.provider === "local_opencv" || raw.provider === "photoroom_hybrid"
      ? (raw.provider as EnhancementProvider)
      : null;
  if (!provider) return null;
  const mode =
    raw.mode === "auto" || raw.mode === "flat" || raw.mode === "object"
      ? (raw.mode as EnhancementMode)
      : null;
  if (!mode) return null;
  const recipeRaw = raw.recipe as Record<string, unknown> | undefined;
  if (!recipeRaw || (recipeRaw.kind !== "flat" && recipeRaw.kind !== "object")) {
    return null;
  }
  let recipe: EnhancementRecipe;
  if (recipeRaw.kind === "flat") {
    const p = (recipeRaw.params ?? {}) as Record<string, unknown>;
    const tone = (p.tone ?? {}) as Record<string, unknown>;
    recipe = {
      kind: "flat",
      params: {
        sourceCorners: normalizeCorners(p.sourceCorners),
        tone: {
          b: round3(clampTone(Number(tone.b ?? 1))),
          c: round3(clampTone(Number(tone.c ?? 1))),
          s: round3(clampTone(Number(tone.s ?? 1))),
        },
        sharpen: clampUnit(Number(p.sharpen ?? 0)),
        bezel: clampUnit(Number(p.bezel ?? 0.02)),
      },
    };
  } else {
    const p = (recipeRaw.params ?? {}) as Record<string, unknown>;
    recipe = {
      kind: "object",
      params: {
        padding: clampUnit(Number(p.padding ?? 0.06)),
        bezel: clampUnit(Number(p.bezel ?? 0)),
      },
    };
  }
  const confidenceRaw = raw.confidence;
  const confidence =
    typeof confidenceRaw === "number" && Number.isFinite(confidenceRaw)
      ? Math.min(1, Math.max(0, confidenceRaw))
      : null;
  const hash =
    typeof raw.sourceHashSha256 === "string" && /^[a-f0-9]{64}$/i.test(raw.sourceHashSha256)
      ? raw.sourceHashSha256.toLowerCase()
      : null;
  if (!hash) return null;
  const processedAt =
    typeof raw.processedAtIso === "string" && !Number.isNaN(Date.parse(raw.processedAtIso))
      ? raw.processedAtIso
      : new Date().toISOString();
  const latencyMs =
    typeof raw.latencyMs === "number" && Number.isFinite(raw.latencyMs) && raw.latencyMs >= 0
      ? Math.round(raw.latencyMs)
      : 0;
  const versionsRaw = (raw.versions ?? {}) as Record<string, unknown>;
  const versions = {
    schema:
      typeof versionsRaw.schema === "number" && Number.isFinite(versionsRaw.schema)
        ? versionsRaw.schema
        : ENHANCEMENT_META_SCHEMA_VERSION,
    engine:
      typeof versionsRaw.engine === "string" && versionsRaw.engine
        ? versionsRaw.engine
        : provider,
  };
  return {
    provider,
    mode,
    recipe,
    confidence,
    sourceHashSha256: hash,
    processedAtIso: processedAt,
    latencyMs,
    versions,
  };
}

function normalizeCorners(
  input: unknown,
): [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint] | null {
  if (!Array.isArray(input) || input.length !== 4) return null;
  const out: NormalizedPoint[] = [];
  for (const pt of input) {
    if (!Array.isArray(pt) || pt.length !== 2) return null;
    const x = Number(pt[0]);
    const y = Number(pt[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    out.push([
      Math.min(1, Math.max(0, x)),
      Math.min(1, Math.max(0, y)),
    ]);
  }
  return out as [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint];
}

function clampUnit(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Stable normalized error reason enum shared by the object route, the
 * client wrapper, and the toasts. Do not add strings without also
 * covering them in the i18n copy table.
 */
export type EnhancementErrorReason =
  | "provider_unauthorized"
  | "provider_rate_limited"
  | "provider_timeout"
  | "unsupported_format"
  | "invalid_input"
  | "not_authorized"
  | "storage_error"
  | "error";

export class EnhancementError extends Error {
  readonly reason: EnhancementErrorReason;
  readonly status: number;
  constructor(reason: EnhancementErrorReason, message?: string, status = 500) {
    super(message ?? reason);
    this.name = "EnhancementError";
    this.reason = reason;
    this.status = status;
  }
}
