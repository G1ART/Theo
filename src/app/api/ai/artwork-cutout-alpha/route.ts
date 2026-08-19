/**
 * Display Simulation Phase 2 — Track 2 (2026-08-20).
 *
 * Photoroom-backed transparent-PNG cutout route. Callers pass an
 * `artworkId` they own; the server fetches the artwork's primary
 * `artwork_images` row through RLS, hands the bytes to Photoroom's
 * background-removal endpoint, receives the alpha PNG, uploads it
 * to the `artworks` bucket, and inserts a sibling `artwork_images`
 * row with `view_type='cutout_alpha'`.
 *
 * The simulation renderer prefers `cutout_alpha > cutout > primary`
 * so a successful call makes the placement read as a real "painting
 * on the wall" — the transparent margin lets the wall photo show
 * through, eliminating the "flat sticker with background" symptom
 * that Track 1 (bbox crop) can only partially fix.
 *
 * Entitlement stub: `simulation.premium.cutout`. Beta-unlocked for
 * every plan (see `PLAN_FEATURE_MATRIX` — comment block
 * "BETA_UNLIMITED"). The UI still labels the button "Pro" so we set
 * user expectations consistent with the post-beta gating.
 *
 * Env: `PHOTOROOM_API_KEY` must be set. When missing the route
 * short-circuits with `501` + `{ degraded: true, reason: "no_key" }`
 * so the caller can render a graceful "provider unavailable" hint —
 * Track 1 (`artwork_painting_bbox`, free) stays available and
 * unaffected.
 */

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { recordUsageEvent } from "@/lib/metering";
import { USAGE_KEYS } from "@/lib/metering/usageKeys";
import {
  resolveEntitlementFor,
  type EntitlementDecision,
} from "@/lib/entitlements";

export const runtime = "nodejs";
export const maxDuration = 60;

const PHOTOROOM_ENDPOINT = "https://sdk.photoroom.com/v1/segment";
const REQUEST_TIMEOUT_MS = 25_000;
const STORAGE_BUCKET = "artworks";

const ALLOWED_MIMES = new Set([
  "image/jpeg",
  "image/pjpeg",
  "image/png",
  "image/webp",
]);

type CutoutBody = {
  artworkId?: unknown;
};

type CutoutErrorReason =
  | "unauthorized"
  | "invalid_input"
  | "no_key"
  | "cap"
  | "provider_unauthorized"
  | "provider_rate_limited"
  | "provider_timeout"
  | "unsupported_format"
  | "not_found"
  | "storage_error"
  | "error";

function degradedResponse(
  status: number,
  reason: CutoutErrorReason,
  extra?: Record<string, unknown>,
) {
  return NextResponse.json(
    { degraded: true, reason, ...(extra ?? {}) },
    { status },
  );
}

function buildSupabaseForToken(token: string): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

async function callPhotoroomSegment(
  bytes: Uint8Array,
  filename: string,
  apiKey: string,
  upstreamSignal?: AbortSignal,
): Promise<{ blob: Blob; contentType: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onUpstreamAbort = () => controller.abort();
  if (upstreamSignal) {
    if (upstreamSignal.aborted) controller.abort();
    else upstreamSignal.addEventListener("abort", onUpstreamAbort, { once: true });
  }
  try {
    const form = new FormData();
    // v1/segment returns the subject with a real alpha channel when
    // no bg_color is supplied. We want the transparent PNG so the
    // renderer can composite over the wall photo.
    // Node's TS lib narrows `BlobPart` to `ArrayBuffer` (not
    // `ArrayBufferLike`); coerce via `.slice(0)` which yields a
    // fresh `ArrayBuffer` that satisfies the strict signature.
    form.append(
      "image_file",
      new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer]),
      filename,
    );
    form.append("format", "png");
    const res = await fetch(PHOTOROOM_ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        accept: "image/png",
      },
      body: form,
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error("provider_unauthorized");
    }
    if (res.status === 429) {
      throw new Error("provider_rate_limited");
    }
    if (res.status === 415) {
      throw new Error("unsupported_format");
    }
    if (!res.ok) {
      throw new Error(`provider_status_${res.status}`);
    }
    const contentType = res.headers.get("content-type") ?? "image/png";
    const buf = await res.arrayBuffer();
    return { blob: new Blob([buf], { type: contentType }), contentType };
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") {
      throw new Error("provider_timeout");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
    if (upstreamSignal) upstreamSignal.removeEventListener("abort", onUpstreamAbort);
  }
}

