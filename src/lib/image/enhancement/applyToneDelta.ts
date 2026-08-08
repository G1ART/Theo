"use client";

/**
 * Theo Image Enhance (Beta) — client-side re-tone helper (2026-08-07).
 *
 * Runs the "batch uniformity" and "artist portfolio coherence" corrective
 * deltas on top of an already-processed enhancement preview WITHOUT
 * re-executing the heavy stages (crop / warp / AWB / pro-look / sharpen).
 *
 * Cost model: the input is the small display copy (long-edge ≤ 2560 for
 * bulk, ≤ 4096 for single). Reading + re-encoding takes ~40 – 120 ms on
 * a modern laptop and stays under the ~150 ms budget we set for the
 * "silent refresh" UX in `bulk/page.tsx`.
 *
 * Contract:
 *   - Input is the enhanced `File` produced by `runFlatEnhancement` or
 *     the photoroom hybrid.
 *   - Output is a fresh `File` (WebP) with the tone delta baked in.
 *   - Delta clamps mirror `coherence.ts` — the caller is expected to have
 *     produced them via `computeToneDelta` with the appropriate envelope.
 *
 * We do NOT mutate the source File. Callers are responsible for revoking
 * any previous object URLs.
 */

import { flatBlobToFile } from "./localFlatEngine";

/** Maximum absolute delta accepted by this helper. Anything larger is
 *  clamped — matches the `applyToneDelta` used by `coherence.ts`. */
const CLAMP = 0.05;

type Delta = { b: number; c: number; s: number };

function clampAbs(n: number, cap: number = CLAMP): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(cap, Math.max(-cap, n));
}

function isNoop(delta: Delta): boolean {
  const eps = 1e-4;
  return (
    Math.abs(delta.b) < eps &&
    Math.abs(delta.c) < eps &&
    Math.abs(delta.s) < eps
  );
}

/**
 * Apply an additive brightness (b) + multiplicative contrast (c) +
 * multiplicative saturation (s) shift to `data` in-place. The math
 * mirrors `applyToneDelta` in `coherence.ts`:
 *   b delta is additive luminance around mid-grey (128)
 *   c delta is multiplicative around mid-grey
 *   s delta is multiplicative around the per-pixel luminance
 */
export function applyDeltaToImageData(data: Uint8ClampedArray, delta: Delta): void {
  const b = clampAbs(delta.b);
  const c = 1 + clampAbs(delta.c);
  const s = 1 + clampAbs(delta.s);
  const brightnessAdd = 128 * b;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let bl = data[i + 2];
    r = (r - 128) * c + 128 + brightnessAdd;
    g = (g - 128) * c + 128 + brightnessAdd;
    bl = (bl - 128) * c + 128 + brightnessAdd;
    const y = 0.299 * r + 0.587 * g + 0.114 * bl;
    r = y + (r - y) * s;
    g = y + (g - y) * s;
    bl = y + (bl - y) * s;
    data[i] = Math.min(255, Math.max(0, r));
    data[i + 1] = Math.min(255, Math.max(0, g));
    data[i + 2] = Math.min(255, Math.max(0, bl));
    // alpha untouched
  }
}

function makeCanvas(w: number, h: number): {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
} {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error("no_canvas_ctx");
    return { canvas, ctx };
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no_canvas_ctx");
  return { canvas, ctx };
}

function canvasToBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
): Promise<Blob | null> {
  if ("convertToBlob" in canvas) {
    return canvas
      .convertToBlob({ type: "image/webp", quality: 0.9 })
      .catch(() => null);
  }
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/webp", 0.9);
  });
}

/**
 * Re-tone an existing enhanced display file. Returns a fresh File +
 * previewUrl. On any failure returns `null` so the caller can silently
 * keep the pre-delta preview (never destructive).
 */
export async function applyToneDeltaToFile(
  source: File,
  delta: Delta,
): Promise<{ file: File; previewUrl: string } | null> {
  if (isNoop(delta)) return null;
  if (typeof createImageBitmap === "undefined") return null;
  try {
    const bitmap = await createImageBitmap(source);
    const { canvas, ctx } = makeCanvas(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0);
    try {
      bitmap.close();
    } catch {}
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    applyDeltaToImageData(imageData.data, delta);
    ctx.putImageData(imageData, 0, 0);
    const blob = await canvasToBlob(canvas);
    if (!blob) return null;
    const file = flatBlobToFile(source.name, blob);
    const previewUrl = URL.createObjectURL(file);
    return { file, previewUrl };
  } catch {
    return null;
  }
}
