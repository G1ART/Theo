"use client";

import Image from "next/image";

/**
 * Theo brand mark (Aug-2026 redesign — v3, 2026-08-04 simplification).
 *
 * ## Why this is now a static image
 *
 * Previous iterations (v1 React-state opacity, v2 pure-CSS keyframes)
 * tried to animate a swap between the mark and a separately-rendered
 * SUIT-font "Theo" wordmark. On mobile QA the transition consistently
 * read as a glitch. Root cause was NOT the timing (sequential fade,
 * crossfade, hold length — all tried). The PNG asset itself
 * (`/theo-logo.png`) is a single artistic composition that already
 * contains BOTH the arch mark AND the hand-lettered "theo" wordmark
 * integrated into one design.
 *
 * Overlaying a second sans-serif "Theo" span on top of that PNG (or
 * fading it in as the PNG fades out) inevitably produced a two-text
 * moment: the hand-lettered "theo" inside the arch competing with the
 * SUIT-font "Theo" centered in the same box. No opacity choreography
 * could hide this competition because the two glyphs occupy the same
 * visual center.
 *
 * ## Current behaviour
 *
 * Static PNG. Height comes from the caller's `className` (`h-9`,
 * `h-12`); the image auto-flows width from its 1.46:1 canvas.
 * Familiarization with the arch still happens through repeat exposure
 * — every page renders this logo — but without the swap glitch.
 *
 * Branded loading moments (auth wait / hydration) still get a subtle
 * breathe via `TheoLoadingMark`, so brand personality is preserved
 * where it matters most.
 *
 * If a future asset ships as **arch-only** (no integrated wordmark),
 * we can layer a clean SUIT-font wordmark on top and revisit the swap
 * animation.
 */

type LogoSize = "sm" | "md";

const LOGO_HEIGHT_PX: Record<LogoSize, number> = {
  sm: 36, // pairs with h-9 in Header
  md: 48, // pairs with h-12 in AppSidebar
};

export function TheoLogo({
  className = "",
  priority = false,
  size = "md",
}: {
  className?: string;
  priority?: boolean;
  /** Kept for API compatibility with call sites that pair the logo
   *  with sibling text. Currently unused because the wordmark is
   *  baked into the PNG. */
  size?: LogoSize;
}) {
  return (
    <span
      className={`relative inline-block ${className}`}
      data-theo-logo="static"
      data-logo-height={LOGO_HEIGHT_PX[size]}
    >
      <Image
        src="/theo-logo.png"
        alt="Theo"
        width={984}
        height={675}
        priority={priority}
        draggable={false}
        className="block h-full w-auto select-none"
      />
    </span>
  );
}
