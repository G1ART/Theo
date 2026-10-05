/**
 * Non-blocking scheduler for the geometry render.
 *
 * The math is pure and does not touch the DOM, so it can move to a
 * Worker later. In the browser we render in row chunks and yield so
 * a confirm-and-straighten pass does not freeze the page. Abort
 * drops the buffer instead of publishing a partial image.
 */

import type { FrameWindow, RectifyPlan } from "./rectifyArtwork";
import { paintMappedRows, renderRectified, sealUncoveredArtwork } from "./rectifyArtwork";
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
  const chunk = Math.max(8, job.rowsPerChunk ?? 48);
  for (let row0 = 0; row0 < outH; row0 += chunk) {
    if (job.signal?.aborted) return "aborted";
    const row1 = Math.min(outH, row0 + chunk);
    paintMappedRows(raster, plan, frame, data, row0, row1);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
  if (job.signal?.aborted) return "aborted";
  sealUncoveredArtwork(data, outW, outH);
  return { data, width: outW, height: outH };
}
