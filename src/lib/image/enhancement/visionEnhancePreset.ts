import type { ArtworkLookPreset } from "@/lib/ai/types";
import type { Quad } from "@/lib/image/enhancement/cornerPickerGeometry";

/**
 * Map a vision seed onto the deterministic flat enhancer.
 *
 * The model chooses the canvas corners and how hard to push color.
 * This function only translates that choice into engine fields. It
 * does not call the network. A missing seed returns `{}` so a failed
 * vision call leaves the historical local-only enhance untouched.
 *
 * "original" keeps the captured color and adds the same small clarity
 * lift the single-upload editor bakes in. "enhance" turns on partial
 * white balance plus Pro Look. Intensity only scales that choice.
 */
export function flatPresetFromVision(seed: {
  corners: Quad | null;
  look: ArtworkLookPreset | null;
} | null): {
  sourceCorners?: Quad;
  tone?: { b: number; c: number; s: number };
  awb?: { enabled: true; wallSample: "auto"; strength: number };
  proLook?: { enabled: true };
} {
  if (!seed) return {};
  const out: {
    sourceCorners?: Quad;
    tone?: { b: number; c: number; s: number };
    awb?: { enabled: true; wallSample: "auto"; strength: number };
    proLook?: { enabled: true };
  } = {};
  if (seed.corners) out.sourceCorners = seed.corners;

  const look = seed.look;
  if (!look || look.colorMode === "original") {
    const scale =
      look?.intensity === "strong" ? 1.4 : look?.intensity === "light" ? 0.6 : 1;
    out.tone = {
      b: 1 + 0.03 * scale,
      c: 1 + 0.02 * scale,
      s: 1 + 0.05 * scale,
    };
    return out;
  }

  const strength =
    look.intensity === "strong" ? 0.7 : look.intensity === "light" ? 0.35 : 0.5;
  out.awb = { enabled: true, wallSample: "auto", strength };
  out.proLook = { enabled: true };
  return out;
}
