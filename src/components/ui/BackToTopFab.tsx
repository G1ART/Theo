"use client";

/**
 * Floating "back to top" affordance mounted at the root layout so it
 * is available on any tall page (feed, artwork detail, artist
 * portfolio, exhibition detail, search results, etc.).
 *
 * Behavior
 *  - Appears once `window.scrollY` crosses {@link SCROLL_THRESHOLD_PX}.
 *  - Below the threshold the FAB stays in the DOM but is offscreen
 *    (`translate-y-full opacity-0`) so entering/leaving the threshold
 *    reads as a subtle transition rather than a snap.
 *  - Scroll listener is passive and coalesced through `rAF`, so a
 *    scroll burst produces at most one state read per frame.
 *  - `bottom` respects the iOS home-indicator safe area.
 *
 * Placement
 *  - Mounted once in `src/app/layout.tsx` (right below the header /
 *    ambient banners). No per-page double-mount.
 *  - `z-40` keeps us below dialogs / drawers (`z-50`).
 *  - Bottom-right is checked against the currently existing floating
 *    UI (see HANDOFF for the audit): feed debug panel at bottom-right
 *    is `z-50` and only appears with `?debug=feed`, so overlap is
 *    development-only and acceptable.
 */

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n/useT";

const SCROLL_THRESHOLD_PX = 800;

export function BackToTopFab() {
  const { t } = useT();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let rafId: number | null = null;
    let mounted = true;

    const compute = () => {
      rafId = null;
      if (!mounted) return;
      const scrollY =
        window.scrollY ||
        document.documentElement.scrollTop ||
        document.body.scrollTop ||
        0;
      const next = scrollY > SCROLL_THRESHOLD_PX;
      setVisible((prev) => (prev === next ? prev : next));
    };

    const onScroll = () => {
      if (rafId != null) return;
      rafId = window.requestAnimationFrame(compute);
    };

    // Seed once so a page mounted mid-scroll (e.g. history restore)
    // gets the correct visibility state without waiting for a scroll.
    compute();

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      mounted = false;
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (rafId != null) window.cancelAnimationFrame(rafId);
    };
  }, []);

  const handleClick = useCallback(() => {
    if (typeof window === "undefined") return;
    const prefersReduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({
      top: 0,
      behavior: prefersReduced ? "auto" : "smooth",
    });
  }, []);

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={t("common.backToTop.ariaLabel")}
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      className={[
        "fixed right-4 z-40 flex h-11 w-11 items-center justify-center",
        "rounded-full bg-zinc-900/90 text-white shadow-lg backdrop-blur-sm",
        "transition-all duration-200 ease-out",
        "hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/40",
        visible
          ? "opacity-100 translate-y-0 pointer-events-auto"
          : "opacity-0 translate-y-full pointer-events-none",
      ].join(" ")}
      style={{
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
      }}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 19V5" />
        <path d="M5 12l7-7 7 7" />
      </svg>
    </button>
  );
}
