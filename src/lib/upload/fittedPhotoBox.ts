/**
 * Visible photo box inside a fixed slot. One scale for both sides,
 * so a portrait stays narrow and a landscape is not cropped or stretched.
 * The readiness bar uses `width`.
 */
export function fittedPhotoBox(
  naturalWidth: number,
  naturalHeight: number,
  slotWidth: number,
  slotHeight: number,
): { width: number; height: number } {
  if (
    !(naturalWidth > 0) ||
    !(naturalHeight > 0) ||
    !(slotWidth > 0) ||
    !(slotHeight > 0)
  ) {
    return { width: 0, height: 0 };
  }
  const scale = Math.min(slotWidth / naturalWidth, slotHeight / naturalHeight);
  return {
    width: naturalWidth * scale,
    height: naturalHeight * scale,
  };
}
