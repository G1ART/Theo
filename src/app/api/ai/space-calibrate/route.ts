import { NextResponse } from "next/server";
import { handleAiRoute } from "@/lib/ai/route";
import {
  SPACE_CALIBRATE_SCHEMA,
  SPACE_CALIBRATE_SYSTEM,
} from "@/lib/ai/prompts";
import type {
  SpaceCalibrateCandidate,
  SpaceCalibrateCandidateKind,
  SpaceCalibrateDimension,
  SpaceCalibrateResult,
} from "@/lib/ai/types";

export const runtime = "nodejs";
/** Vision + JSON completions can occasionally push past the 30s Next.js default. */
export const maxDuration = 60;

/**
 * P1 (2026-08-19) — Measurement-based space calibration.
 *
 * The SpaceEditor sends ONE room photo (base64) after upload. We run a
 * vision LLM once against the photo and return 2-4 candidate objects
 * (windows / doors / TVs / sofas / …) with tight normalized bboxes and
 * a natural question in both locales. The client renders one candidate
 * at a time and, on Apply, derives `pxPerCm` from
 *   pxPerCm = bboxLengthPx / userSuppliedCm
 * and writes `widthCm`/`heightCm` on the primary surface. This route
 * NEVER writes back — it's an observation channel only.
 *
 * Entitlement + soft-cap gating reuses `handleAiRoute` (feature key
 * `space.calibrate` maps to entitlement `simulation.2d` — see
 * `usageKeys.ts`).
 */

const ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BASE64_BYTES = 8 * 1024 * 1024; // ~6 MiB decoded, safe for gpt-4o-mini vision.

const ALLOWED_KINDS: readonly SpaceCalibrateCandidateKind[] = [
  "window",
  "door",
  "tv",
  "sofa",
  "table",
  "bookshelf",
  "counter",
  "rug",
  "other",
] as const;

const ALLOWED_DIMENSIONS: readonly SpaceCalibrateDimension[] = [
  "width",
  "height",
  "diagonal",
  "seat_back",
] as const;

type CalibrateBody = {
  spaceId: string;
  imageBase64: string;
  mime: string;
  imagePxWidth: number;
  imagePxHeight: number;
};

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function parseBody(
  raw: unknown,
): { ok: true; value: CalibrateBody } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "body_not_object" };
  const r = raw as Record<string, unknown>;
  const spaceId = typeof r.spaceId === "string" ? r.spaceId.trim() : "";
  if (!spaceId) return { ok: false, reason: "space_id_required" };
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
    value: { spaceId, imageBase64, mime, imagePxWidth, imagePxHeight },
  };
}

/**
 * Defensive post-parse normalizer: strips candidates that don't match
 * the schema hint (unknown kind, bbox out of [0,1], zero-length side).
 * The model is usually well-behaved but we never trust the shape blindly.
 */
