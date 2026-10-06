"use client";

import Image from "next/image";
import { getArtworkImageUrl } from "@/lib/supabase/artworks";

type Props = {
  /** Storage path or absolute URL. When null/empty, the band renders nothing. */
  coverImagePath: string | null | undefined;
  /** Vertical focal point (0–100). Defaults to 50 (center). */
  positionY?: number | null;
  /** Optional accessible name. Profile covers are decorative by default. */
  alt?: string;
};

function resolveSrc(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return getArtworkImageUrl(path, "medium");
}

/**
 * Public-facing profile cover/hero band. Renders nothing when no cover is
 * set — we don't want an empty grey box on profiles that opt out.
 */
export function ProfileCoverBand({ coverImagePath, positionY, alt = "" }: Props) {
  if (!coverImagePath) return null;
  const src = resolveSrc(coverImagePath);
  const focal = clampPercent(positionY);
  return (
    <div className="relative mb-6 aspect-[3/1] w-full overflow-hidden rounded-xl bg-zinc-100">
      <Image
        src={src}
        alt={alt}
        fill
        sizes="(max-width: 768px) 100vw, 768px"
        priority
        className="object-contain"
        style={{ objectPosition: `center ${focal}%` }}
      />
    </div>
  );
}

function clampPercent(v: number | null | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 50;
  if (v < 0) return 0;
  if (v > 100) return 100;
  return v;
}
