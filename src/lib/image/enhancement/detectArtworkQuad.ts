"use client";

/**
 * Vision-backed detection of the primary artwork quadrilateral in a
 * phone / studio photograph. Used by the upload AI-enhance path so we
 * crop and un-keystone the canvas itself instead of padding the whole
 * room shot.
 */

import { aiApi } from "@/lib/ai/browser";
import {
  getOrFetchVisionResult,
  prepareImageForVision,
} from "@/lib/image/enhancement/aiClient";
import {
  parseVisionCorners,
  type Quad,
} from "@/lib/image/enhancement/cornerPickerGeometry";

const MIN_CONFIDENCE = 0.5;

export async function detectArtworkQuad(file: File | Blob): Promise<Quad | null> {
  const payload = await prepareImageForVision(file, {
    maxLongEdge: 1280,
    quality: 0.9,
  });
  const result = await getOrFetchVisionResult(
    `artwork-quad:${payload.sha256}`,
    () =>
      aiApi.artworkPaintingBbox({
        imageBase64: payload.imageBase64,
        mime: payload.mime,
        imagePxWidth: payload.imagePxWidth,
        imagePxHeight: payload.imagePxHeight,
      }),
  );
  if (result.degraded) return null;
  const fromCorners = parseVisionCorners(result.corners ?? null);
  if (fromCorners && result.confidence >= MIN_CONFIDENCE) {
    return fromCorners;
  }
  return null;
}
