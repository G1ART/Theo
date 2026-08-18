import { NextResponse } from "next/server";
import { handleAiRoute } from "@/lib/ai/route";
import {
  ARTWORK_QUALITY_GATE_SCHEMA,
  ARTWORK_QUALITY_GATE_SYSTEM,
} from "@/lib/ai/prompts";
import type {
  ArtworkQualityGateIssue,
  ArtworkQualityGateResult,
  ArtworkQualityGateSeverity,
} from "@/lib/ai/types";

export const runtime = "nodejs";
/** Vision + JSON completions can occasionally push past the 30s Next.js default. */
export const maxDuration = 60;

/**
 * 2026-08-19 — Pre-flight artwork quality gate.
 *
 * Runs BEFORE the DSP enhancement pipeline (perspective / AWB /
 * Pro Look). Uses `handleAiRoute` for auth / soft-cap / event log /
 * metering. Vision detail is intentionally "low" — the model just
 * needs to distinguish "definitely bad" (motion blur, moiré, majority
 * out-of-frame) from "usable" for a binary block/warn/ok verdict.
 *
 * Fail-open contract
 * ------------------
 * Every degraded response path (no OpenAI key, timeout, rate limit,
 * upstream auth failure, parse failure, entitlement short-circuit)
 * flows through the shared fallback which returns
 * `{ usable: true, severity: "ok", degraded: true }`. This is by
 * design — AI infrastructure blips MUST NEVER hard-block a legitimate
 * upload. The DSP pipeline's own quality heuristics
 * (`analyzeImageFile`) still run on the full-res image separately.
 */

const ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
/**
 * ~6 MiB decoded is safe for gpt-4o-mini vision at detail=low. The
 * browser helper (`prepareImageForVision`) downscales to 768 px long
 * edge and re-encodes as JPEG at q=0.85 so we normally see ~50-150
 * KiB of base64 — the 8 MiB cap is a safety belt against callers
 * that skip the helper.
 */
const MAX_BASE64_BYTES = 8 * 1024 * 1024;

const ALLOWED_ISSUES: readonly ArtworkQualityGateIssue[] = [
  "blur",
  "motion_blur",
  "glare",
  "highlight_clip",
  "shadow_clip",
  "low_resolution",
  "moire",
  "reproduction",
  "occlusion",
  "poor_framing",
] as const;

const ALLOWED_SEVERITIES: readonly ArtworkQualityGateSeverity[] = [
  "ok",
  "warn",
  "block",
] as const;

const ALLOWED_CONTEXT_HINTS = new Set([
  "flat_2d",
  "sculpture_3d",
  "unknown",
] as const);

type ContextHint = "flat_2d" | "sculpture_3d" | "unknown";

type QualityGateBody = {
  imageBase64: string;
  mime: string;
  imagePxWidth: number;
  imagePxHeight: number;
  contextHint?: ContextHint;
};

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function parseBody(
  raw: unknown,
): { ok: true; value: QualityGateBody } | { ok: false; reason: string } {
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
  let contextHint: ContextHint | undefined;
  if (typeof r.contextHint === "string") {
    const h = r.contextHint.trim() as ContextHint;
    if (ALLOWED_CONTEXT_HINTS.has(h)) contextHint = h;
  }
  return {
    ok: true,
    value: {
      imageBase64,
      mime,
      imagePxWidth,
      imagePxHeight,
      ...(contextHint ? { contextHint } : {}),
    },
  };
}

function fallbackResult(): ArtworkQualityGateResult {
  return {
    usable: true,
    severity: "ok",
    issues: [],
    reshootAdviceKo: "",
    reshootAdviceEn: "",
    scores: { sharpness: 0.5, glare: 0, exposure: 0.5, framing: 0.5 },
  };
}

/**
 * Defensive post-parse normalizer. Trusts the schema hint but drops
 * unknown issue enum values and clamps every score into [0, 1] so the
 * client never has to guard against malformed model output. Unknown
 * severities collapse to "ok" (fail-open — see route header).
 */
