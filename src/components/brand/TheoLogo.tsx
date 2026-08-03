"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

/**
 * Theo brand mark (Aug-2026 redesign).
 *
 * Two coordinated micro-animations, both opt-out under
 * `prefers-reduced-motion: reduce`:
 *
 *  A. **Reveal** — the "Theo" wordmark is briefly overlaid on the mark
 *     (900ms hold + 600ms crossfade) so users bridge from the pre-
 *     redesign text logo to the new mark without an abrupt cut. The
 *     reveal is throttled per-tab via localStorage: once every
 *     `REVEAL_COOLDOWN_MS`. It can be force-triggered by loading any
 *     page with `?logo=reveal` (dev/QA affordance).
 *
 *  B. **Settle** — on every hard page load the mark animates in with a
 *     visible scale + fade + rise (0.9→1, 0.55→1, 4px→0, 550ms).
 *     Because the AppShell persists across client-side navigations,
 *     this only fires on true page loads — the "loading moment" we
 *     want to fill with brand presence.
 *
 * Both effects share the same container so the two forms occupy the
 * same slot without layout jitter. The Primary Mark's canvas is
 * ~1.46:1, so callers set only the height (`h-9`, `h-12`, …) and let
 * width flow.
 *
 * If the designer ships an official SVG later, replace the `<Image>`
 * import site with the SVG — no caller changes needed.
 */

/** localStorage key for the last time reveal (A) fired for this device. */
const REVEAL_LAST_SHOWN_KEY = "theo:logo-reveal-last-shown-v2";
/** How long to wait between reveal replays. 20 min keeps the moment
 *  "occasional" (per PM's original ask of a periodic rotation) without
 *  hammering users every navigation. */
const REVEAL_COOLDOWN_MS = 20 * 60 * 1000;

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

    // Force-play if `?logo=reveal` is on the URL — dev/QA affordance
    // so the animation can be re-triggered without waiting out the
    // cooldown or clearing storage.
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
        // localStorage blocked → play it safe and DO fire (better to show
        // once too many than never), then don't try to persist.
        onCooldown = false;
      }
    }

    if (onCooldown) {
      setPhase("done");
      return;
    }

    // Play the reveal — persist timestamp so we don't spam users on every
    // subsequent hard-refresh within the cooldown window.
    try {
      window.localStorage.setItem(REVEAL_LAST_SHOWN_KEY, String(Date.now()));
    } catch {
      /* ignore — animation still plays */
    }
    setPhase("reveal-hold");
    const holdMs = 900;
    const fadeMs = 600;
    const holdTimer = window.setTimeout(() => setPhase("reveal-crossfade"), holdMs);
    const doneTimer = window.setTimeout(() => setPhase("done"), holdMs + fadeMs);
    return () => {
      window.clearTimeout(holdTimer);
      window.clearTimeout(doneTimer);
    };
  }, []);

  const wordmarkOpacityClass =
    phase === "reveal-hold" ? "opacity-100" : "opacity-0";

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
          "motion-safe:animate-[theo-logo-settle_550ms_cubic-bezier(0.2,0.9,0.2,1)_both]",
        ].join(" ")}
      />
      {/* Effect A — wordmark overlay. Always mounted so it can fade IN
          (opacity-0 → opacity-100) and back OUT (→ opacity-0) with
          smooth transitions rather than snapping into view. Centered on
          the mark's canvas so the transition feels seated. */}
      <span
        aria-hidden={phase !== "reveal-hold"}
        className={[
          "pointer-events-none absolute inset-0 flex items-center justify-center",
          "text-current font-medium tracking-tight leading-none",
          WORDMARK_SIZE[size],
          "transition-opacity duration-[500ms] ease-out",
          wordmarkOpacityClass,
        ].join(" ")}
        style={{ fontFamily: "'SUIT','Geist','Helvetica Neue',Arial,sans-serif" }}
      >
        Theo
      </span>
    </span>
  );
}
