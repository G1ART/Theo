import { NextResponse } from "next/server";
import { handleAiRoute } from "@/lib/ai/route";
import {
  SPACE_WALL_DETECT_SCHEMA,
  SPACE_WALL_DETECT_SYSTEM,
} from "@/lib/ai/prompts";
import type {
  SpaceWallDetectLightDirection,
  SpaceWallDetectResult,
} from "@/lib/ai/types";

export const runtime = "nodejs";
/** Vision + JSON completions can occasionally push past the 30s Next.js default. */
export const maxDuration = 60;

/**
 * P1 (2026-08-19) — Automatic wall-region cleanup detector.
 *
 * The SpaceEditor auto-fires this route once per fresh room-photo upload
 * (see `SpaceEditor.handleUploadPhoto` → `runWallCleanup`). The vision
 * LLM returns a normalized wall polygon + dominant paint color; the
 * client (`src/lib/simulation/wallCleanup.ts`) turns the polygon into a
 * feathered mask and flattens low-frequency lighting artefacts INSIDE
 * the wall only. Furniture, floor, windows, and any framed art on the
 * wall are left pixel-identical.
 *
 * Contract quirks
 * ---------------
 *   - The route never writes back to `spaces`. It's a pure observation
 *     channel — the client owns the cleanup pipeline + storage swap.
 *   - Every detection is post-normalized (polygon clamped to [0, 1],
 *     RGB clamped to [0, 255], confidence to [0, 1], vertex count
 *     to 3..12). The client short-circuits on `confidence < 0.4` or
 *     `wallPolygon.length < 3`, so the "fail open" path is always
 *     structural — no cleanup is preferable to a bad cleanup.
 *
 * Entitlement + soft-cap gating reuses `handleAiRoute` (feature key
 * `space.wall_detect` maps to entitlement `simulation.2d` — see
 * `usageKeys.ts`).
 */

const ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
/** ~6 MiB decoded — safe for gpt-4o-mini vision. Matches space-calibrate. */
const MAX_BASE64_BYTES = 8 * 1024 * 1024;

const ALLOWED_LIGHT_DIRECTIONS: readonly SpaceWallDetectLightDirection[] = [
  "top",
  "top_left",
  "left",
  "bottom_left",
  "bottom",
  "bottom_right",
  "right",
  "top_right",
  "diffuse",
  "unknown",
] as const;

/** Upper bound on polygon vertices; matches the prompt's "4-8 vertices" cap
 *  with a bit of headroom for models that overshoot by one or two. */
const MAX_POLYGON_VERTICES = 12;

type WallDetectBody = {
  spaceId: string;
  imageBase64: string;
  mime: string;
  imagePxWidth: number;
  imagePxHeight: number;
};

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function clampChannel(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 255;
  return Math.round(Math.min(255, Math.max(0, n)));
}

