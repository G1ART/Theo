/**
 * Display Simulation Phase 2 — post-processing trim (2026-08-19).
 *
 * Defensive local canvas-based trim that runs AFTER the Vision LLM
 * bbox crop. Even with the stronger prompt + `gpt-4o` override, the
 * model occasionally leaves a thin sliver of near-white matte, wall
 * paint, or dark shadow padding along one or two edges of the
 * initial crop. This helper inspects the border 5% of each edge and
 * shrinks the crop whenever the border strip reads as uniform
 * near-white / near-black — i.e. clearly not part of the painting.
 *
 * Pure JS (no `document` / `canvas` refs) so it can be exercised
 * from Node tests without a canvas polyfill. The client-facing
 * wrapper that pulls `ImageData` out of an HTMLCanvasElement lives
 * in `cutoutClient.ts` and reuses this core.
 *
 * The trim is intentionally conservative:
 *   • It never expands the crop, only shrinks it.
 *   • Per-edge shrink is capped at `maxAdditionalTrimFrac` of the
 *     initial dimension along that edge (default 15%).
 *   • As soon as an interior row/column stops matching the border
 *     luminance / variance profile, trimming for that edge stops.
 *
 * The final cutout is the tighter of (model bbox, model bbox
 * further trimmed by luminance) — never looser.
 */

export type CropRect = {
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
};

export type RefinedTightBbox = CropRect & {
  trimmed: { top: number; bottom: number; left: number; right: number };
};

export type RefineTightBboxOptions = {
  /** Cap on how much of each edge we're willing to trim, as a
   *  fraction of the initial dimension along that edge. Default
   *  0.15 — a matte / letterbox rarely eats more than 15% of a
   *  reasonably cropped upload, and pushing higher risks slicing
   *  into the actual artwork on high-key paintings (a snowy
   *  landscape could read as a "white border" to the sampler). */
  maxAdditionalTrimFrac?: number;
  /** Border strip thickness used to sample the edge signature,
   *  as a fraction of the initial dimension. Default 0.05 (5%). */
  borderSamplePct?: number;
  /** Mean luminance above this counts as "near-white matte / wall".
   *  Default 235 (out of 255) — matches typical off-white paint. */
  lightLuminanceThreshold?: number;
  /** Mean luminance below this counts as "near-black shadow /
   *  letterbox". Default 20. */
  darkLuminanceThreshold?: number;
  /** Variance ceiling for the border strip. A high-variance strip
   *  (visible artwork detail) never counts as trimmable, even if
   *  its mean happens to fall in the light/dark band. Default 400
   *  — comfortably above JPEG noise, well below any real painterly
   *  gradient. */
  varianceThreshold?: number;
};

const DEFAULT_OPTIONS: Required<RefineTightBboxOptions> = {
  maxAdditionalTrimFrac: 0.15,
  borderSamplePct: 0.05,
  lightLuminanceThreshold: 235,
  darkLuminanceThreshold: 20,
  varianceThreshold: 400,
};

/**
 * Simple luminance approximation (Rec. 601 coefficients rounded to
 * integer weights). Sufficient for the "is this strip near-white
 * or near-black" test — we don't need perceptual accuracy here.
 */
export function luminance601(r: number, g: number, b: number): number {
  return (299 * r + 587 * g + 114 * b) / 1000;
}

/** Structural minimum for an ImageData-like input: what
 *  `CanvasRenderingContext2D.getImageData()` and the DOM
 *  `ImageData` class both expose. */
export type ImageDataLike = {
  data: Uint8ClampedArray | Uint8Array | number[];
  width: number;
  height: number;
};

type StripStats = {
  mean: number;
  variance: number;
};

/**
 * Compute mean + variance of the luminance samples in an
 * axis-aligned rectangle within `img`. `x0..x1` inclusive-exclusive
 * along width; `y0..y1` inclusive-exclusive along height. Returns
 * `null` for a degenerate rectangle (zero-area).
 */
