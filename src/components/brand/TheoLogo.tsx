"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

/**
 * Theo brand mark (Aug-2026 redesign).
 *
 * Round-trip reveal — a few seconds after mount, the mark crossfades to
 * the "Theo" wordmark, holds long enough to read, and crossfades back
 * to the mark. Repeats no more than once every `REVEAL_COOLDOWN_MS`
 * (localStorage-throttled per device). Skipped entirely under
 * `prefers-reduced-motion: reduce`.
 *
 * QA affordances via URL query:
 *   - `?logo=reveal` — bypass cooldown and play immediately.
 *   - `?logo=debug`  — bypass cooldown AND emit phase transitions to
 *                      `console.log` so we can confirm the effect is
 *                      firing in a broken environment.
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
const REVEAL_COOLDOWN_MS = 20 * 60 * 1000;
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

    const query = new URLSearchParams(window.location.search).get("logo");
    const forcePlay = query === "reveal" || query === "debug";
    const debug = query === "debug";
    const log = (...args: unknown[]) => {
      if (debug) console.log("[TheoLogo]", ...args);
    };

    const prefersReduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (prefersReduced) {
      log("skip: prefers-reduced-motion");
      return;
    }

    if (!forcePlay) {
      try {
        const last = window.localStorage.getItem(REVEAL_LAST_SHOWN_KEY);
        if (last) {
          const lastMs = Number.parseInt(last, 10);
          const age = Date.now() - lastMs;
          if (Number.isFinite(lastMs) && age < REVEAL_COOLDOWN_MS) {
            log(
              `skip: on cooldown (age ${Math.round(age / 1000)}s, need ${
                REVEAL_COOLDOWN_MS / 1000
              }s)`,
            );
            return;
          }
        }
      } catch {
        // localStorage blocked → err on the side of playing.
      }
    }

    try {
      window.localStorage.setItem(REVEAL_LAST_SHOWN_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }

    log(
      `scheduled — starts in ${REVEAL_START_DELAY_MS}ms (fade ${REVEAL_FADE_MS}, hold ${REVEAL_HOLD_MS})`,
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
