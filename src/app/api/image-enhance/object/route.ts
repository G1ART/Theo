/**
 * Theo Image Enhance (Beta) — server route for the object hybrid.
 *
 * Flow:
 *   1. Authenticate the caller via Bearer JWT and bind a Supabase
 *      client to that token (RLS active — no service role here).
 *   2. Verify the caller owns the staging input path (either
 *      `{userId}/enhanced-staging/…` or
 *      `exhibition-media/{exhibitionId}/enhanced-staging/…` for an
 *      exhibition the caller can write to).
 *   3. Stream the staging object out of Supabase Storage, POST it to
 *      Photoroom's `/v1/segment` with `x-api-key`, compositing the
 *      returned RGBA onto a centered white background of longer-edge
 *      + 6% padding with `sharp`, encoded as WebP q88.
 *   4. Upload the composite under `{owner}/enhanced/{uuid}-…webp`.
 *   5. Best-effort delete the staging input so the temp file doesn't
 *      linger in storage.
 *   6. Emit `ai.image_enhance.completed` / `.failed` usage events.
 *
 * The route NEVER leaks `PHOTOROOM_API_KEY` — it lives in the process
 * env only and is stripped from every response payload / console log.
 */

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { recordUsageEvent } from "@/lib/metering";
import { USAGE_KEYS } from "@/lib/metering/usageKeys";
import type {
  EnhancementErrorReason,
  EnhancementMeta,
  EnhancementProvider,
  ObjectRecipe,
} from "@/lib/image/enhancement/types";
import { ENHANCEMENT_META_SCHEMA_VERSION } from "@/lib/image/enhancement/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const PHOTOROOM_ENDPOINT = "https://sdk.photoroom.com/v1/segment";
const REQUEST_TIMEOUT_MS = 25_000;
const OBJECT_PADDING = 0.06;
const OUTPUT_WEBP_QUALITY = 88;
const STORAGE_BUCKET = "artworks";
const SUPPORTED_MIMES = new Set([
  "image/jpeg",
  "image/pjpeg",
  "image/png",
  "image/webp",
]);

type ObjectEnhanceBody = {
  inputStoragePath?: unknown;
  exhibitionId?: unknown;
  mode?: unknown;
};

function normalizeReason(reason: EnhancementErrorReason): {
  status: number;
  reason: EnhancementErrorReason;
} {
  switch (reason) {
    case "not_authorized":
      return { status: 401, reason };
    case "provider_unauthorized":
      return { status: 502, reason };
    case "provider_rate_limited":
      return { status: 429, reason };
    case "provider_timeout":
      return { status: 504, reason };
    case "unsupported_format":
      return { status: 415, reason };
    case "invalid_input":
      return { status: 400, reason };
    case "storage_error":
      return { status: 502, reason };
    case "error":
    default:
      return { status: 500, reason: "error" };
  }
}

function degradedResponse(reason: EnhancementErrorReason, extra?: Record<string, unknown>) {
  const { status, reason: normalized } = normalizeReason(reason);
  return NextResponse.json(
    { degraded: true, reason: normalized, ...(extra ?? {}) },
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

function isValidStagingPath(path: string): boolean {
  if (path.length > 512) return false;
  if (path.includes("..")) return false;
  if (path.startsWith("/")) return false;
  return true;
}

/**
 * Verify the staging path is owned by the caller. Two shapes accepted:
 *   - `{userId}/enhanced-staging/*` — the caller's user folder
 *   - `exhibition-media/{exhibitionId}/enhanced-staging/*` — an
 *     exhibition the caller can write to (RLS checks membership).
 */
async function assertPathAllowed(
  supabase: SupabaseClient,
  userId: string,
  inputPath: string,
  exhibitionId: string | null,
): Promise<void> {
  if (exhibitionId) {
    const expectedPrefix = `exhibition-media/${exhibitionId}/enhanced-staging/`;
    if (!inputPath.startsWith(expectedPrefix)) {
      throw new HandlerError("not_authorized", "path_prefix_mismatch");
    }
    // Delegate exhibition-write check to RLS: attempt a HEAD-equivalent
    // signed URL creation on the input; if the user can't read/write
    // the exhibition media folder, this throws.
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(inputPath, 60);
    if (error || !data?.signedUrl) {
      throw new HandlerError("not_authorized", "exhibition_media_denied");
    }
    return;
  }
  const expected = `${userId}/enhanced-staging/`;
  if (!inputPath.startsWith(expected)) {
    throw new HandlerError("not_authorized", "path_prefix_mismatch");
  }
}

class HandlerError extends Error {
  readonly reason: EnhancementErrorReason;
  constructor(reason: EnhancementErrorReason, message?: string) {
    super(message ?? reason);
    this.reason = reason;
  }
}

async function callPhotoroom(input: Blob, filename: string): Promise<Blob> {
  const apiKey = process.env.PHOTOROOM_API_KEY;
  if (!apiKey) throw new HandlerError("provider_unauthorized", "no_api_key");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const form = new FormData();
    form.append("image_file", input, filename);
    form.append("bg_color", "FFFFFF");
    const res = await fetch(PHOTOROOM_ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        accept: "image/png, image/webp, image/*",
      },
      body: form,
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      throw new HandlerError("provider_unauthorized", "provider_denied");
    }
    if (res.status === 429) {
      throw new HandlerError("provider_rate_limited", "provider_rate_limited");
    }
    if (res.status === 415) {
      throw new HandlerError("unsupported_format", "provider_unsupported");
    }
    if (!res.ok) {
      throw new HandlerError("error", `provider_status_${res.status}`);
    }
    const contentType = res.headers.get("content-type") ?? "image/png";
    const buf = await res.arrayBuffer();
    return new Blob([buf], { type: contentType });
  } catch (err) {
    if (err instanceof HandlerError) throw err;
    if ((err as { name?: string }).name === "AbortError") {
      throw new HandlerError("provider_timeout", "photoroom_timeout");
    }
    throw new HandlerError("error", "provider_fetch_failed");
  } finally {
    clearTimeout(timeout);
  }
}