function stripLuminanceStats(
  img: ImageDataLike,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): StripStats | null {
  const w = Math.max(0, x1 - x0);
  const h = Math.max(0, y1 - y0);
  const n = w * h;
  if (n <= 0) return null;
  const { data, width } = img;
  let sum = 0;
  let sumSq = 0;
  for (let y = y0; y < y1; y += 1) {
    const rowBase = y * width * 4;
    for (let x = x0; x < x1; x += 1) {
      const idx = rowBase + x * 4;
      const l = luminance601(data[idx], data[idx + 1], data[idx + 2]);
      sum += l;
      sumSq += l * l;
    }
  }
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  return { mean, variance };
}

/**
 * Returns true when the strip's mean luminance is either "near
 * white" or "near black" AND the strip's variance is below the
 * threshold. This is the "clearly padding, not artwork" signal.
 */
export function isStripTrimmable(
  stats: StripStats | null,
  opts: Required<RefineTightBboxOptions>,
): boolean {
  if (!stats) return false;
  if (stats.variance >= opts.varianceThreshold) return false;
  return (
    stats.mean >= opts.lightLuminanceThreshold ||
    stats.mean <= opts.darkLuminanceThreshold
  );
}

/**
 * Core refine loop against a pure `ImageDataLike` — separated from
 * the DOM canvas wrapper so the Node test suite can drive it with
 * synthetic pixel buffers.
 *
 * The rectangle described by `initialCropRect` is expressed in the
 * SAME pixel coordinate space as `img` (i.e. the source-image
 * space, not "0..cropW-1"). The returned rectangle stays in that
 * same space, so a caller can plug it straight back into
 * `ctx.drawImage(src, cropX, cropY, cropW, cropH, ...)`. `trimmed`
 * carries the per-edge pixel delta so metadata can log how much
 * local trim contributed on top of the model bbox.
 */
