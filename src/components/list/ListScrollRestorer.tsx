"use client";

import { useEffect, useLayoutEffect } from "react";
import { usePathname } from "next/navigation";
import {
  commitListScrollReturn,
  isListScrollPath,
  pinListScroll,
  releaseListScrollOutsideCorridor,
  takeListScrollPlan,
} from "@/lib/list/scrollRestore";

/**
 * Puts a list back on the scroll saved when the visitor opened a detail.
 * Feed and profile pages are not list paths, so their own restores run alone.
 */
export function ListScrollRestorer() {
  const pathname = usePathname();

  useLayoutEffect(() => {
    if (!pathname || !isListScrollPath(pathname)) return;
    const previous = window.history.scrollRestoration;
    try {
      window.history.scrollRestoration = "manual";
    } catch {
      // ignore
    }
    const key = window.location.pathname + window.location.search;
    const plan = takeListScrollPlan(key);
    let stop = () => {};
    if (plan.action === "reload" || plan.action === "fresh") {
      window.scrollTo(0, 0);
    } else if (plan.action === "restore") {
      window.scrollTo(0, plan.scrollY);
      stop = pinListScroll(plan.scrollY, () => commitListScrollReturn());
    }
    return () => {
      stop();
      try {
        window.history.scrollRestoration = previous;
      } catch {
        // ignore
      }
    };
  }, [pathname]);

  useEffect(() => {
    if (!pathname) return;
    releaseListScrollOutsideCorridor(pathname);
  }, [pathname]);

  return null;
}
