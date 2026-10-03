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
import type { ArtworkLookPreset } from "@/lib/ai/types";
import {
  parseVisionCorners,
  type Quad,
} from "@/lib/image/enhancement/cornerPickerGeometry";

const MIN_CONFIDENCE = 0.5;

export type ArtworkVisionSeed = {
  corners: Quad | null;
  confidence: number;
  look: ArtworkLookPreset | null;
};

export async function detectArtworkQuad(file: File | Blob): Promise<ArtworkVisionSeed | null> {
  const payload = await prepareImageForVision(file, {
    // 1280 is the size the rectangle corners were tuned on. 1600 added
    // upload time without a tighter quad.
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
  const corners =
    fromCorners && result.confidence >= MIN_CONFIDENCE ? fromCorners : null;
  return {
    corners,
    confidence: result.confidence,
    look: result.look ?? null,
  };
}
