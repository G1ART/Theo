"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { recordRouteChange, rememberLeave } from "@/lib/nav/entryTrail";

function currentUrl(): string {
  return window.location.pathname + window.location.search;
}

function sameOriginReferrer(): string | null {
  try {
    if (!document.referrer) return null;
    const url = new URL(document.referrer);
    if (url.origin !== window.location.origin) return null;
    return url.pathname + url.search;
  } catch {
    return null;
  }
}

function documentNavigationType(): string {
  if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") {
    return "navigate";
  }
  const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  return entry?.type ?? "navigate";
}

function isPlainPrimaryClick(event: MouseEvent): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

function Tracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ?? "";
  const lastRef = useRef<string | null>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!isPlainPrimaryClick(event)) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      let next: URL;
      try {
        next = new URL(anchor.href, window.location.origin);
      } catch {
        return;
      }
      if (next.origin !== window.location.origin) return;
      if (next.pathname === window.location.pathname) return;
      rememberLeave(currentUrl(), window.scrollY);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (!pathname) return;
    const url = currentUrl();
    const previous = lastRef.current;
    lastRef.current = url;
    if (previous === null) {
      // A full load inside the app (upload hard leave, delegation manage)
      // keeps its referrer. Reload and Back/Forward keep what is stored.
      if (documentNavigationType() === "navigate") recordRouteChange(sameOriginReferrer(), url);
      return;
    }
    if (previous !== url) recordRouteChange(previous, url);
  }, [pathname, search]);

  return null;
}

/** Records where each screen was opened from (see entryTrail). Mounted once in the root layout. */
export function EntryTrailTracker() {
  return (
    <Suspense fallback={null}>
      <Tracker />
    </Suspense>
  );
}
