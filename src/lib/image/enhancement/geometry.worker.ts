/**
 * Non-blocking scheduler for the geometry render.
 *
 * The math is pure and does not touch the DOM, so it can move to a
 * Worker later. In the browser we render in row chunks and yield so
 * a confirm-and-straighten pass does not freeze the page. Abort
 * drops the buffer instead of publishing a partial image.
 */

import type { FrameWindow, RectifyPlan } from "./rectifyArtwork";
import { mapUnitToSource, renderRectified, sampleBilinear, sourceToBuffer } from "./rectifyArtwork";
import type { Raster } from "./geometryPlan";

export type GeometryJob = {
  raster: Raster;
  plan: RectifyPlan;
  frame: FrameWindow;
  signal?: AbortSignal;
  rowsPerChunk?: number;
};

export async function renderRectifiedYielding(job: GeometryJob): Promise<Raster | "aborted"> {
  const { raster, plan, frame } = job;
  if (job.signal?.aborted) return "aborted";
  if (plan.kind === "copy" && plan.copyRect) {
    return renderRectified(raster, plan, frame);
  }
  const outW = plan.recipe.target.width;
  const outH = plan.recipe.target.height;
  const data = new Uint8ClampedArray(outW * outH * 4);
  const inside = plan.mask
    ? (ix: number, iy: number) => plan.mask![iy * raster.width + ix] === 1
    : undefined;
  const chunk = Math.max(8, job.rowsPerChunk ?? 48);
  for (let row0 = 0; row0 < outH; row0 += chunk) {
    if (job.signal?.aborted) return "aborted";
    const row1 = Math.min(outH, row0 + chunk);
    for (let row = row0; row < row1; row += 1) {
      for (let col = 0; col < outW; col += 1) {
        const source = mapUnitToSource(plan, (col + 0.5) / outW, (row + 0.5) / outH);
        if (!source) continue;
        const buf = sourceToBuffer(source, frame);
        const sample = sampleBilinear(raster, buf[0], buf[1], inside);
        if (!sample) continue;
        const di = (row * outW + col) * 4;
        data[di] = sample.r <= 0 ? 0 : sample.r >= 255 ? 255 : Math.round(sample.r);
        data[di + 1] = sample.g <= 0 ? 0 : sample.g >= 255 ? 255 : Math.round(sample.g);
        data[di + 2] = sample.b <= 0 ? 0 : sample.b >= 255 ? 255 : Math.round(sample.b);
        data[di + 3] = sample.a <= 0 ? 0 : sample.a >= 255 ? 255 : Math.round(sample.a);
      }
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
  return { data, width: outW, height: outH };
}
