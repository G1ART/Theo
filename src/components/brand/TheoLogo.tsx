"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

/**
 * Theo brand mark (Aug-2026 redesign).
 *
 * Round-trip reveal — on hard page load the mark crossfades to the
 * "Theo" wordmark, holds ~1.5 s, and crossfades back. **Plays exactly
 * once per hard page load**; subsequent SPA navigations (which can
 * remount TheoLogo when the enclosing AppShell layout swaps) are
 * suppressed via a `sessionStorage` guard keyed on
 * `performance.timeOrigin`.
 *
 * Why `timeOrigin`?
 *   A plain sessionStorage "seen" flag would survive both refresh AND
 *   SPA nav, so a refresh (which the user does expect to replay) would
 *   be skipped. `performance.timeOrigin` is stamped fresh on every
 *   hard nav / reload but is stable across SPA navs in the same page
 *   load, so it uniquely identifies "this browser page load" without
 *   needing to distinguish between refresh flavors.
 *
 * Implementation is **pure CSS keyframes**
 * (`theo-mark-reveal` / `theo-wordmark-reveal` in `globals.css`), not
 * React-state opacity transitions. The state approach was invisible in
 * Safari on prod because next/image's own style pipeline was clobbering
 * inline `opacity` writes; compositor-driven keyframes sidestep the
 * pipeline entirely.
 *
 * Skipped under `prefers-reduced-motion: reduce` — omit the animation
 * classes so both layers stay static (mark opaque, wordmark hidden).
 *
 * Implementation notes:
 *   - The two forms are stacked absolutely inside a shared container;
 *     they share the same 4-second timing so the crossfades match.
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

const SEEN_ORIGIN_KEY = "theo:logo-seen-origin-v1";
const REVEAL_DURATION_MS = 4000;

export function TheoLogo({
  className = "",
  priority = false,
  size = "md",
}: {
  className?: string;
  priority?: boolean;
  size?: LogoSize;
}) {
  // Static SSR (no animation) → client swaps in the animated variant
  // only when this is a fresh page load AND motion is allowed.
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const prefersReduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (prefersReduced) {
      console.log("[TheoLogo] skip: prefers-reduced-motion");
      return;
    }

    let currentOrigin: number;
    try {
      currentOrigin = performance.timeOrigin;
    } catch {
      currentOrigin = Date.now();
    }

    try {
      const raw = window.sessionStorage.getItem(SEEN_ORIGIN_KEY);
      const seenOrigin = raw ? Number.parseFloat(raw) : NaN;
      if (
        Number.isFinite(seenOrigin) &&
        Math.abs(seenOrigin - currentOrigin) < 1
      ) {
        console.log(
          "[TheoLogo] skip: already played this page load (SPA remount)",
        );
        return;
      }
      window.sessionStorage.setItem(SEEN_ORIGIN_KEY, String(currentOrigin));
    } catch {
      // sessionStorage blocked (private mode etc.) — play anyway; a
      // possible replay on SPA nav is preferable to silent skip.
    }

    console.log(
      `[TheoLogo] playing once (${REVEAL_DURATION_MS}ms reveal, then rests)`,
    );
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAnimate(true);
  }, []);

  // Compositor-driven one-shot keyframes. `both` fill-mode keeps the
  // mark painted at opacity 1 before the first keyframe fires and
  // freezes the final state after 4s.
  const markAnimation = animate
    ? `theo-mark-reveal ${REVEAL_DURATION_MS}ms ease-in-out 1 both`
    : "none";
  const wordmarkAnimation = animate
    ? `theo-wordmark-reveal ${REVEAL_DURATION_MS}ms ease-in-out 1 both`
    : "none";

  return (
    <span
      className={`relative inline-block ${className}`}
      data-theo-logo={animate ? "reveal" : "static"}
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
