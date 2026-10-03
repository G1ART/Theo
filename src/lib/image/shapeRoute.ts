import type { EllipseFit } from "@/lib/image/enhancement/ellipse";

export type NormBox = { x: number; y: number; w: number; h: number };

/**
 * Local, instant route. A round subject that does not fill the frame
 * is sent to background removal. A rectangular canvas — even one shot
 * at an angle — stays on the vision corner path.
 *
 * Room edges can make `rectangleConfidence` high while a tondo still
 * sits in the middle. A confident, modest ellipse wins in that case.
 */
export function prefersRoundCutout(input: {
  ellipse: EllipseFit | null;
}): boolean {
  const ellipse = input.ellipse;
  if (!ellipse || ellipse.confidence < 0.6) return false;
  if (ellipse.aspect > 1.55) return false;
  const area = Math.PI * ellipse.major * ellipse.minor;
  if (area < 0.04 || area > 0.7) return false;
  return true;
}

/** Axis-aligned box around the ellipse, with a little wall left in frame. */
export function boxAroundEllipse(ellipse: EllipseFit, pad = 0.045): NormBox {
  const [cx, cy] = ellipse.center;
  const c = Math.cos(ellipse.angle);
  const s = Math.sin(ellipse.angle);
  const hx = Math.hypot(ellipse.major * c, ellipse.minor * s);
  const hy = Math.hypot(ellipse.major * s, ellipse.minor * c);
  const x = clamp01(cx - hx - pad);
  const y = clamp01(cy - hy - pad);
  const w = Math.min(1 - x, hx * 2 + pad * 2);
  const h = Math.min(1 - y, hy * 2 + pad * 2);
  return { x, y, w: Math.max(0.08, w), h: Math.max(0.08, h) };
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
