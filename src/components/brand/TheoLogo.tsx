"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

/**
 * Theo brand mark (Aug-2026 redesign).
 *
 * Two coordinated micro-animations, both opt-out under
 * `prefers-reduced-motion: reduce`:
 *
 *  A. **Session reveal** — the very first time this component mounts in
 *     a browser session, we briefly overlay the "Theo" wordmark on top
 *     of the mark, hold, and crossfade it away. The intent (per PM) is
 *     to bridge users from the pre-redesign text-only logo to the new
 *     Primary Mark without the abrupt "did the site change?" beat.
 *
 *  B. **Settle** — on every fresh page load the mark itself animates in
 *     with a subtle scale + fade (0.96 → 1.0, 0.85 → 1.0 over 350ms).
 *     Because the AppShell persists across client-side navigations,
 *     this only fires on true page loads, not on tab clicks — which is
 *     exactly the "loading moment" we want to fill with brand presence.
 *
 * Both effects share the same container so the two forms occupy the
 * same slot without layout jitter. The Primary Mark's canvas is
 * ~1.46:1, so callers set only the height (`h-9`, `h-12`, …) and let
 * width flow.
 *
 * If the designer ships an official SVG later, replace the `<Image>`
 * import site with the SVG — no caller changes needed.
 */

const SESSION_REVEAL_KEY = "theo:logo-reveal-seen-v1";

type Phase =
  /** SSR / pre-hydration — render mark statically so there's no FOUC. */
  | "static"
  /** Session first-mount — wordmark visible, holding before crossfade. */
  | "reveal-hold"
  /** Wordmark fading out, mark taking over. */
  | "reveal-crossfade"
  /** Steady state — mark alone. */
  | "done";

/** Callers only ever ship two slot sizes today (header/sidebar). This
 *  drives the wordmark overlay's font-size so its optical weight roughly
 *  matches the mark it's fading into. */
type LogoSize = "sm" | "md";

const WORDMARK_SIZE: Record<LogoSize, string> = {
  sm: "text-xl",   // pairs with h-9 mark (Header)
  md: "text-3xl",  // pairs with h-12 mark (AppSidebar)
};

export function TheoLogo({
  className = "",
  priority = false,
  size = "md",
}: {
  className?: string;
  /** Set `priority` on above-the-fold nav slots (Header, AppSidebar). */
  priority?: boolean;
  size?: LogoSize;
}) {
  const [phase, setPhase] = useState<Phase>("static");

  useEffect(() => {
    // Respect reduced-motion — skip both A and B, jump straight to steady.
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) {
      setPhase("done");
      return;
    }

    let seen = false;
    try {
      seen = window.sessionStorage.getItem(SESSION_REVEAL_KEY) === "1";
    } catch {
      // sessionStorage can throw in private mode / disabled cookies —
      // treat as "already seen" so we don't repeatedly animate.
      seen = true;
    }

    if (seen) {
      setPhase("done");
      return;
    }

    // Play the reveal exactly once per session.
    try {
      window.sessionStorage.setItem(SESSION_REVEAL_KEY, "1");
    } catch {
      /* ignore — animation still plays, just may repeat next mount */
    }
    setPhase("reveal-hold");
    const holdTimer = window.setTimeout(() => setPhase("reveal-crossfade"), 700);
    const doneTimer = window.setTimeout(() => setPhase("done"), 700 + 500);
    return () => {
      window.clearTimeout(holdTimer);
      window.clearTimeout(doneTimer);
    };
  }, []);

  const wordmarkVisible = phase === "reveal-hold";
  const isRevealPending = phase === "reveal-hold" || phase === "reveal-crossfade";

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
          // Effect B — settle-in on first mount. Skipped under reduced-motion
          // because `motion-safe:` gates it.
          "motion-safe:animate-[theo-logo-settle_350ms_ease-out_both]",
        ].join(" ")}
      />
      {/* Effect A — wordmark overlay. Fades in with the container, holds
          while `wordmarkVisible`, then crossfades out. Positioned to
          center on the mark's canvas so the transition feels seated. */}
      {isRevealPending && (
        <span
          aria-hidden
          className={[
            "pointer-events-none absolute inset-0 flex items-center justify-center",
            "text-current font-medium tracking-tight leading-none",
            WORDMARK_SIZE[size],
            "transition-opacity duration-500 ease-out",
            wordmarkVisible ? "opacity-100" : "opacity-0",
          ].join(" ")}
          style={{ fontFamily: "'SUIT','Geist','Helvetica Neue',Arial,sans-serif" }}
        >
          Theo
        </span>
      )}
    </span>
  );
}