export function refineTightBboxByLuminanceFromImageData(
  img: ImageDataLike,
  initialCropRect: CropRect,
  options?: RefineTightBboxOptions,
): RefinedTightBbox {
  const opts: Required<RefineTightBboxOptions> = {
    ...DEFAULT_OPTIONS,
    ...(options ?? {}),
  };

  let { cropX, cropY, cropW, cropH } = initialCropRect;
  const initialW = cropW;
  const initialH = cropH;
  const trimmed = { top: 0, bottom: 0, left: 0, right: 0 };
  if (
    cropW <= 0 ||
    cropH <= 0 ||
    img.width <= 0 ||
    img.height <= 0 ||
    initialCropRect.cropX < 0 ||
    initialCropRect.cropY < 0
  ) {
    return { cropX, cropY, cropW, cropH, trimmed };
  }

  const maxTrimTopBottom = Math.max(
    0,
    Math.floor(initialH * opts.maxAdditionalTrimFrac),
  );
  const maxTrimLeftRight = Math.max(
    0,
    Math.floor(initialW * opts.maxAdditionalTrimFrac),
  );
  const stripThickV = Math.max(
    1,
    Math.round(initialH * opts.borderSamplePct),
  );
  const stripThickH = Math.max(
    1,
    Math.round(initialW * opts.borderSamplePct),
  );

  // --- TOP edge -----------------------------------------------------
  // Sample the initial top strip; if it reads as trimmable, walk
  // rows downward and keep trimming until the row luminance moves
  // OUT of the trimmable band.
  {
    const stripTop = stripLuminanceStats(
      img,
      cropX,
      cropY,
      cropX + cropW,
      Math.min(img.height, cropY + stripThickV),
    );
    if (isStripTrimmable(stripTop, opts)) {
      let trimTop = 0;
      while (trimTop < maxTrimTopBottom) {
        const rowY = cropY + trimTop;
        if (rowY >= img.height) break;
        const rowStats = stripLuminanceStats(
          img,
          cropX,
          rowY,
          cropX + cropW,
          rowY + 1,
        );
        if (!isStripTrimmable(rowStats, opts)) break;
        trimTop += 1;
      }
      trimmed.top = trimTop;
      cropY += trimTop;
      cropH -= trimTop;
    }
  }

  // --- BOTTOM edge --------------------------------------------------
  {
    const bottomY1 = cropY + cropH;
    const bottomStripY0 = Math.max(cropY, bottomY1 - stripThickV);
    const stripBottom = stripLuminanceStats(
      img,
      cropX,
      bottomStripY0,
      cropX + cropW,
      bottomY1,
    );
    if (isStripTrimmable(stripBottom, opts)) {
      let trimBottom = 0;
      while (trimBottom < maxTrimTopBottom) {
        const rowY = cropY + cropH - 1 - trimBottom;
        if (rowY < 0) break;
        const rowStats = stripLuminanceStats(
          img,
          cropX,
          rowY,
          cropX + cropW,
          rowY + 1,
        );
        if (!isStripTrimmable(rowStats, opts)) break;
        trimBottom += 1;
      }
      trimmed.bottom = trimBottom;
      cropH -= trimBottom;
    }
  }

  // --- LEFT edge ----------------------------------------------------
  {
    const stripLeft = stripLuminanceStats(
      img,
      cropX,
      cropY,
      Math.min(img.width, cropX + stripThickH),
      cropY + cropH,
    );
    if (isStripTrimmable(stripLeft, opts)) {
      let trimLeft = 0;
      while (trimLeft < maxTrimLeftRight) {
        const colX = cropX + trimLeft;
        if (colX >= img.width) break;
        const colStats = stripLuminanceStats(
          img,
          colX,
          cropY,
          colX + 1,
          cropY + cropH,
        );
        if (!isStripTrimmable(colStats, opts)) break;
        trimLeft += 1;
      }
      trimmed.left = trimLeft;
      cropX += trimLeft;
      cropW -= trimLeft;
    }
  }

  // --- RIGHT edge ---------------------------------------------------
  {
    const rightX1 = cropX + cropW;
    const rightStripX0 = Math.max(cropX, rightX1 - stripThickH);
    const stripRight = stripLuminanceStats(
      img,
      rightStripX0,
      cropY,
      rightX1,
      cropY + cropH,
    );
    if (isStripTrimmable(stripRight, opts)) {
      let trimRight = 0;
      while (trimRight < maxTrimLeftRight) {
        const colX = cropX + cropW - 1 - trimRight;
        if (colX < 0) break;
        const colStats = stripLuminanceStats(
          img,
          colX,
          cropY,
          colX + 1,
          cropY + cropH,
        );
        if (!isStripTrimmable(colStats, opts)) break;
        trimRight += 1;
      }
      trimmed.right = trimRight;
      cropW -= trimRight;
    }
  }

  // Safety: never invert the rectangle. If aggressive trimming
  // would collapse a side to zero, back off entirely — the model
  // bbox is still the safer output than a 0-width crop.
  if (cropW <= 0 || cropH <= 0) {
    return {
      cropX: initialCropRect.cropX,
      cropY: initialCropRect.cropY,
      cropW: initialCropRect.cropW,
      cropH: initialCropRect.cropH,
      trimmed: { top: 0, bottom: 0, left: 0, right: 0 },
    };
  }

  return { cropX, cropY, cropW, cropH, trimmed };
}

/**
 * Metadata blob written to `artwork_user_cutouts.metadata.trim` so
 * we can measure how much local trim contributed on top of the
 * model bbox across production traffic (per-edge pixel counts +
 * options that produced them). Ratios are relative to the initial
 * (model-bbox) crop dimensions.
 */
export type CutoutTrimMeta = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  initialCropW: number;
  initialCropH: number;
  refinedCropW: number;
  refinedCropH: number;
  trimmedFrac: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  options: Required<RefineTightBboxOptions>;
};

export function summarizeTrim(
  initial: CropRect,
  refined: RefinedTightBbox,
  options?: RefineTightBboxOptions,
): CutoutTrimMeta {
  const opts: Required<RefineTightBboxOptions> = {
    ...DEFAULT_OPTIONS,
    ...(options ?? {}),
  };
  const initialW = Math.max(1, initial.cropW);
  const initialH = Math.max(1, initial.cropH);
  return {
    top: refined.trimmed.top,
    bottom: refined.trimmed.bottom,
    left: refined.trimmed.left,
    right: refined.trimmed.right,
    initialCropW: initial.cropW,
    initialCropH: initial.cropH,
    refinedCropW: refined.cropW,
    refinedCropH: refined.cropH,
    trimmedFrac: {
      top: refined.trimmed.top / initialH,
      bottom: refined.trimmed.bottom / initialH,
      left: refined.trimmed.left / initialW,
      right: refined.trimmed.right / initialW,
    },
    options: opts,
  };
}
