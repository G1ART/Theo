/**
 * Studio wall shared by the rectangle crop and the Photoroom cutout.
 *
 * The subject is already a tight crop (sol quad or Photoroom alpha).
 * This pass does not look at the source photograph for a shadow. It
 * places that cutout on #f3f3f3 and stages one soft drop shadow from
 * the cutout's alpha, as if the piece were lit by a studio spotlight.
 *
 * Painted after color so brightness, contrast, and saturation do not
 * move the wall or the drop shadow. The silhouette stays the alpha
 * of the subject — a rectangle is just an opaque subject.
 *
 * Shadow parameters:
 *   blur    = max(8, round(bezelPx * 0.4))
 *   offsetY = max(4, round(bezelPx * 0.18))
 *   color   = rgba(0,0,0,0.22)
 * The shadow is baked into the pixels (nothing is left "on" for a
 * later draw to inherit). A tight crop (bezel 0) still gets the
 * standard margin, so the shadow has wall to fall on.
 */

export const STUDIO_WALL_RGB = 243;
export const STUDIO_BEZEL_FRACTION = 0.08;

export type StudioShadowParams = {
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  shadowColor: "rgba(0,0,0,0.22)";
  shadowAlpha: number;
};

export function studioShadowParams(bezelPx: number): StudioShadowParams {
  return {
    shadowBlur: Math.max(8, Math.round(bezelPx * 0.4)),
    shadowOffsetX: 0,
    shadowOffsetY: Math.max(4, Math.round(bezelPx * 0.18)),
    shadowColor: "rgba(0,0,0,0.22)",
    shadowAlpha: 0.22,
  };
}

export function studioBezelPx(
  width: number,
  height: number,
  bezel: number = STUDIO_BEZEL_FRACTION,
): number {
  const shortEdge = Math.min(width, height);
  if (!Number.isFinite(shortEdge) || shortEdge <= 0) return 0;
  const fraction = Number.isFinite(bezel) ? Math.min(0.1, Math.max(0, bezel)) : STUDIO_BEZEL_FRACTION;
  return Math.round(fraction * shortEdge);
}

/**
 * Wall around a tight crop. A positive `bezelPx` is that pad. Zero,
 * missing, or a non-finite value is not "no wall" — the crop simply
 * had no margin yet, so the standard studio fraction is used. The
 * pad is not measured from the source photo.
 */
export function resolveStudioPadPx(
  width: number,
  height: number,
  bezelPx?: number,
): number {
  if (typeof bezelPx === "number" && Number.isFinite(bezelPx) && bezelPx > 0) {
    return Math.round(bezelPx);
  }
  return Math.max(1, studioBezelPx(width, height));
}

/**
 * Clear pixels of a cutout are not black while color runs, or the
 * edge picks up a dark halo. Opaque pixels, including a thread fringe,
 * are left alone. Returns true when the buffer is a cutout.
 */
export function prepareCutoutForColor(data: Uint8ClampedArray): boolean {
  const pixels = data.length / 4;
  if (pixels < 16) return false;
  let clear = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 16) clear += 1;
  }
  if (clear / pixels < 0.002) return false;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] >= 16) continue;
    data[i] = STUDIO_WALL_RGB;
    data[i + 1] = STUDIO_WALL_RGB;
    data[i + 2] = STUDIO_WALL_RGB;
  }
  return true;
}

function gaussianKernel(sigma: number): Float32Array {
  const radius = Math.max(1, Math.ceil(sigma * 2));
  const kernel = new Float32Array(radius * 2 + 1);
  const denom = 2 * sigma * sigma;
  let sum = 0;
  for (let i = -radius; i <= radius; i += 1) {
    const v = Math.exp(-(i * i) / denom);
    kernel[i + radius] = v;
    sum += v;
  }
  for (let i = 0; i < kernel.length; i += 1) kernel[i] /= sum;
  return kernel;
}

