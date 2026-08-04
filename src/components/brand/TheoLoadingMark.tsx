"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/useT";

/**
 * Branded loading canvas (strategy "C" of the Aug-2026 logo
 * familiarization plan — Netflix/Airbnb pattern).
 *
 * Use for **full-screen or centered loading states** where the user is
 * already waiting on the browser (auth check, initial hydration, page
 * bootstrap, etc.). The gentle breathe (`@keyframes
 * theo-mark-breathe` in globals.css) turns the empty moment into a
 * quiet brand impression — no scale/transform, so there's zero layout
 * shift and no chance of compositor jank.
 *
 * Not intended for in-tab shimmer skeletons (those already have
 * `animate-pulse` on their placeholder blocks and swap-invisibly to
 * live content). Use `PageShellSkeleton` / `FeedGridSkeleton` for
 * those.
 *
 * Respects `prefers-reduced-motion: reduce` by falling back to a
 * static mark. The `role="status"` + `aria-live="polite"` wrapper
 * announces the loading state to screen readers.
 */
export function TheoLoadingMark({
  label,
  size = 64,
  className = "",
}: {
  /** Screen-reader + visible caption. Defaults to `common.loading`. */
  label?: string;
  /** Mark height in px. Width auto-flows from the 1.46:1 canvas. */
  size?: number;
  /** Extra classes applied to the outer wrapper. */
  className?: string;
}) {
  const { t } = useT();
  const caption = label ?? t("common.loading");
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const prefersReduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (prefersReduced) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAnimate(true);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={`flex flex-col items-center justify-center gap-4 ${className}`}
    >
      <Image
        src="/theo-logo.png"
        alt=""
        width={984}
        height={675}
        priority
        draggable={false}
        className="block h-auto w-auto select-none"
        style={{
          height: size,
          width: "auto",
          animation: animate
            ? "theo-mark-breathe 1800ms ease-in-out infinite"
            : "none",
        }}
      />
      <p className="text-sm text-zinc-500">{caption}</p>
    </div>
  );
}
