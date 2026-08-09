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
 * Auto White Balance channel multipliers, clamped to [0.7, 1.4] so
 * saturated single-hue works (a monochrome red painting, a full-blue
 * cyanotype) never get pushed toward neutral gray by accident.
 *
 * `source` records whether the estimate came from the whole downsampled
 * frame (gray-world) or from the outside-of-rectangle region only
 * (wall-biased — much more accurate when the analyzer detected a flat
 * framed work with visible wall around it).
 */
export type AwbRecipe = {
  rMul: number;
  gMul: number;
  bMul: number;
  source: "gray-world" | "wall-biased";
};

/**
 * Pro-look pipeline flags (2026-08-06). All fields optional and
 * skippable via `null`; missing values fall back to sensible defaults.
 * See `src/lib/image/enhancement/proLook.ts` for the exact math.
 */
export type ProLookRecipe = {
  exposureLumaTarget?: number;
  claheEnabled?: boolean;
  claheClipLimit?: number;
  claheTiles?: number;
  satBoost?: number;
  warmthBias?: number;
  /**
   * G3 (2026-08-10) — adaptive-tunable overlays. When present the
   * engine passes them into `ProLookConfig`; when absent the engine
   * falls back to `PRO_LOOK_DEFAULTS`. Persisted only when a caller
   * intentionally wrote them into the recipe.
   */
  unsharpAmount?: number;
  highlightCompress?: number;
};

/**
 * Flat artwork parameters. `sourceCorners` are the four corner points
 * (TL, TR, BR, BL) the local engine warped from. `tone` is the same
 * ±15% clamped brightness/contrast/saturation triple the analyzer
 * suggests. `sharpen` is a scalar 0..1 (small unsharp mask). `bezelPx`
 * is the white bezel added around the warped image (as a fraction of
 * the shorter edge, typically ~0.02).
 *
 * `awb` and `proLook` are 2026-08-06 extensions. Both are optional so
 * legacy rows (`enhancement_meta = NULL` or v1 flat recipes without
 * these fields) keep working — readers must handle their absence.
 */
export type FlatRecipe = {
  sourceCorners: [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint] | null;
  tone: { b: number; c: number; s: number };
  sharpen: number;
  bezel: number;
  awb?: AwbRecipe;
  proLook?: ProLookRecipe;
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
/**
 * Batch-uniformity provenance (2026-08-06). Populated when the operator
 * turned on the "Bulk tone unify" chip and a corrective delta was
 * applied. All deltas are clamped to ±5% by the applier.
 */
export type BatchNormalizationMeta = {
  targetLuma: number;
  targetChroma: number;
  targetSat: number;
  appliedDeltas: { b: number; c: number; s: number };
};

/**
 * Artist-portfolio coherence provenance (2026-08-06). Populated when
 * the operator kept the "Artist portfolio tone coherence" chip ON and
 * an adjustment was applied. Deltas clamped to ±4% by the applier.
 * `sampleCount` records how many prior public works the target stats
 * were computed from; when < 3 the coherence step is skipped entirely.
 */
export type PortfolioCoherenceMeta = {
  targetStats: {
    meanLuma: number;
    meanChroma: number;
    meanSat: number;
    meanContrast: number;
  };
  appliedDeltas: { b: number; c: number; s: number };
  sampleCount: number;
};

/**
 * Capture provenance surfaced by the EXIF reader (2026-08-06). Only
 * the compact fields listed here land in the DB — never GPS, never
 * personal fields, never a full EXIF dump.
 */
export type CaptureProvenance = {
  /** ISO timestamp of DateTimeOriginal; falls back to file.lastModified. */
  capturedAtIso: string | null;
  /** Compact "Make Model (Lens)" string when available, else null. */
  captureDevice: string | null;
};

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
  /** Batch-uniformity provenance (bulk only). Absent for single-image
   *  enhancements and for bulk batches with the chip OFF. */
  batchNormalization?: BatchNormalizationMeta;
  /** Artist-portfolio coherence provenance. Absent when the chip was
   *  OFF or the artist has < 3 prior public works. */
  portfolioCoherence?: PortfolioCoherenceMeta;
  /** ISO capture time (falls back to file.lastModified). */
  capturedAtIso?: string | null;
  /** Compact device string, e.g. "Apple iPhone 15 Pro (iPhone 15 Pro back triple camera)". */
  captureDevice?: string | null;
};

/** Current schema version for `EnhancementMeta`. Bump when readers must
 *  discriminate between old and new payloads.
 *
 *  v2 (2026-08-06) added the optional `awb` + `proLook` sub-recipes,
 *  `batchNormalization`, `portfolioCoherence`, `capturedAtIso`, and
 *  `captureDevice` fields. All are optional so v1 payloads still
 *  validate — the schema bump lets telemetry (`.completed` events)
 *  distinguish enhance sessions that produced pro-look output vs the
 *  legacy pipeline without reading every field. */