function blurPlane(src: Float32Array, width: number, height: number, sigma: number): Float32Array {
  if (sigma < 0.5 || width < 2 || height < 2) return src;
  if (sigma > 8) {
    const scale = Math.ceil(sigma / 8);
    const sw = Math.max(1, Math.ceil(width / scale));
    const sh = Math.max(1, Math.ceil(height / scale));
    const small = new Float32Array(sw * sh);
    for (let y = 0; y < sh; y += 1) {
      const y0 = Math.min(height - 1, y * scale);
      const y1 = Math.min(height, y0 + scale);
      for (let x = 0; x < sw; x += 1) {
        const x0 = Math.min(width - 1, x * scale);
        const x1 = Math.min(width, x0 + scale);
        let acc = 0;
        let n = 0;
        for (let yy = y0; yy < y1; yy += 1) {
          const row = yy * width;
          for (let xx = x0; xx < x1; xx += 1) {
            acc += src[row + xx];
            n += 1;
          }
        }
        small[y * sw + x] = n > 0 ? acc / n : 0;
      }
    }
    const blurred = blurPlane(small, sw, sh, sigma / scale);
    const up = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
      const sy = Math.min(sh - 1, Math.max(0, (y + 0.5) / scale - 0.5));
      const y0 = Math.floor(sy);
      const y1 = Math.min(sh - 1, y0 + 1);
      const fy = sy - y0;
      const row0 = y0 * sw;
      const row1 = y1 * sw;
      const dest = y * width;
      for (let x = 0; x < width; x += 1) {
        const sx = Math.min(sw - 1, Math.max(0, (x + 0.5) / scale - 0.5));
        const x0 = Math.floor(sx);
        const x1 = Math.min(sw - 1, x0 + 1);
        const fx = sx - x0;
        const top = blurred[row0 + x0] + (blurred[row0 + x1] - blurred[row0 + x0]) * fx;
        const bot = blurred[row1 + x0] + (blurred[row1 + x1] - blurred[row1 + x0]) * fx;
        up[dest + x] = top + (bot - top) * fy;
      }
    }
    return up;
  }

  const kernel = gaussianKernel(sigma);
  const radius = (kernel.length - 1) >> 1;
  const tmp = new Float32Array(src.length);
  const dst = new Float32Array(src.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let acc = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const xx = x + k < 0 ? 0 : x + k >= width ? width - 1 : x + k;
        acc += src[row + xx] * kernel[k + radius];
      }
      tmp[row + x] = acc;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let acc = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const yy = y + k < 0 ? 0 : y + k >= height ? height - 1 : y + k;
        acc += tmp[yy * width + x] * kernel[k + radius];
      }
      dst[y * width + x] = acc;
    }
  }
  return dst;
}

function paintShadow(
  out: Uint8ClampedArray,
  outW: number,
  outH: number,
  subject: Uint8ClampedArray,
  width: number,
  height: number,
  pad: number,
  shadow: StudioShadowParams,
): void {
  // Skia-style radius → sigma, the same mapping canvas shadowBlur uses.
  // Pad with empty alpha so the blur falls off outside the silhouette
  // instead of clamping against the subject edge.
  const sigma = 0.57735 * shadow.shadowBlur + 0.5;
  const blurPad = Math.max(1, Math.ceil(sigma * 3));
  const pw = width + blurPad * 2;
  const ph = height + blurPad * 2;
  const alpha = new Float32Array(pw * ph);
  for (let y = 0; y < height; y += 1) {
    const src = y * width;
    const dest = (y + blurPad) * pw + blurPad;
    for (let x = 0; x < width; x += 1) alpha[dest + x] = subject[(src + x) * 4 + 3] / 255;
  }
  const blurred = blurPlane(alpha, pw, ph, sigma);
  const ox = shadow.shadowOffsetX;
  const oy = shadow.shadowOffsetY;
  for (let y = 0; y < ph; y += 1) {
    const dy = y - blurPad + pad + oy;
    if (dy < 0 || dy >= outH) continue;
    const row = y * pw;
    for (let x = 0; x < pw; x += 1) {
      const a = blurred[row + x] * shadow.shadowAlpha;
      if (a < 1 / 255) continue;
      const dx = x - blurPad + pad + ox;
      if (dx < 0 || dx >= outW) continue;
      const d = (dy * outW + dx) * 4;
      const keep = 1 - (a > 1 ? 1 : a);
      out[d] = out[d] * keep;
      out[d + 1] = out[d + 1] * keep;
      out[d + 2] = out[d + 2] * keep;
    }
  }
}

/**
 * Center `subject` on #f3f3f3 and paint one staged studio drop shadow
 * from its alpha. `bezelPx <= 0` still adds the standard margin.
 * An opaque rectangle and a Photoroom silhouette share this pass.
 * Shadow RGB is a darkening of the wall, never a copy of source pixels.
 */
export function compositeStudioPresentation(
  subject: Uint8ClampedArray,
  width: number,
  height: number,
  bezelPx: number,
): { data: Uint8ClampedArray; width: number; height: number } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const pad = resolveStudioPadPx(w, h, bezelPx);
  const outW = w + pad * 2;
  const outH = h + pad * 2;
  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = STUDIO_WALL_RGB;
    out[i + 1] = STUDIO_WALL_RGB;
    out[i + 2] = STUDIO_WALL_RGB;
    out[i + 3] = 255;
  }
  if (pad > 0 && subject.length >= w * h * 4) {
    paintShadow(out, outW, outH, subject, w, h, pad, studioShadowParams(pad));
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const s = (y * w + x) * 4;
      if (s + 3 >= subject.length) continue;
      const a = subject[s + 3] / 255;
      if (a <= 0) continue;
      const d = ((y + pad) * outW + (x + pad)) * 4;
      if (a >= 1) {
        out[d] = subject[s];
        out[d + 1] = subject[s + 1];
        out[d + 2] = subject[s + 2];
        out[d + 3] = 255;
        continue;
      }
      const keep = 1 - a;
      out[d] = subject[s] * a + out[d] * keep;
      out[d + 1] = subject[s + 1] * a + out[d + 1] * keep;
      out[d + 2] = subject[s + 2] * a + out[d + 2] * keep;
      out[d + 3] = 255;
    }
  }
  return { data: out, width: outW, height: outH };
}