async function compositeOnWhite(subjectBytes: Buffer): Promise<{
  buffer: Buffer;
  width: number;
  height: number;
}> {
  const image = sharp(subjectBytes, { failOn: "none" });
  const metadata = await image.metadata();
  const srcW = metadata.width ?? 0;
  const srcH = metadata.height ?? 0;
  if (!srcW || !srcH) {
    throw new HandlerError("unsupported_format", "invalid_subject_dimensions");
  }
  const canvasEdge = Math.round(Math.max(srcW, srcH) * (1 + OBJECT_PADDING * 2));
  const composite = await sharp({
    create: {
      width: canvasEdge,
      height: canvasEdge,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([
      {
        input: subjectBytes,
        left: Math.round((canvasEdge - srcW) / 2),
        top: Math.round((canvasEdge - srcH) / 2),
      },
    ])
    .webp({ quality: OUTPUT_WEBP_QUALITY })
    .toBuffer({ resolveWithObject: true });
  return {
    buffer: composite.data,
    width: composite.info.width,
    height: composite.info.height,
  };
}

function sanitizeName(name: string): string {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  const base = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
  const sanitized = base
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "");
  return `${sanitized || "enhanced"}${ext || ""}`;
}

function derivedOutputName(originalName: string): string {
  const base = originalName.replace(/\.[^./\\]+$/, "") || "enhanced";
  return `${sanitizeName(base)}.webp`;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  const arr = new Uint8Array(digest);
  let out = "";
  for (let i = 0; i < arr.length; i += 1) {
    out += arr[i].toString(16).padStart(2, "0");
  }
  return out;
}

export async function POST(req: Request): Promise<NextResponse> {
  const startedAt = Date.now();
  let userIdForMetering: string | null = null;
  let modeForMetering: "auto" | "flat" | "object" = "object";
  let exhibitionIdForMetering: string | null = null;
  try {
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : "";
    if (!token) return degradedResponse("not_authorized");

    const supabase = buildSupabaseForToken(token);
    if (!supabase) return degradedResponse("error", { error: "server_misconfigured" });

    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();
    if (authErr || !user) return degradedResponse("not_authorized");
    userIdForMetering = user.id;

    let raw: ObjectEnhanceBody = {};
    try {
      raw = (await req.json()) as ObjectEnhanceBody;
    } catch {
      raw = {};
    }

    const inputPath = typeof raw.inputStoragePath === "string" ? raw.inputStoragePath : "";
    const exhibitionId =
      typeof raw.exhibitionId === "string" && raw.exhibitionId.trim()
        ? raw.exhibitionId.trim()
        : null;
    exhibitionIdForMetering = exhibitionId;
    if (raw.mode === "auto" || raw.mode === "flat" || raw.mode === "object") {
      modeForMetering = raw.mode;
    }

    if (!inputPath || !isValidStagingPath(inputPath)) {
      return degradedResponse("invalid_input", { validation: "input_path" });
    }

    void recordUsageEvent(
      {
        userId: user.id,
        key: USAGE_KEYS.AI_IMAGE_ENHANCE_REQUESTED,
        featureKey: "ai.image_enhance",
        metadata: {
          mode: modeForMetering,
          provider: "photoroom_hybrid",
          source: exhibitionId ? "exhibition_single" : "single",
          latency_ms: null,
        },
      },
      { client: supabase, dualWriteBeta: false },
    );

    try {
      await assertPathAllowed(supabase, user.id, inputPath, exhibitionId);
    } catch (err) {
      const reason = err instanceof HandlerError ? err.reason : "not_authorized";
      return degradedResponse(reason);
    }

    const { data: inputBlob, error: downloadErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(inputPath);
    if (downloadErr || !inputBlob) {
      return degradedResponse("storage_error", { error: "download_failed" });
    }

    const mime = inputBlob.type || "application/octet-stream";
    if (!SUPPORTED_MIMES.has(mime.toLowerCase())) {
      return degradedResponse("unsupported_format");
    }

    const inputBytes = new Uint8Array(await inputBlob.arrayBuffer());
    const sourceHash = await sha256Hex(inputBytes);

    let subjectBlob: Blob;
    try {
      subjectBlob = await callPhotoroom(
        new Blob([inputBytes], { type: mime }),
        derivedOutputName(inputPath.split("/").pop() ?? "input"),
      );
    } catch (err) {
      const reason = err instanceof HandlerError ? err.reason : "error";
      void recordUsageEvent(
        {
          userId: user.id,
          key: USAGE_KEYS.AI_IMAGE_ENHANCE_FAILED,
          featureKey: "ai.image_enhance",
          metadata: {
            mode: modeForMetering,
            provider: "photoroom_hybrid",
            source: exhibitionId ? "exhibition_single" : "single",
            reason,
            latency_ms: Date.now() - startedAt,
          },
        },
        { client: supabase, dualWriteBeta: false },
      );
      // Best-effort cleanup of the staging input so we don't leak.
      await supabase.storage
        .from(STORAGE_BUCKET)
        .remove([inputPath])
        .catch(() => undefined);
      return degradedResponse(reason);
    }

    const subjectBuffer = Buffer.from(await subjectBlob.arrayBuffer());
    let composite: { buffer: Buffer; width: number; height: number };
    try {
      composite = await compositeOnWhite(subjectBuffer);
    } catch (err) {
      const reason = err instanceof HandlerError ? err.reason : "error";
      return degradedResponse(reason);
    }

    const inputName = inputPath.split("/").pop() ?? "enhanced.webp";
    const outputName = derivedOutputName(inputName);
    const uuid = crypto.randomUUID();
    const outputDir = exhibitionId
      ? `exhibition-media/${exhibitionId}/enhanced`
      : `${user.id}/enhanced`;
    const outputPath = `${outputDir}/${uuid}-${outputName}`;

    const { error: uploadErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(outputPath, composite.buffer, {
        contentType: "image/webp",
        upsert: false,
      });
    if (uploadErr) {
      return degradedResponse("storage_error", { error: "upload_failed" });
    }

    // Best-effort staging cleanup — never surface as a request failure.
    await supabase.storage
      .from(STORAGE_BUCKET)
      .remove([inputPath])
      .catch(() => undefined);

    const latencyMs = Date.now() - startedAt;
    const recipe: ObjectRecipe = { padding: OBJECT_PADDING, bezel: 0 };
    const provider: EnhancementProvider = "photoroom_hybrid";
    const meta: EnhancementMeta = {
      provider,
      mode: modeForMetering,
      recipe: { kind: "object", params: recipe },
      confidence: null,
      sourceHashSha256: sourceHash,
      processedAtIso: new Date().toISOString(),
      latencyMs,
      versions: {
        schema: ENHANCEMENT_META_SCHEMA_VERSION,
        engine: "photoroom_sharp_v1",
      },
    };

    void recordUsageEvent(
      {
        userId: user.id,
        key: USAGE_KEYS.AI_IMAGE_ENHANCE_COMPLETED,
        featureKey: "ai.image_enhance",
        metadata: {
          mode: modeForMetering,
          provider,
          source: exhibitionId ? "exhibition_single" : "single",
          latency_ms: latencyMs,
        },
      },
      { client: supabase, dualWriteBeta: false },
    );

    return NextResponse.json(
      {
        enhancedPath: outputPath,
        width: composite.width,
        height: composite.height,
        latencyMs,
        provider,
        recipe,
        meta,
      },
      { status: 200 },
    );
  } catch (err) {
    // Guard the fallback path too — never let a stray throw bubble the
    // API key or internal state into the response body.
    console.error("[image-enhance/object] unexpected", err);
    if (userIdForMetering) {
      void recordUsageEvent({
        userId: userIdForMetering,
        key: USAGE_KEYS.AI_IMAGE_ENHANCE_FAILED,
        featureKey: "ai.image_enhance",
        metadata: {
          mode: modeForMetering,
          provider: "photoroom_hybrid",
          source: exhibitionIdForMetering ? "exhibition_single" : "single",
          reason: "unexpected",
          latency_ms: Date.now() - startedAt,
        },
      });
    }
    return degradedResponse("error");
  }
}