function normalizeResult(raw: unknown): ArtworkQualityGateResult {
  if (!raw || typeof raw !== "object") return fallbackResult();
  const r = raw as Record<string, unknown>;
  const severity: ArtworkQualityGateSeverity = ALLOWED_SEVERITIES.includes(
    r.severity as ArtworkQualityGateSeverity,
  )
    ? (r.severity as ArtworkQualityGateSeverity)
    : "ok";
  const issuesIn = Array.isArray(r.issues) ? r.issues : [];
  const issues: ArtworkQualityGateIssue[] = [];
  for (const it of issuesIn) {
    if (
      typeof it === "string" &&
      ALLOWED_ISSUES.includes(it as ArtworkQualityGateIssue) &&
      !issues.includes(it as ArtworkQualityGateIssue)
    ) {
      issues.push(it as ArtworkQualityGateIssue);
    }
    if (issues.length >= 10) break;
  }
  const scoresRaw = (r.scores ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number): number => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(1, Math.max(0, n));
  };
  const scores = {
    sharpness: num(scoresRaw.sharpness, 0.5),
    glare: num(scoresRaw.glare, 0),
    exposure: num(scoresRaw.exposure, 0.5),
    framing: num(scoresRaw.framing, 0.5),
  };
  // `usable` is a derived flag but the model's own opinion counts as
  // a tie-breaker when severity is warn (usable = true) or block
  // (usable = false). We do not honor `usable = false` when severity
  // is "ok" — that would be inconsistent with the prompt contract.
  const usable = severity !== "block";
  const reshootAdviceKo =
    typeof r.reshootAdviceKo === "string"
      ? r.reshootAdviceKo.trim().slice(0, 240)
      : "";
  const reshootAdviceEn =
    typeof r.reshootAdviceEn === "string"
      ? r.reshootAdviceEn.trim().slice(0, 240)
      : "";
  return {
    usable,
    severity,
    issues,
    reshootAdviceKo,
    reshootAdviceEn,
    scores,
    degraded: r.degraded === true ? true : undefined,
    reason:
      typeof r.reason === "string"
        ? (r.reason as ArtworkQualityGateResult["reason"])
        : undefined,
  };
}

export async function POST(req: Request) {
  return handleAiRoute<QualityGateBody, ArtworkQualityGateResult>(req, {
    feature: "artwork_quality_gate",
    validateBody: (raw) => parseBody(raw),
    async buildPromptInput({ body }) {
      const contextHint = body.contextHint ?? "unknown";
      return {
        system: ARTWORK_QUALITY_GATE_SYSTEM,
        // Photo dimensions in the user prompt give the model a size
        // sanity check for the low-resolution issue class ("would the
        // work be recognizable at display size?") without needing a
        // separate high-detail vision call.
        user: `Evaluate this artwork photo (native ${Math.round(
          body.imagePxWidth,
        )}x${Math.round(body.imagePxHeight)} px, hint: ${contextHint}). Return JSON only.`,
        schemaHint: ARTWORK_QUALITY_GATE_SCHEMA,
        fallback: fallbackResult,
        imageInputs: [
          {
            mime: body.mime,
            base64: body.imageBase64,
            // "low" detail is the audit's cost assumption. The DSP
            // pipeline runs its own high-res analyze pass separately;
            // this gate only needs coarse binary categorization.
            detail: "low" as const,
          },
        ],
      };
    },
  }).then(async (res) => {
    // Post-normalize the LLM output on 200 responses. Non-200
    // responses are already structured `degraded` envelopes shaped by
    // `handleAiRoute`; we don't want to strip the `error` sub-field
    // some of them carry.
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
    return NextResponse.json(
      { ...normalized, ...(aiEventId ? { aiEventId } : {}) },
      { status: 200 },
    );
  });
}
