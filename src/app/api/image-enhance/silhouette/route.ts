/**
 * Silhouette cutout for works that are not on the rectangle-corner path.
 *
 * The rectangular corner crop does not call this route. A signed-in
 * client posts the cropped file; Photoroom returns an alpha PNG.
 * When that matte is a quadrilateral (a rectangular canvas shot at an
 * angle, including a rough paint edge), we unwarp it with the same
 * homography as the rectangle crop. Circles and organic outlines keep
 * their alpha. The studio wall (#f3f3f3) and drop shadow are painted
 * later, after color, by the same pass the rectangle crop uses.
 * Nothing is written to Storage.
 *
 * Env: existing `PHOTOROOM_API_KEY`. Missing key → 501 `no_key`.
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { rectifyRectangularMatte } from "@/lib/image/enhancement/matteRectify";
import {
  appendPhotoroomQualityFields,
  PHOTOROOM_SEGMENT_MAX_EDGE,
} from "@/lib/image/enhancement/photoroomSegment";

export const runtime = "nodejs";
export const maxDuration = 60;

const PHOTOROOM_ENDPOINT = "https://sdk.photoroom.com/v1/segment";
const REQUEST_TIMEOUT_MS = 25_000;
const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED = new Set([
  "image/jpeg",
  "image/pjpeg",
  "image/png",
  "image/webp",
]);

function fail(status: number, reason: string) {
  return NextResponse.json({ degraded: true, reason }, { status });
}

/**
 * Keep the upload's pixels when they already fit the segmenter's
 * long-edge cap. Larger or sideways files are resized once, as a
 * 4:4:4 JPEG, so the canvas edge is not halved in chroma.
 */
async function prepareSegmentUpload(bytes: Uint8Array): Promise<{
  data: Uint8Array;
  type: string;
  filename: string;
}> {
  const meta = await sharp(Buffer.from(bytes), { failOn: "none" }).metadata();
  const long = Math.max(meta.width ?? 0, meta.height ?? 0);
  const needsRotate = (meta.orientation ?? 1) > 1;
  if (!needsRotate && long > 0 && long <= PHOTOROOM_SEGMENT_MAX_EDGE) {
    if (meta.format === "png") return { data: bytes, type: "image/png", filename: "artwork.png" };
    if (meta.format === "webp") return { data: bytes, type: "image/webp", filename: "artwork.webp" };
    return { data: bytes, type: "image/jpeg", filename: "artwork.jpg" };
  }
  const encoded = await sharp(Buffer.from(bytes), { failOn: "none" })
    .rotate()
    .resize({
      width: PHOTOROOM_SEGMENT_MAX_EDGE,
      height: PHOTOROOM_SEGMENT_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
    .toBuffer();
  return { data: encoded, type: "image/jpeg", filename: "artwork.jpg" };
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  if (!token) return fail(401, "not_authorized");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return fail(500, "error");
  const supabase = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return fail(401, "not_authorized");

  const apiKey = process.env.PHOTOROOM_API_KEY;
  if (!apiKey) return fail(501, "no_key");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "invalid_input");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return fail(400, "invalid_input");
  const mime = (file.type || "").toLowerCase();
  if (!ALLOWED.has(mime)) return fail(415, "unsupported_format");
  if (file.size <= 0 || file.size > MAX_BYTES) return fail(400, "invalid_input");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  req.signal.addEventListener("abort", onAbort, { once: true });
  let png: Buffer;
  try {
    const prepared = await prepareSegmentUpload(bytes);
    const body = new FormData();
    const payload = prepared.data;
    body.append(
      "image_file",
      new Blob(
        [payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) as ArrayBuffer],
        { type: prepared.type },
      ),
      prepared.filename,
    );
    appendPhotoroomQualityFields(body);
    const res = await fetch(PHOTOROOM_ENDPOINT, {
      method: "POST",
      headers: { "x-api-key": apiKey, accept: "image/png" },
      body,
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) return fail(502, "provider_unauthorized");
    if (res.status === 402) return fail(402, "provider_quota");
    if (res.status === 429) return fail(429, "provider_rate_limited");
    if (!res.ok) return fail(502, "error");
    png = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") return fail(504, "provider_timeout");
    return fail(502, "error");
  } finally {
    clearTimeout(timeout);
    req.signal.removeEventListener("abort", onAbort);
  }

  try {
    const trimmed = await sharp(png, { failOn: "none" })
      .ensureAlpha()
      .trim({ threshold: 1 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const tw = trimmed.info.width ?? 0;
    const th = trimmed.info.height ?? 0;
    if (!tw || !th || trimmed.info.channels !== 4) return fail(500, "error");
    const rgba = new Uint8ClampedArray(trimmed.data.byteLength);
    rgba.set(trimmed.data);
    let pixels: Uint8ClampedArray = rgba;
    let outW = tw;
    let outH = th;
    try {
      const rectified = rectifyRectangularMatte(rgba, tw, th);
      if (rectified.unwarped) {
        pixels = rectified.data;
        outW = rectified.width;
        outH = rectified.height;
      }
    } catch {
      // A bad quad must not drop the cutout. Organic alpha still returns.
    }
    const out = await sharp(Buffer.from(pixels), {
      raw: { width: outW, height: outH, channels: 4 },
      failOn: "none",
    })
      .webp({ quality: 90, alphaQuality: 100 })
      .toBuffer();
    return new NextResponse(new Uint8Array(out), {
      status: 200,
      headers: {
        "content-type": "image/webp",
        "cache-control": "no-store",
      },
    });
  } catch {
    return fail(500, "error");
  }
}
