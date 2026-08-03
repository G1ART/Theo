"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

/**
 * Theo brand mark (Aug-2026 redesign).
 *
 * Two coordinated micro-animations, both opt-out under
 * `prefers-reduced-motion: reduce`:
 *
 *  A. **Round-trip reveal** — a few seconds after the page settles, the
 *     mark crossfades to the "Theo" wordmark, holds long enough to
 *     read, and crossfades back to the mark. The intent (per PM) is a
 *     "learning moment" that pairs the two forms in the same slot so
 *     users associate mark = Theo without a jarring one-shot swap.
 *     Throttled per-device via localStorage: at most once every
 *     `REVEAL_COOLDOWN_MS`. Force-play with `?logo=reveal` on any URL.
 *
 *  B. **Settle** — on every hard page load the mark itself scales+rises
 *     into place (0.9→1, 4px→0 over 550ms) so the logo has a small
 *     physical presence when the page first draws. Animates ONLY the
 *     transform, never opacity, so it can't fight the class-driven
 *     opacity fade used by (A).
 *
 * Both effects share the same container: the mark image on layer 1 and
 * the wordmark text on layer 2, absolutely-positioned atop each other.
 * Crossfading is done by inverting `opacity-0` / `opacity-100` on the
 * two layers with a shared `transition-opacity` timing.
 *
 * Callers set only height (`h-9`, `h-12`, …). The Primary Mark canvas
 * is ~1.46:1 so the width auto-flows.
 */

/** localStorage key for the last time the round-trip reveal fired. */
const REVEAL_LAST_SHOWN_KEY = "theo:logo-reveal-last-shown-v3";
/** Don't replay more often than this. 20 min keeps it "occasional". */
const REVEAL_COOLDOWN_MS = 20 * 60 * 1000;

/** ms from mount before the reveal starts — long enough that the page
 *  has finished skeleton/image loads and the user's eyes are free to
 *  notice the logo change. */
const REVEAL_START_DELAY_MS = 3000;
/** Duration of the mark↔wordmark crossfade in each direction. */
const REVEAL_FADE_MS = 700;
/** How long the wordmark stays fully visible before fading back. */
const REVEAL_HOLD_MS = 1500;

type LogoSize = "sm" | "md";
const WORDMARK_SIZE: Record<LogoSize, string> = {
  sm: "text-xl",   // pairs with h-9 mark (Header)
  md: "text-3xl",  // pairs with h-12 mark (AppSidebar)
};

type Phase =
  /** Steady state — mark visible, wordmark hidden. Also the resting
   *  state before the reveal begins and after it completes. */
  | "mark"
  /** Wordmark fading in / mark fading out. */
  | "to-wordmark"
  /** Wordmark fully visible, held long enough to read. */
  | "wordmark"
  /** Wordmark fading out / mark fading back in. */
  | "to-mark";

export function TheoLogo({
  className = "",
  priority = false,
  size = "md",
}: {
  className?: string;
  priority?: boolean;
  size?: LogoSize;
}) {
  const [phase, setPhase] = useState<Phase>("mark");

  useEffect(() => {
    // Respect reduced-motion — no reveal, no settle. Mark just sits.
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) return;

    // Force-play affordance for QA / new-feature demos.
    const forcePlay =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("logo") === "reveal";

    let onCooldown = false;
    if (!forcePlay) {
      try {
        const last = window.localStorage.getItem(REVEAL_LAST_SHOWN_KEY);
        if (last) {
          const lastMs = Number.parseInt(last, 10);
          if (Number.isFinite(lastMs) && Date.now() - lastMs < REVEAL_COOLDOWN_MS) {
            onCooldown = true;
          }
        }
      } catch {
        // localStorage blocked → play it (missing a moment > repeating one).
      }
    }
    if (onCooldown) return;

    try {
      window.localStorage.setItem(REVEAL_LAST_SHOWN_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }

    // Schedule the four state transitions of the round-trip. Using
    // absolute-from-mount offsets (not chained setTimeouts) so cleanup
    // is a simple map over timer ids.
    const t1 = REVEAL_START_DELAY_MS;
    const t2 = t1 + REVEAL_FADE_MS;
    const t3 = t2 + REVEAL_HOLD_MS;
    const t4 = t3 + REVEAL_FADE_MS;
    const timers = [
      window.setTimeout(() => setPhase("to-wordmark"), t1),
      window.setTimeout(() => setPhase("wordmark"), t2),
      window.setTimeout(() => setPhase("to-mark"), t3),
      window.setTimeout(() => setPhase("mark"), t4),
    ];
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, []);

  // Wordmark is visible during the two "wordmark" phases.
  // Mark is visible during the two "mark" phases. Both fade with the
  // shared REVEAL_FADE_MS duration so the crossfade is symmetric.
  const wordmarkVisible = phase === "to-wordmark" || phase === "wordmark";
  const markVisible = !wordmarkVisible;

  return (
    <span className={`relative inline-block ${className}`}>
      <Image
        src="/theo-logo.png"
        alt="Theo"
        width={984}
        height={675}
        priority={priority}
        draggable={false}
        className={[
          "block h-full w-auto select-none",
          // Opacity is class-driven so the crossfade with the wordmark
          // is symmetric. Transitions only fire when the class changes.
          "transition-opacity duration-[700ms] ease-out",
          markVisible ? "opacity-100" : "opacity-0",
          // Effect B — transform-only settle-in. Skipped under reduced-
          // motion (motion-safe:). Runs once on mount; doesn't touch
          // opacity so it can't fight the reveal crossfade above.
          "motion-safe:animate-[theo-logo-settle_550ms_cubic-bezier(0.2,0.9,0.2,1)_both]",
        ].join(" ")}
      />
      <span
        aria-hidden={!wordmarkVisible}
        className={[
          "pointer-events-none absolute inset-0 flex items-center justify-center",
          "text-current font-medium tracking-tight leading-none",
          WORDMARK_SIZE[size],
          "transition-opacity duration-[700ms] ease-out",
          wordmarkVisible ? "opacity-100" : "opacity-0",
        ].join(" ")}
        style={{ fontFamily: "'SUIT','Geist','Helvetica Neue',Arial,sans-serif" }}
      >
        Theo
      </span>
    </span>
  );
}