function normalizeCandidates(raw: unknown): SpaceCalibrateCandidate[] {
  if (!raw || typeof raw !== "object") return [];
  const arr = (raw as { candidates?: unknown }).candidates;
  if (!Array.isArray(arr)) return [];
  const out: SpaceCalibrateCandidate[] = [];
  for (const c of arr) {
    if (!c || typeof c !== "object") continue;
    const co = c as Record<string, unknown>;
    const id = typeof co.id === "string" && co.id.trim() ? co.id.trim() : null;
    const kind = ALLOWED_KINDS.includes(co.kind as SpaceCalibrateCandidateKind)
      ? (co.kind as SpaceCalibrateCandidateKind)
      : "other";
    const labelKo = typeof co.label_ko === "string" ? co.label_ko.trim() : "";
    const labelEn = typeof co.label_en === "string" ? co.label_en.trim() : "";
    if (!labelKo && !labelEn) continue;
    const dimension = ALLOWED_DIMENSIONS.includes(co.dimension as SpaceCalibrateDimension)
      ? (co.dimension as SpaceCalibrateDimension)
      : "width";
    const bboxRaw = co.bbox as
      | { x0?: unknown; y0?: unknown; x1?: unknown; y1?: unknown }
      | undefined;
    if (!bboxRaw) continue;
    const x0 = Number(bboxRaw.x0);
    const y0 = Number(bboxRaw.y0);
    const x1 = Number(bboxRaw.x1);
    const y1 = Number(bboxRaw.y1);
    if (
      !isFiniteNumber(x0) ||
      !isFiniteNumber(y0) ||
      !isFiniteNumber(x1) ||
      !isFiniteNumber(y1)
    ) {
      continue;
    }
    // Normalize + clamp to [0, 1] and enforce x0<x1, y0<y1 (some models
    // return the corners in arbitrary order for oblique objects).
    const cx0 = Math.max(0, Math.min(1, Math.min(x0, x1)));
    const cy0 = Math.max(0, Math.min(1, Math.min(y0, y1)));
    const cx1 = Math.max(0, Math.min(1, Math.max(x0, x1)));
    const cy1 = Math.max(0, Math.min(1, Math.max(y0, y1)));
    if (cx1 - cx0 <= 0.01 || cy1 - cy0 <= 0.01) continue; // degenerate box
    const rangeRaw = co.typical_range_cm as
      | { min?: unknown; max?: unknown }
      | undefined;
    const rMin = Number(rangeRaw?.min);
    const rMax = Number(rangeRaw?.max);
    const typical_range_cm =
      isFiniteNumber(rMin) && isFiniteNumber(rMax) && rMin > 0 && rMax >= rMin
        ? { min: rMin, max: rMax }
        : { min: 30, max: 300 }; // permissive default
    const askKo = typeof co.ask_ko === "string" && co.ask_ko.trim()
      ? co.ask_ko.trim()
      : "이 물건의 실제 길이를 알려주세요";
    const askEn = typeof co.ask_en === "string" && co.ask_en.trim()
      ? co.ask_en.trim()
      : "How long is this in real life?";
    out.push({
      id: id ?? `cand_${out.length + 1}`,
      kind,
      label_ko: labelKo || labelEn,
      label_en: labelEn || labelKo,
      bbox: { x0: cx0, y0: cy0, x1: cx1, y1: cy1 },
      dimension,
      ask_ko: askKo,
      ask_en: askEn,
      typical_range_cm,
    });
    if (out.length >= 4) break;
  }
  return out;
}

export async function POST(req: Request) {
  return handleAiRoute<CalibrateBody, SpaceCalibrateResult>(req, {
    feature: "space.calibrate",
    validateBody: (raw) => parseBody(raw),
    async buildPromptInput({ body, userId, supabase }) {
      // Authz spot-check: the caller must own the space they're
      // asking us to reason about. RLS on `spaces` already gates
      // read access, but we make the intent explicit so a leaked
      // access token can't calibrate arbitrary spaces.
      const { data: ownerRow, error: ownerErr } = await supabase
        .from("spaces")
        .select("id")
        .eq("id", body.spaceId)
        .eq("owner_id", userId)
        .maybeSingle();
      if (ownerErr || !ownerRow) {
        return NextResponse.json(
          {
            candidates: [],
            degraded: true,
            reason: "unauthorized",
          } satisfies SpaceCalibrateResult,
          { status: 403 },
        );
      }

      return {
        system: SPACE_CALIBRATE_SYSTEM,
        user: `Analyze this room photo. Return a maximum of 4 candidates sorted by user-friendliness (easiest to measure first). Photo dimensions: ${Math.round(
          body.imagePxWidth,
        )}x${Math.round(body.imagePxHeight)} px.`,
        schemaHint: SPACE_CALIBRATE_SCHEMA,
        fallback: () => ({ candidates: [] }),
        imageInputs: [
          {
            mime: body.mime,
            base64: body.imageBase64,
            // Accuracy matters for bbox precision, and this call is
            // per-space one-time (guard on `photoCorners` in the
            // client) — the ~2-5x token bump vs. "low" is worth it.
            detail: "high" as const,
          },
        ],
      };
    },
  }).then(async (res) => {
    // Post-normalize the LLM output. Only touch 200 responses —
    // 4xx/5xx are already structured `degraded` envelopes.
    if (res.status !== 200) return res;
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return res;
    }
    const bodyObj = (body ?? {}) as Record<string, unknown>;
    const candidates = normalizeCandidates(bodyObj);
    const aiEventId = typeof bodyObj.aiEventId === "string" ? bodyObj.aiEventId : undefined;
    const degraded = bodyObj.degraded === true;
    const reason = typeof bodyObj.reason === "string"
      ? (bodyObj.reason as SpaceCalibrateResult["reason"])
      : undefined;
    return NextResponse.json(
      {
        candidates,
        ...(degraded ? { degraded: true } : {}),
        ...(reason ? { reason } : {}),
        ...(aiEventId ? { aiEventId } : {}),
      } satisfies SpaceCalibrateResult & { aiEventId?: string },
      { status: 200 },
    );
  });
}
