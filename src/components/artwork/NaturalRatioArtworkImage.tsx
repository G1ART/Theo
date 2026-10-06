"use client";

import { useState } from "react";
import { CroppedArtworkImage } from "@/components/artwork/CroppedArtworkImage";
import {
  type DisplayAdjust,
  toFilterCss,
} from "@/lib/image/displayAdjust";

/**
 * Profile and other published grids. The frame follows the picture
 * (or the artist's own display crop), so a wide or tall work is not
 * forced into a square.
 */
export function NaturalRatioArtworkImage({
  src,
  alt,
  sizes,
  adjust,
}: {
  src: string;
  alt: string;
  sizes: string;
  adjust?: DisplayAdjust | null;
}) {
  const crop = adjust?.crop;
  const filterCss = toFilterCss(adjust);
  const [ratio, setRatio] = useState<number | null>(null);

  if (!crop) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        className="block h-auto w-full object-contain"
        style={filterCss ? { filter: filterCss } : undefined}
      />
    );
  }

  return (
    <div
      className="relative w-full overflow-hidden bg-zinc-100"
      style={ratio ? { aspectRatio: String(ratio) } : { minHeight: "8rem" }}
    >
      <CroppedArtworkImage src={src} alt={alt} sizes={sizes} adjust={adjust} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        className="pointer-events-none absolute h-px w-px opacity-0"
        onLoad={(e) => {
          const img = e.currentTarget;
          if (!img.naturalWidth || !img.naturalHeight) return;
          const w = Math.min(1, Math.max(0.05, crop.w));
          const h = Math.min(1, Math.max(0.05, crop.h));
          setRatio((img.naturalWidth * w) / (img.naturalHeight * h));
        }}
      />
    </div>
  );
}
