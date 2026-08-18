"use client";

/**
 * Shared vision-client infrastructure for artwork upload AI features
 * (2026-08-19).
 *
 * Two follow-up features (auto-corners, medium classifier) will reuse
 * the same encode/dedup path this helper establishes for the pre-flight
 * quality gate, so the encoding and cache logic lives here rather than
 * inside each individual API caller.
 *
 * Design contract
 * ---------------
 *   - `prepareImageForVision` downscales to `maxLongEdge` (default 768
 *     px — matches the audit's cost assumption; low-detail vision at
 *     that resolution is enough for coarse binary block/warn verdicts)
 *     and re-encodes as JPEG (default q=0.85). Base64 is stripped of
 *     any `data:` URL prefix so the payload can be sent straight to
 *     the OpenAI vision route (`data:` prefix is added by the server's
 *     `generateJSON` helper).
 *   - `getOrFetchVisionResult` dedups across the current upload
 *     session by `${sha256}:${featureKey}` — a single artist re-opening
 *     the same photo in the wizard should not trigger a fresh vision
 *     call, but switching artworks obviously should.
 *   - Cache lives in-memory only. Tab reload clears it; that is
 *     intentional (see "Non-goals" in the audit — no server-side dedup
 *     for MVP because vision calls are per-user and short-lived).
 *
 * No external dependencies. Uses the browser's `OffscreenCanvas` when
 * available (Chrome, mobile Safari 16.4+, Firefox 105+) and falls
 * back to a `<canvas>` element otherwise so the helper works on every
 * modern target.
 */

const DEFAULT_MAX_LONG_EDGE = 768;
const DEFAULT_JPEG_QUALITY = 0.85;

export type VisionImagePayload = {
  /** Raw base64 (no `data:` prefix). */
  imageBase64: string;
  /** Always `image/jpeg` after re-encode. Kept explicit for the API. */
  mime: string;
  /** Pixel width of the downscaled JPEG (matches base64 payload). */
  imagePxWidth: number;
  /** Pixel height of the downscaled JPEG. */
  imagePxHeight: number;
  /** Lowercase hex of SHA-256 over the downscaled JPEG bytes. */
  sha256: string;
};

export type PrepareVisionOptions = {
  /** Long-edge cap in pixels; longer edge is scaled to this, shorter
   *  edge scales proportionally. Defaults to 768. */
  maxLongEdge?: number;
  /** JPEG quality passed to `canvas.toBlob`. Defaults to 0.85. */
  quality?: number;
};

/**
 * Downscale, JPEG-encode, and hash a `File`/`Blob` for a vision API.
 * The output is a canonical `VisionImagePayload` every artwork-upload
 * AI route accepts as a body sub-field (`imageBase64` + `mime` +
 * `imagePxWidth` + `imagePxHeight`).
 */
export async function prepareImageForVision(
  file: File | Blob,
  options?: PrepareVisionOptions,
): Promise<VisionImagePayload> {
  const maxLongEdge = clampInt(
    options?.maxLongEdge ?? DEFAULT_MAX_LONG_EDGE,
    64,
    4096,
  );
  const quality = clampUnit(options?.quality ?? DEFAULT_JPEG_QUALITY);

  const decoded = await decodeOriented(file);
  const src = "bitmap" in decoded ? decoded.bitmap : decoded.image;
  const srcW = decoded.width;
  const srcH = decoded.height;
  const longEdge = Math.max(srcW, srcH);
  const scale = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1;
  const outW = Math.max(1, Math.round(srcW * scale));
  const outH = Math.max(1, Math.round(srcH * scale));

  const { canvas, ctx, kind } = createRenderTarget(outW, outH);
  ctx.drawImage(src as CanvasImageSource, 0, 0, outW, outH);
  const blob = await canvasToBlob(canvas, kind, "image/jpeg", quality);
  if ("bitmap" in decoded) {
    try {
      decoded.bitmap.close();
    } catch {
      /* ignore */
    }
  }
  if (!blob) {
    throw new Error("vision_encode_failed");
  }
  const bytes = await blob.arrayBuffer();
  const [imageBase64, sha256] = await Promise.all([
    encodeBase64(bytes),
    sha256Hex(bytes),
  ]);
  return {
    imageBase64,
    mime: "image/jpeg",
    imagePxWidth: outW,
    imagePxHeight: outH,
    sha256,
  };
}

