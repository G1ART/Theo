import { NextResponse } from "next/server";
import { handleAiRoute } from "@/lib/ai/route";
import {
  ARTWORK_PAINTING_BBOX_SCHEMA,
  ARTWORK_PAINTING_BBOX_SYSTEM,
} from "@/lib/ai/prompts";
import type { ArtworkPaintingBboxResult } from "@/lib/ai/types";
import { parseVisionCorners } from "@/lib/image/enhancement/cornerPickerGeometry";

export const runtime = "nodejs";
/** Vision + JSON completions can occasionally push past the 30s Next.js default. */
export const maxDuration = 60;

/**
 * Display Simulation Phase 2 — Track 1 (2026-08-20).
 *
 * Vision-LLM route that returns the normalized bounding box of the
 * actual painting / photograph subject inside an uploaded artwork
 * photo. The response drives two flows:
 *
 *   1. **Upload pipeline** — after the DSP quality gate finishes,
 *      the client crops the image to the returned bbox (canvas 2D)
 *      and uploads the result as a sibling `artwork_images` row
 *      with `view_type='cutout'`. The original is NEVER replaced —
 *      the renderer just prefers the cutout when it exists.
 *   2. **SpaceEditor CTA** — an owner-only "여백 자동 제거 (AI) /
 *      Auto-remove padding" button in the inspector runs the exact
 *      same pipeline on demand for artworks that were uploaded
 *      before Track 1 shipped.
 *
 * The route intentionally biases toward `alreadyTight = true` when
 * uncertain — a false positive that skips the crop keeps the
 * primary image as-is (safe fallback), while a false negative crop
 * risks slicing into the actual artwork.
 *
 * Model choice (2026-08-19): this route ALONE is routed to `gpt-4o`
 * (see `FEATURE_MODEL_OVERRIDE` in `src/lib/ai/client.ts`) rather
 * than the shared `gpt-4o-mini` default. On production traffic the
 * mini model kept returning a symmetric 10% fallback bbox
 * ({x:0.1, y:0.1, width:0.8, height:0.8}) instead of tight edges
 * — that pattern is a lazy default (all four values coincidentally
 * distinct on symmetry axes) and defeats the whole feature. The
 * full `gpt-4o` inspects edges independently and produces
 * measurably tighter bboxes; the prompt (see
 * `ARTWORK_PAINTING_BBOX_SYSTEM`) also carries anti-fallback
 * instructions as a belt-and-suspenders guard. Cost note: this
 * feature runs at most once per artwork upload plus the on-demand
 * CTA — total volume in beta is expected to stay low, so the ~10x
 * per-token premium of gpt-4o is a small absolute cost.
 *
 * Entitlement + soft-cap gating reuses `handleAiRoute` (feature key
 * `artwork_painting_bbox` maps to entitlement `simulation.2d` —
 * beta-open to every plan, see `usageKeys.ts`). Metering fires the
 * `ai.artwork_painting_bbox.detected` key on every successful
 * (non-degraded) response.
 */

const ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
/** ~6 MiB decoded — well within gpt-4o vision limits (this route is
 *  routed to gpt-4o via FEATURE_MODEL_OVERRIDE, not the shared mini). */
const MAX_BASE64_BYTES = 8 * 1024 * 1024;
/** Above this bbox area (fraction of image), we treat the source as
 *  already-cropped even if the model didn't self-report it. Belt +
 *  suspenders — some models miss the `alreadyTight` self-flag. */
const ALREADY_TIGHT_AREA_THRESHOLD = 0.95;

type PaintingBboxBody = {
  imageBase64: string;
  mime: string;
  imagePxWidth: number;
  imagePxHeight: number;
};

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function clamp01(v: unknown, fallback = 0): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function parseBody(
  raw: unknown,
): { ok: true; value: PaintingBboxBody } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "body_not_object" };
  const r = raw as Record<string, unknown>;
  const imageBase64 = typeof r.imageBase64 === "string" ? r.imageBase64.trim() : "";
  if (!imageBase64) return { ok: false, reason: "image_required" };
  if (imageBase64.length > MAX_BASE64_BYTES) {
    return { ok: false, reason: "image_too_large" };
  }
  const mime = typeof r.mime === "string" ? r.mime.trim().toLowerCase() : "";
  if (!ALLOWED_MIMES.has(mime)) return { ok: false, reason: "mime_unsupported" };
  const imagePxWidth = Number(r.imagePxWidth);
  const imagePxHeight = Number(r.imagePxHeight);
  if (!isFiniteNumber(imagePxWidth) || imagePxWidth <= 0) {
    return { ok: false, reason: "image_width_invalid" };
  }
  if (!isFiniteNumber(imagePxHeight) || imagePxHeight <= 0) {
    return { ok: false, reason: "image_height_invalid" };
  }
  return {
    ok: true,
    value: { imageBase64, mime, imagePxWidth, imagePxHeight },
  };
}

