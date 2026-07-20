"use client";

import Image, { type ImageProps } from "next/image";
import {
  type DisplayAdjust,
  toFilterCss,
} from "@/lib/image/displayAdjust";

/**
 * Grid-only artwork image renderer that applies non-destructive
 * `display_adjust` (tone filter + crop) on top of a standard
 * `<Image fill object-contain>` (feed image standardization,
 * 2026-07-20).
 *
 * The detail / lightbox surfaces MUST NOT use this — they render
 * `ArtworkImageStage` which always shows the original pixels.
 *
 * Rendering strategy
 * ------------------
 * - No crop: identical to a plain `<Image fill object-contain>` with
 *   optional CSS `filter:` on top. Zero geometric change vs. before
 *   this feature.
 * - Crop present: an absolutely-positioned inner wrapper is sized to
 *   `100/w % × 100/h %` (i.e. the full uncropped image, expanded
 *   larger than the outer container) and translated by
 *   `(-x/w, -y/h)` so the crop rect aligns with the outer container.
 *   The container's `overflow-hidden` clips everything outside the
 *   crop rect.
 *
 * The math: given crop rect (x, y, w, h) in [0,1] on the original
 * image and outer container of size (Cw, Ch), the inner wrapper has
 * size (Cw/w, Ch/h) positioned so that the crop rect origin sits at
 * (0, 0) of the container. Because we use `object-contain` inside the
 * inner wrapper (not the container), the image scales to fit the
 * larger wrapper — so the visible portion inside the container reads
 * as the crop rect of the original image. Any aspect mismatch between
 * the cropped image and the container reveals as letterbox bleed,
 * consistent with our contain-everywhere framing policy.
 */
type Props = {
  src: string;
  alt: string;
  /** REQUIRED: caller must wrap this in an `aspect-*` + `relative
   *  overflow-hidden` container. */
  sizes: ImageProps["sizes"];
  /** Adjustments to apply. `null` / `undefined` = render the original. */
  adjust?: DisplayAdjust | null;
  /** Pass through to `next/image`. */
  priority?: boolean;
  loading?: ImageProps["loading"];
  /** Optional class on the `<img>` element itself (e.g. hover scale). */
  imgClassName?: string;
  /** Optional inline style on the `<img>` element (rarely needed). */
  imgStyle?: React.CSSProperties;
};

export function CroppedArtworkImage({
  src,
  alt,
  sizes,
  adjust,
  priority = false,
  loading,
  imgClassName = "",
  imgStyle,
}: Props) {
  const filterCss = toFilterCss(adjust);
  const crop = adjust?.crop;

  const combinedImgStyle: React.CSSProperties = {
    ...(filterCss ? { filter: filterCss } : {}),
    ...(imgStyle ?? {}),
  };

  const imageClass = ["object-contain", imgClassName]
    .filter(Boolean)
    .join(" ");

  if (!crop) {
    return (
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        loading={loading}
        className={imageClass}
        style={
          Object.keys(combinedImgStyle).length ? combinedImgStyle : undefined
        }
      />
    );
  }

  // Crop math (see file header). Clamp to sane bounds so a corrupt
  // payload can't blow the layout — the DB-side normalizer already
  // does this but defense in depth is cheap.
  const w = Math.min(1, Math.max(0.05, crop.w));
  const h = Math.min(1, Math.max(0.05, crop.h));
  const x = Math.min(1, Math.max(0, crop.x));
  const y = Math.min(1, Math.max(0, crop.y));

  return (
    <div
      className="absolute inset-0"
      style={{
        // The inner wrapper represents the FULL uncropped image, sized
        // so the crop rect aligns with the outer container after we
        // translate it by the crop origin.
        left: `${(-x / w) * 100}%`,
        top: `${(-y / h) * 100}%`,
        width: `${(100 / w).toFixed(3)}%`,
        height: `${(100 / h).toFixed(3)}%`,
      }}
    >
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        loading={loading}
        className={imageClass}
        style={
          Object.keys(combinedImgStyle).length ? combinedImgStyle : undefined
        }
      />
    </div>
  );
}
