/**
 * Silhouette cutout for non-rectangular works (circle, oval, organic).
 *
 * The rectangular corner crop does not call this route. A signed-in
 * client posts the original file; Photoroom returns an alpha PNG; we
 * trim to the subject and center it on the gallery matte (#f3f3f3).
 * The response is the WebP itself — nothing is written to Storage.
 *
 * Env: existing `PHOTOROOM_API_KEY`. Missing key → 501 `no_key`.
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

export const runtime = "nodejs";
export const maxDuration = 60;

const PHOTOROOM_ENDPOINT = "https://sdk.photoroom.com/v1/segment";
const REQUEST_TIMEOUT_MS = 25_000;
const MAX_BYTES = 20 * 1024 * 1024;
const MATTE = { r: 243, g: 243, b: 243, alpha: 1 } as const;
const PAD_FRACTION = 0.08;

const ALLOWED = new Set([
  "image/jpeg",
  "image/pjpeg",
  "image/png",
  "image/webp",
]);

function fail(status: number, reason: string) {
  return NextResponse.json({ degraded: true, reason }, { status });
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
    const body = new FormData();
    body.append(
      "image_file",
      new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: mime }),
      "artwork.jpg",
    );
    body.append("format", "png");
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
    const trimmed = await sharp(png).trim({ threshold: 1 }).png().toBuffer({ resolveWithObject: true });
    const sw = trimmed.info.width ?? 1;
    const sh = trimmed.info.height ?? 1;
    const pad = Math.max(8, Math.round(Math.min(sw, sh) * PAD_FRACTION));
    const out = await sharp({
      create: {
        width: sw + pad * 2,
        height: sh + pad * 2,
        channels: 4,
        background: MATTE,
      },
    })
      .composite([{ input: trimmed.data, left: pad, top: pad }])
      .webp({ quality: 90 })
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