// ─────────────────────────────────────────────────────────────────────
// In-memory dedup cache
// ─────────────────────────────────────────────────────────────────────

const cache = new Map<string, Promise<unknown>>();

/**
 * Return a cached promise for `key` or invoke `fetcher` and remember
 * the result. Rejected promises are removed so the caller can retry.
 *
 * The cache is intentionally in-memory + session-scoped: a full page
 * reload clears it, and there is no size cap (MVP upload sessions
 * touch < ~50 photos). If we ever see growth, an LRU wrapper here is
 * the simplest fix.
 */
export function getOrFetchVisionResult<T>(
  key: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  const existing = cache.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const pending = fetcher().catch((err) => {
    cache.delete(key);
    throw err;
  });
  cache.set(key, pending as Promise<unknown>);
  return pending;
}

/** Clear the dedup cache. Exposed for tests and user-triggered
 *  "re-analyze" flows. */
export function clearVisionCache(): void {
  cache.clear();
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function clampUnit(n: number): number {
  if (!Number.isFinite(n)) return 0.85;
  return Math.min(1, Math.max(0.1, n));
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

type DecodedSource =
  | { bitmap: ImageBitmap; width: number; height: number }
  | { image: HTMLImageElement; width: number; height: number };

async function decodeOriented(file: File | Blob): Promise<DecodedSource> {
  if (typeof createImageBitmap !== "undefined") {
    try {
      const bmp = await createImageBitmap(file, {
        imageOrientation: "from-image",
      } as ImageBitmapOptions);
      return { bitmap: bmp, width: bmp.width, height: bmp.height };
    } catch {
      try {
        const bmp = await createImageBitmap(file);
        return { bitmap: bmp, width: bmp.width, height: bmp.height };
      } catch {
        /* fall through to <img> */
      }
    }
  }
  const image = await loadFile(file);
  return {
    image,
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
  };
}

function loadFile(file: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve(img);
      setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* ignore */
        }
      }, 0);
    };
    img.onerror = (err) => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
      reject(err);
    };
    img.src = url;
  });
}

type RenderTargetKind = "offscreen" | "canvas";

type RenderTarget = {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  kind: RenderTargetKind;
};

function createRenderTarget(w: number, h: number): RenderTarget {
  if (typeof OffscreenCanvas !== "undefined") {
    try {
      const off = new OffscreenCanvas(w, h);
      const ctx = off.getContext("2d");
      if (ctx) return { canvas: off, ctx, kind: "offscreen" };
    } catch {
      /* fall through */
    }
  }
  const el = document.createElement("canvas");
  el.width = w;
  el.height = h;
  const ctx = el.getContext("2d");
  if (!ctx) throw new Error("canvas_2d_unavailable");
  return { canvas: el, ctx, kind: "canvas" };
}

async function canvasToBlob(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  kind: RenderTargetKind,
  mime: string,
  quality: number,
): Promise<Blob | null> {
  if (kind === "offscreen") {
    try {
      const blob = await (canvas as OffscreenCanvas).convertToBlob({
        type: mime,
        quality,
      });
      return blob ?? null;
    } catch {
      return null;
    }
  }
  return new Promise<Blob | null>((resolve) => {
    try {
      (canvas as HTMLCanvasElement).toBlob(
        (blob) => resolve(blob),
        mime,
        quality,
      );
    } catch {
      resolve(null);
    }
  });
}

async function encodeBase64(bytes: ArrayBuffer): Promise<string> {
  const u8 = new Uint8Array(bytes);
  // Chunked conversion — btoa fails on very long strings in Safari
  // when we hand it the full base64 in one call. 8 KiB chunks are
  // large enough that we don't allocate excess arrays but small
  // enough to keep the stack happy.
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < u8.length; i += CHUNK) {
    const slice = u8.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...slice);
  }
  return typeof btoa === "function" ? btoa(binary) : "";
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const subtle =
    typeof crypto !== "undefined" && "subtle" in crypto ? crypto.subtle : null;
  if (!subtle) return "0".repeat(64);
  try {
    const digest = await subtle.digest("SHA-256", bytes);
    const view = new Uint8Array(digest);
    let out = "";
    for (let i = 0; i < view.length; i += 1) {
      out += view[i].toString(16).padStart(2, "0");
    }
    return out;
  } catch {
    return "0".repeat(64);
  }
}