/**
 * Owner + primary-image lookup. RLS on `artworks` + `artwork_images`
 * already enforces "owner sees own rows only"; we surface the result
 * as `not_found` when the caller doesn't own the artwork so the
 * error message is identical whether the row exists but is private
 * or doesn't exist at all.
 */
async function loadPrimaryImage(
  supabase: SupabaseClient,
  userId: string,
  artworkId: string,
): Promise<
  | {
      ok: true;
      storagePath: string;
      mime: string;
      bytes: Uint8Array;
      alreadyHasAlphaCutout: boolean;
    }
  | { ok: false; reason: CutoutErrorReason }
> {
  const { data: artworkRow, error: artworkErr } = await supabase
    .from("artworks")
    .select("id, artist_id")
    .eq("id", artworkId)
    .eq("artist_id", userId)
    .maybeSingle();
  if (artworkErr) return { ok: false, reason: "error" };
  if (!artworkRow) return { ok: false, reason: "not_found" };

  const { data: images, error: imgErr } = await supabase
    .from("artwork_images")
    .select("storage_path, sort_order, view_type")
    .eq("artwork_id", artworkId)
    .order("sort_order", { ascending: true, nullsFirst: false });
  if (imgErr) return { ok: false, reason: "error" };
  const rows = (images ?? []) as {
    storage_path: string;
    sort_order: number | null;
    view_type: string | null;
  }[];
  if (rows.length === 0) return { ok: false, reason: "not_found" };

  const alreadyHasAlphaCutout = rows.some((r) => r.view_type === "cutout_alpha");
  const primary =
    rows.find((r) => r.view_type === "wall_mounted") ?? rows[0] ?? null;
  if (!primary?.storage_path) return { ok: false, reason: "not_found" };

  const { data: blob, error: downloadErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .download(primary.storage_path);
  if (downloadErr || !blob) return { ok: false, reason: "storage_error" };
  const mime = blob.type || "application/octet-stream";
  if (!ALLOWED_MIMES.has(mime.toLowerCase())) {
    return { ok: false, reason: "unsupported_format" };
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return {
    ok: true,
    storagePath: primary.storage_path,
    mime,
    bytes,
    alreadyHasAlphaCutout,
  };
}

/**
 * Best-effort PNG dimension probe. The `IHDR` chunk is at bytes 16-23
 * (big-endian width + height) for a valid PNG file — we only need
 * this to populate `artwork_images.width/height` so the renderer can
 * respect the cutout's true aspect. Falls back to `null` on any
 * decode error.
 */
function probePngDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  // PNG magic: 137 80 78 71 13 10 26 10
  if (
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (!width || !height) return null;
  return { width, height };
}

export async function POST(req: Request): Promise<NextResponse> {
  const apiKey = process.env.PHOTOROOM_API_KEY;
  if (!apiKey) {
    return degradedResponse(501, "no_key", {
      error:
        "PHOTOROOM_API_KEY not configured; advanced cutout unavailable. Track 1 (free bbox crop) still works.",
    });
  }
  try {
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : "";
    if (!token) return degradedResponse(401, "unauthorized");

    const supabase = buildSupabaseForToken(token);
    if (!supabase) return degradedResponse(500, "error", { error: "server_misconfigured" });

    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();
    if (authErr || !user) return degradedResponse(401, "unauthorized");

    let raw: CutoutBody = {};
    try {
      raw = (await req.json()) as CutoutBody;
    } catch {
      raw = {};
    }

    const artworkId =
      typeof raw.artworkId === "string" && raw.artworkId.trim()
        ? raw.artworkId.trim()
        : "";
    if (!artworkId) {
      return degradedResponse(400, "invalid_input", {
        validation: "artwork_id_required",
      });
    }

    const decision: EntitlementDecision = await resolveEntitlementFor({
      featureKey: "simulation.premium.cutout",
      userId: user.id,
      client: supabase,
    });
    if (!decision.allowed) {
      const status = decision.source === "quota_exceeded" ? 429 : 402;
      return degradedResponse(status, "cap", {
        error: "plan_required",
        paywallHint: decision.paywallHint,
        source: decision.source,
      });
    }

    const primary = await loadPrimaryImage(supabase, user.id, artworkId);
    if (!primary.ok) {
      const status =
        primary.reason === "not_found"
          ? 404
          : primary.reason === "storage_error"
            ? 502
            : primary.reason === "unsupported_format"
              ? 415
              : 500;
      return degradedResponse(status, primary.reason);
    }

    // Short-circuit if a cutout_alpha row already exists — repeat
    // clicks should be a no-op instead of racking up Photoroom
    // credits. Callers can delete the existing cutout row (future
    // work) if they want to regenerate.
    if (primary.alreadyHasAlphaCutout) {
      return NextResponse.json(
        {
          alreadyExists: true,
          message: "cutout_alpha row already exists for this artwork",
        },
        { status: 200 },
      );
    }

    let subject: { blob: Blob; contentType: string };
    try {
      subject = await callPhotoroomSegment(
        primary.bytes,
        `artwork-${artworkId}.png`,
        apiKey,
        req.signal,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const reason: CutoutErrorReason =
        msg === "provider_unauthorized" ||
        msg === "provider_rate_limited" ||
        msg === "provider_timeout" ||
        msg === "unsupported_format"
          ? (msg as CutoutErrorReason)
          : "error";
      const status =
        reason === "provider_unauthorized"
          ? 502
          : reason === "provider_rate_limited"
            ? 429
            : reason === "provider_timeout"
              ? 504
              : reason === "unsupported_format"
                ? 415
                : 500;
      return degradedResponse(status, reason, { detail: msg });
    }

    const outBytes = new Uint8Array(await subject.blob.arrayBuffer());
    const dims = probePngDimensions(outBytes);
    const uuid = crypto.randomUUID();
    const outputPath = `${user.id}/cutout/${artworkId}-${uuid}.png`;

    const { error: uploadErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(outputPath, outBytes, {
        contentType: "image/png",
        upsert: false,
        cacheControl: "3600",
      });
    if (uploadErr) {
      return degradedResponse(502, "storage_error", { error: "upload_failed" });
    }

    // Insert the sibling row. `sort_order = 100` keeps it after the
    // primary (0..N) so any surface that still sorts by `sort_order`
    // (e.g. the artwork detail carousel) shows the primary first.
    const insertPayload: Record<string, unknown> = {
      artwork_id: artworkId,
      storage_path: outputPath,
      sort_order: 100,
      view_type: "cutout_alpha",
    };
    if (dims) {
      insertPayload.width = dims.width;
      insertPayload.height = dims.height;
    }
    const { error: insertErr } = await supabase
      .from("artwork_images")
      .insert(insertPayload);
    if (insertErr) {
      // Roll back the storage upload so we don't leak an orphan file.
      await supabase.storage
        .from(STORAGE_BUCKET)
        .remove([outputPath])
        .catch(() => undefined);
      return degradedResponse(500, "error", { error: "insert_failed" });
    }

    void recordUsageEvent(
      {
        userId: user.id,
        key: USAGE_KEYS.AI_ARTWORK_CUTOUT_ALPHA_GENERATED,
        featureKey: "simulation.premium.cutout",
        metadata: {
          artwork_id: artworkId,
          provider: "photoroom_v1_segment",
          output_width_px: dims?.width ?? null,
          output_height_px: dims?.height ?? null,
          source: "space_editor",
        },
      },
      { client: supabase, dualWriteBeta: false },
    );

    return NextResponse.json(
      {
        storagePath: outputPath,
        width: dims?.width ?? null,
        height: dims?.height ?? null,
        viewType: "cutout_alpha",
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("[ai/artwork-cutout-alpha] unexpected", err);
    return degradedResponse(500, "error");
  }
}