export const ENHANCEMENT_META_SCHEMA_VERSION = 2;

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
    const awbRaw = p.awb as Record<string, unknown> | undefined;
    const proRaw = p.proLook as Record<string, unknown> | undefined;
    const awb = awbRaw && typeof awbRaw === "object"
      ? {
          rMul: clampAwbMul(Number(awbRaw.rMul ?? 1)),
          gMul: clampAwbMul(Number(awbRaw.gMul ?? 1)),
          bMul: clampAwbMul(Number(awbRaw.bMul ?? 1)),
          source: (awbRaw.source === "wall-biased" ? "wall-biased" : "gray-world") as
            | "gray-world"
            | "wall-biased",
        }
      : undefined;
    const proLook = proRaw && typeof proRaw === "object"
      ? {
          exposureLumaTarget:
            typeof proRaw.exposureLumaTarget === "number"
              ? Math.max(60, Math.min(200, Math.round(proRaw.exposureLumaTarget)))
              : undefined,
          claheEnabled:
            typeof proRaw.claheEnabled === "boolean" ? proRaw.claheEnabled : undefined,
          claheClipLimit:
            typeof proRaw.claheClipLimit === "number"
              ? Math.max(0.5, Math.min(6, proRaw.claheClipLimit))
              : undefined,
          claheTiles:
            typeof proRaw.claheTiles === "number"
              ? Math.max(2, Math.min(16, Math.round(proRaw.claheTiles)))
              : undefined,
          satBoost:
            typeof proRaw.satBoost === "number"
              ? Math.max(0, Math.min(0.2, proRaw.satBoost))
              : undefined,
          warmthBias:
            typeof proRaw.warmthBias === "number"
              ? Math.max(-0.1, Math.min(0.1, proRaw.warmthBias))
              : undefined,
        }
      : undefined;
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
        ...(awb ? { awb } : {}),
        ...(proLook ? { proLook } : {}),
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
  const batchRaw = raw.batchNormalization as Record<string, unknown> | undefined;
  const batchNormalization =
    batchRaw && typeof batchRaw === "object"
      ? normalizeBatchNormalization(batchRaw)
      : undefined;
  const portfolioRaw = raw.portfolioCoherence as Record<string, unknown> | undefined;
  const portfolioCoherence =
    portfolioRaw && typeof portfolioRaw === "object"
      ? normalizePortfolioCoherence(portfolioRaw)
      : undefined;
  const capturedAtIso =
    typeof raw.capturedAtIso === "string" && !Number.isNaN(Date.parse(raw.capturedAtIso))
      ? raw.capturedAtIso
      : null;
  const captureDevice =
    typeof raw.captureDevice === "string" && raw.captureDevice.trim()
      ? raw.captureDevice.slice(0, 200)
      : null;
  return {
    provider,
    mode,
    recipe,
    confidence,
    sourceHashSha256: hash,
    processedAtIso: processedAt,
    latencyMs,
    versions,
    ...(batchNormalization ? { batchNormalization } : {}),
    ...(portfolioCoherence ? { portfolioCoherence } : {}),
    ...(capturedAtIso ? { capturedAtIso } : {}),
    ...(captureDevice ? { captureDevice } : {}),
  };
}

function clampAwbMul(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(1.4, Math.max(0.7, n));
}

function normalizeBatchNormalization(
  raw: Record<string, unknown>,
): BatchNormalizationMeta | undefined {
  const deltas = raw.appliedDeltas as Record<string, unknown> | undefined;
  if (!deltas || typeof deltas !== "object") return undefined;
  const clamp5 = (n: unknown): number => {
    const v = Number(n);
    if (!Number.isFinite(v)) return 0;
    return Math.min(0.05, Math.max(-0.05, v));
  };
  return {
    targetLuma: Number(raw.targetLuma ?? 0) || 0,
    targetChroma: Number(raw.targetChroma ?? 0) || 0,
    targetSat: Number(raw.targetSat ?? 0) || 0,
    appliedDeltas: {
      b: clamp5(deltas.b),
      c: clamp5(deltas.c),
      s: clamp5(deltas.s),
    },
  };
}

function normalizePortfolioCoherence(
  raw: Record<string, unknown>,
): PortfolioCoherenceMeta | undefined {
  const target = raw.targetStats as Record<string, unknown> | undefined;
  const deltas = raw.appliedDeltas as Record<string, unknown> | undefined;
  if (!target || !deltas) return undefined;
  const clamp4 = (n: unknown): number => {
    const v = Number(n);
    if (!Number.isFinite(v)) return 0;
    return Math.min(0.04, Math.max(-0.04, v));
  };
  const sampleCount = Number(raw.sampleCount ?? 0);
  return {
    targetStats: {
      meanLuma: Number(target.meanLuma ?? 0) || 0,
      meanChroma: Number(target.meanChroma ?? 0) || 0,
      meanSat: Number(target.meanSat ?? 0) || 0,
      meanContrast: Number(target.meanContrast ?? 0) || 0,
    },
    appliedDeltas: {
      b: clamp4(deltas.b),
      c: clamp4(deltas.c),
      s: clamp4(deltas.s),
    },
    sampleCount: Number.isFinite(sampleCount) ? Math.max(0, Math.round(sampleCount)) : 0,
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
