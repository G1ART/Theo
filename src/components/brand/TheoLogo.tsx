"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

/**
 * Theo brand mark (Aug-2026 redesign).
 *
 * Round-trip reveal — a few seconds after mount, the mark crossfades to
 * the "Theo" wordmark, holds long enough to read, and crossfades back
 * to the mark. Skipped entirely under `prefers-reduced-motion: reduce`.
 *
 * Cooldown status (2026-08-03): temporarily disabled so a plain hard
 * refresh replays the animation while we validate that the hydration
 * hotfix restored it. Once QA confirms the round-trip we plan to reinstate
 * a ~20 min localStorage-throttled cooldown so returning users don't see
 * the reveal on every navigation.
 *
 * Debug: `console.log("[TheoLogo] …")` is emitted unconditionally in this
 * validation build so the operator can see the phase transitions in
 * Console → All. When the cooldown is re-added, these logs will be gated
 * behind `?logo=debug` again.
 *
 * Implementation notes:
 *   - Opacity and transitions are set via **inline style** (not Tailwind
 *     classes) to sidestep any arbitrary-value generation issues in
 *     Tailwind 4 and any interaction with the React Compiler.
 *   - The two forms (Image mark, text wordmark) are stacked absolutely
 *     inside a shared container. Their opacities are inverted so the
 *     crossfade is symmetric.
 *   - The height comes from the caller's `className` (`h-9`, `h-12`);
 *     the image auto-flows width from its 1.46:1 canvas.
 */

const REVEAL_LAST_SHOWN_KEY = "theo:logo-reveal-last-shown-v4";
const REVEAL_START_DELAY_MS = 3000;
const REVEAL_FADE_MS = 700;
const REVEAL_HOLD_MS = 1500;

type LogoSize = "sm" | "md";

/** Font-size (px) for the wordmark overlay, sized to visually pair with
 *  the mark it's alternating with. */
const WORDMARK_FONT_PX: Record<LogoSize, number> = {
  sm: 20, // pairs with h-9 mark (36px) in Header
  md: 30, // pairs with h-12 mark (48px) in AppSidebar
};

type Phase = "mark" | "to-wordmark" | "wordmark" | "to-mark";

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
    if (typeof window === "undefined") return;

    // QA verification pass (2026-08-03): the reveal was invisible in prod
    // even after the hydration hotfix. To rule out cooldown/query-string
    // confusion we (a) always log the schedule so the console proves the
    // effect actually ran, and (b) skip the localStorage cooldown so a
    // simple hard refresh replays the animation. Once the round-trip is
    // visually confirmed we can dial the cooldown back in.
    const log = (...args: unknown[]) => {
      console.log("[TheoLogo]", ...args);
    };

    const prefersReduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (prefersReduced) {
      log("skip: prefers-reduced-motion (system setting)");
      return;
    }

    try {
      window.localStorage.setItem(REVEAL_LAST_SHOWN_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }

    log(
      `mounted — scheduling round-trip in ${REVEAL_START_DELAY_MS}ms (fade ${REVEAL_FADE_MS}, hold ${REVEAL_HOLD_MS})`,
    );

    const timers = [
      window.setTimeout(() => {
        log("phase → to-wordmark");
        setPhase("to-wordmark");
      }, REVEAL_START_DELAY_MS),
      window.setTimeout(() => {
        log("phase → wordmark");
        setPhase("wordmark");
      }, REVEAL_START_DELAY_MS + REVEAL_FADE_MS),
      window.setTimeout(() => {
        log("phase → to-mark");
        setPhase("to-mark");
      }, REVEAL_START_DELAY_MS + REVEAL_FADE_MS + REVEAL_HOLD_MS),
      window.setTimeout(() => {
        log("phase → mark (done)");
        setPhase("mark");
      }, REVEAL_START_DELAY_MS + REVEAL_FADE_MS + REVEAL_HOLD_MS + REVEAL_FADE_MS),
    ];
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, []);

  const wordmarkVisible = phase === "to-wordmark" || phase === "wordmark";
  const fadeTransition = `opacity ${REVEAL_FADE_MS}ms ease-out`;

  return (
    <span className={`relative inline-block ${className}`}>
      <Image
        src="/theo-logo.png"
        alt="Theo"
        width={984}
        height={675}
        priority={priority}
        draggable={false}
        className="block h-full w-auto select-none"
        style={{
          opacity: wordmarkVisible ? 0 : 1,
          transition: fadeTransition,
        }}
      />
      <span
        aria-hidden={!wordmarkVisible}
        className="pointer-events-none absolute inset-0 flex items-center justify-center leading-none"
        style={{
          opacity: wordmarkVisible ? 1 : 0,
          transition: fadeTransition,
          fontFamily:
            "'SUIT','Geist','Helvetica Neue',Arial,sans-serif",
          fontWeight: 500,
          fontSize: `${WORDMARK_FONT_PX[size]}px`,
          letterSpacing: "-0.01em",
          color: "currentColor",
        }}
      >
        Theo
      </span>
    </span>
  );
}