function parseBody(
  raw: unknown,
): { ok: true; value: WallDetectBody } | { ok: false; reason: string } {
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
 * Defensive post-parse normalizer. The model is usually well-behaved
 * but we never trust the shape blindly — a bad polygon that survives
 * to the client can distort the entire upload, so we prefer to nuke
 * the whole detection (empty polygon + zero confidence) over papering
 * over a shape we can't fully validate.
 *
 * Rules:
 *   • Every vertex must be a `[number, number]` pair; each coord is
 *     clamped to [0, 1]. Non-numeric entries → drop the whole polygon.
 *   • Polygon must have 3..MAX_POLYGON_VERTICES vertices after
 *     coercion (fewer than 3 = degenerate; more than 12 = probably a
 *     hallucination — cap the tail).
 *   • RGB channels clamp to 0..255 (rounded).
 *   • Confidence clamps to [0, 1]; missing / non-numeric → 0.
 *   • `lightDirection` falls back to "unknown" when the value isn't
 *     in the closed enum.
 *   • `wallColorName` is trimmed to 40 chars so a chatty model can't
 *     smuggle a paragraph into the schema.
 */
function normalizeResult(raw: unknown): {
  wallPolygon: Array<[number, number]>;
  wallMedianRgb: [number, number, number];
  wallColorName?: string;
  confidence: number;
  lightDirection: SpaceWallDetectLightDirection;
} {
  const empty = {
    wallPolygon: [] as Array<[number, number]>,
    wallMedianRgb: [255, 255, 255] as [number, number, number],
    confidence: 0,
    lightDirection: "unknown" as SpaceWallDetectLightDirection,
  };
  if (!raw || typeof raw !== "object") return empty;
  const r = raw as Record<string, unknown>;

  let polygon: Array<[number, number]> = [];
  if (Array.isArray(r.wallPolygon)) {
    for (const v of r.wallPolygon) {
      if (!Array.isArray(v) || v.length < 2) {
        polygon = [];
        break;
      }
      const x = Number(v[0]);
      const y = Number(v[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        polygon = [];
        break;
      }
      polygon.push([clamp01(x), clamp01(y)]);
      if (polygon.length >= MAX_POLYGON_VERTICES) break;
    }
    if (polygon.length < 3) polygon = [];
  }

  let rgb: [number, number, number] = [255, 255, 255];
  if (Array.isArray(r.wallMedianRgb) && r.wallMedianRgb.length >= 3) {
    rgb = [
      clampChannel(r.wallMedianRgb[0]),
      clampChannel(r.wallMedianRgb[1]),
      clampChannel(r.wallMedianRgb[2]),
    ];
  }

  const confRaw = Number(r.confidence);
  const confidence = Number.isFinite(confRaw)
    ? Math.min(1, Math.max(0, confRaw))
    : 0;

  const lightDirection = ALLOWED_LIGHT_DIRECTIONS.includes(
    r.lightDirection as SpaceWallDetectLightDirection,
  )
    ? (r.lightDirection as SpaceWallDetectLightDirection)
    : "unknown";

  const wallColorName =
    typeof r.wallColorName === "string" && r.wallColorName.trim()
      ? r.wallColorName.trim().slice(0, 40)
      : undefined;

  return {
    wallPolygon: polygon,
    wallMedianRgb: rgb,
    ...(wallColorName ? { wallColorName } : {}),
    confidence,
    lightDirection,
  };
}

export async function POST(req: Request) {
  return handleAiRoute<WallDetectBody, SpaceWallDetectResult>(req, {
    feature: "space.wall_detect",
    validateBody: (raw) => parseBody(raw),
    async buildPromptInput({ body, userId, supabase }) {
      // Authz spot-check: the caller must own the space they're asking
      // us to reason about. RLS on `spaces` already gates read access,
      // but we make the intent explicit so a leaked access token can't
      // detect walls on arbitrary spaces (matches space-calibrate).
      const { data: ownerRow, error: ownerErr } = await supabase
        .from("spaces")
        .select("id")
        .eq("id", body.spaceId)
        .eq("owner_id", userId)
        .maybeSingle();
      if (ownerErr || !ownerRow) {
        return NextResponse.json(
          {
            wallPolygon: [],
            wallMedianRgb: [255, 255, 255],
            confidence: 0,
            lightDirection: "unknown",
            degraded: true,
            reason: "unauthorized",
          } satisfies SpaceWallDetectResult,
          { status: 403 },
        );
      }

      return {
        system: SPACE_WALL_DETECT_SYSTEM,
        user: `Analyze this room photograph and return the primary target wall polygon + dominant paint color. Photo dimensions: ${Math.round(
          body.imagePxWidth,
        )}x${Math.round(body.imagePxHeight)} px.`,
        schemaHint: SPACE_WALL_DETECT_SCHEMA,
        fallback: () => ({
          wallPolygon: [],
          wallMedianRgb: [255, 255, 255] as [number, number, number],
          confidence: 0,
          lightDirection: "unknown" as SpaceWallDetectLightDirection,
        }),
        imageInputs: [
          {
            mime: body.mime,
            base64: body.imageBase64,
            // Polygon accuracy matters — a loose polygon that swallows
            // occluders is the primary failure mode. High detail is
            // worth the token bump for a one-shot per-upload call.
            detail: "high" as const,
          },
        ],
      };
    },
  }).then(async (res) => {
    // Post-normalize the LLM output. Only touch 200 responses — 4xx/5xx
    // are already structured `degraded` envelopes.
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
        ? (bodyObj.reason as SpaceWallDetectResult["reason"])
        : undefined;
    return NextResponse.json(
      {
        ...normalized,
        ...(degraded ? { degraded: true } : {}),
        ...(reason ? { reason } : {}),
        ...(aiEventId ? { aiEventId } : {}),
      } satisfies SpaceWallDetectResult & { aiEventId?: string },
      { status: 200 },
    );
  });
}