/**
 * Defensive normalizer. Rules:
 *   • bbox coordinates clamp to [0, 1]; missing / non-numeric fields
 *     collapse the whole detection to the "full image / not
 *     confident" shape so the client skips the crop.
 *   • width/height clamped so the bbox never extends past the image
 *     edge (x + width ≤ 1, y + height ≤ 1). A model that returns
 *     out-of-frame coordinates gets a graceful reduction, not a
 *     mangled crop.
 *   • confidence clamps to [0, 1]; missing → 0.
 *   • `alreadyTight` is upgraded to `true` whenever the resulting
 *     bbox area ≥ ALREADY_TIGHT_AREA_THRESHOLD, regardless of the
 *     model's self-report. This is the belt-and-suspenders guard
 *     against models that ignore the flag.
 *   • Degenerate bboxes (width/height ≤ 0.05) collapse to full-image
 *     `alreadyTight` — a crop that small is almost certainly a model
 *     hallucination and hard to render usefully.
 */
function normalizeResult(raw: unknown): {
  bbox: { x: number; y: number; width: number; height: number };
  confidence: number;
  alreadyTight: boolean;
  hasVisibleFrame: boolean;
  corners: ArtworkPaintingBboxResult["corners"];
} {
  const fullFrame = {
    bbox: { x: 0, y: 0, width: 1, height: 1 },
    confidence: 0,
    alreadyTight: true,
    hasVisibleFrame: false,
    corners: null as ArtworkPaintingBboxResult["corners"],
  };
  if (!raw || typeof raw !== "object") return fullFrame;
  const r = raw as Record<string, unknown>;
  const bboxRaw =
    r.bbox && typeof r.bbox === "object" ? (r.bbox as Record<string, unknown>) : null;
  if (!bboxRaw) return fullFrame;

  const x = clamp01(bboxRaw.x, 0);
  const y = clamp01(bboxRaw.y, 0);
  let width = clamp01(bboxRaw.width, 0);
  let height = clamp01(bboxRaw.height, 0);
  // Keep the rectangle inside the image regardless of what the model
  // returned. A model that returns x=0.9, width=0.5 should collapse to
  // width=0.1 rather than extending to 1.4.
  if (x + width > 1) width = Math.max(0, 1 - x);
  if (y + height > 1) height = Math.max(0, 1 - y);

  const bboxArea = width * height;
  const confRaw = Number(r.confidence);
  const confidence = Number.isFinite(confRaw)
    ? Math.min(1, Math.max(0, confRaw))
    : 0;
  const hasVisibleFrame = r.hasVisibleFrame === true;
  const corners = parseVisionCorners(r.corners);

  // Degenerate crop → treat as full frame; the renderer keeps the
  // original. Preserve the model's self-reported confidence so QA
  // can still tell "the model tried but the shape was unusable".
  if (width <= 0.05 || height <= 0.05) {
    return {
      bbox: { x: 0, y: 0, width: 1, height: 1 },
      confidence,
      alreadyTight: true,
      hasVisibleFrame,
      corners,
    };
  }

  const modelAlreadyTight = r.alreadyTight === true;
  const computedAlreadyTight = bboxArea >= ALREADY_TIGHT_AREA_THRESHOLD;
  const alreadyTight = modelAlreadyTight || computedAlreadyTight;

  return {
    bbox: { x, y, width, height },
    confidence,
    alreadyTight,
    hasVisibleFrame,
    corners,
  };
}

export async function POST(req: Request) {
  return handleAiRoute<PaintingBboxBody, ArtworkPaintingBboxResult>(req, {
    feature: "artwork_painting_bbox",
    validateBody: (raw) => parseBody(raw),
    async buildPromptInput({ body }) {
      return {
        system: ARTWORK_PAINTING_BBOX_SYSTEM,
        user: `Analyze this artwork photograph. Identify the PRIMARY canvas (largest complete work if several are visible). Return its tight bbox AND the four keystoned corners (TL, TR, BR, BL) of that canvas, excluding wall, floor, and neighboring works. Photo dimensions: ${Math.round(
          body.imagePxWidth,
        )}x${Math.round(body.imagePxHeight)} px.`,
        schemaHint: ARTWORK_PAINTING_BBOX_SCHEMA,
        fallback: () => ({
          bbox: { x: 0, y: 0, width: 1, height: 1 },
          confidence: 0,
          alreadyTight: true,
          hasVisibleFrame: false,
          corners: null,
        }),
        imageInputs: [
          {
            mime: body.mime,
            base64: body.imageBase64,
            // Bbox accuracy matters — a loose bbox that swallows the
            // matte defeats the whole feature. High detail is the
            // right trade-off for this one-shot per-upload call.
            detail: "high" as const,
          },
        ],
      };
    },
  }).then(async (res) => {
    if (res.status !== 200) return res;
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return res;
    }
    const bodyObj = (body ?? {}) as Record<string, unknown>;
    const normalized = normalizeResult(bodyObj);
    const aiEventId =
      typeof bodyObj.aiEventId === "string" ? bodyObj.aiEventId : undefined;
    const degraded = bodyObj.degraded === true;
    const reason =
      typeof bodyObj.reason === "string"
        ? (bodyObj.reason as ArtworkPaintingBboxResult["reason"])
        : undefined;
    return NextResponse.json(
      {
        ...normalized,
        ...(degraded ? { degraded: true } : {}),
        ...(reason ? { reason } : {}),
        ...(aiEventId ? { aiEventId } : {}),
      } satisfies ArtworkPaintingBboxResult & { aiEventId?: string },
      { status: 200 },
    );
  });
}
