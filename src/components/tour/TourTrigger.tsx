"use client";

/**
 * TourTrigger — invisible component that requests an auto-start for the
 * given tour on first page visit (or after a version bump).
 *
 * Mount this once per tour-enabled page. It has no UI of its own; the
 * actual overlay is rendered by the root `TourProvider`.
 *
 * Auto-start waits for two animation frames so the page chrome (sidebar,
 * tabs) can paint first. Starting in the same tick as mount used to let
 * the overlay land on an empty canvas.
 */

import { useEffect } from "react";
import { useTourController } from "./TourProvider";

export function TourTrigger({ tourId }: { tourId: string }) {
  const { requestAutoStart } = useTourController();
  useEffect(() => {
    let cancelled = false;
    let innerCleanup: (() => void) | void;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return;
        innerCleanup = requestAutoStart(tourId);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
      if (typeof innerCleanup === "function") innerCleanup();
    };
  }, [tourId, requestAutoStart]);
  return null;
}
