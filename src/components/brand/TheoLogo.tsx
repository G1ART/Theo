"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

/**
 * Theo brand mark (Aug-2026 redesign).
 *
 * Round-trip reveal — every 20 seconds the mark briefly crossfades to
 * the "Theo" wordmark and back. Implemented as **pure CSS keyframes**
 * (`theo-mark-cycle` / `theo-wordmark-cycle` in `globals.css`) so the
 * animation is driven entirely by the browser's compositor. This is
 * deliberate: an earlier React-state + inline-style approach was
 * invisible in Safari on prod because the inline `opacity` transition
 * on `next/image` was being clobbered by next/image's own style
 * handling. Compositor-driven keyframes sidestep the whole pipeline.
 *
 * Skipped under `prefers-reduced-motion: reduce` — we simply omit the
 * animation classes so both layers stay in their static positions
 * (mark opaque, wordmark hidden).
 *
 * QA affordance: `console.log("[TheoLogo] …")` on mount so operators
 * can confirm the component is actually rendering. The animation
 * itself is visible in Elements → Computed → animations rather than a
 * per-phase log.
 *
 * Implementation notes:
 *   - The two forms are stacked absolutely inside a shared container;
 *     they share the same 30-second timing so the crossfades match.
 *   - Height comes from the caller's `className` (`h-9`, `h-12`); the
 *     image auto-flows width from its 1.46:1 canvas.
 *   - Wordmark uses `var(--font-suit)` (not the literal name `'SUIT'`)
 *     because next/font hashes the family; the literal silently falls
 *     through to a system fallback.
 */

type LogoSize = "sm" | "md";

/** Font-size (px) for the wordmark overlay, sized to visually pair with
 *  the mark it's alternating with. */
const WORDMARK_FONT_PX: Record<LogoSize, number> = {
  sm: 20, // pairs with h-9 mark (36px) in Header
  md: 30, // pairs with h-12 mark (48px) in AppSidebar
};

export function TheoLogo({
  className = "",
  priority = false,
  size = "md",
}: {
  className?: string;
  priority?: boolean;
  size?: LogoSize;
}) {
  // Static SSR (no animation) → then the client swaps in the animated
  // variant. Prevents any hydration surprise from the animation class,
  // and lets us honor prefers-reduced-motion after mount.
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    console.log("[TheoLogo] mounted — CSS reveal loop engaging (20s cycle)");
    const prefersReduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (prefersReduced) {
      console.log("[TheoLogo] skip: prefers-reduced-motion");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAnimate(true);
  }, []);

  // Compositor-driven keyframes. `both` fill-mode keeps the mark
  // painted at opacity 1 before the first keyframe fires so there's no
  // flash. Wordmark defaults to opacity 0 to match.
  const markAnimation = animate
    ? "theo-mark-cycle 20s ease-in-out infinite both"
    : "none";
  const wordmarkAnimation = animate
    ? "theo-wordmark-cycle 20s ease-in-out infinite both"
    : "none";

  return (
    <span
      className={`relative inline-block ${className}`}
      data-theo-logo={animate ? "animated" : "static"}
    >
      <Image
        src="/theo-logo.png"
        alt="Theo"
        width={984}
        height={675}
        priority={priority}
        draggable={false}
        className="block h-full w-auto select-none"
        style={{
          animation: markAnimation,
        }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex items-center justify-center leading-none"
        style={{
          opacity: 0,
          fontFamily:
            "var(--font-suit), var(--font-geist-sans), 'Helvetica Neue', Arial, sans-serif",
          fontWeight: 600,
          fontSize: `${WORDMARK_FONT_PX[size]}px`,
          letterSpacing: "-0.01em",
          color: "currentColor",
          animation: wordmarkAnimation,
        }}
      >
        Theo
      </span>
    </span>
  );
}
