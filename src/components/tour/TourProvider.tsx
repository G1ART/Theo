"use client";

/**
 * TourProvider — mounts once at the root of the authenticated app.
 *
 * Exposes a small imperative API via `useTourController` that pages can
 * call to request auto-start or manual reopen of a tour. The provider
 * owns all runtime state (current tour, step index, target rect), and
 * delegates rendering to the `TourOverlay` view layer.
 *
 * Persistence is delegated to `tourPersistence`; this component does not
 * touch localStorage/DB directly.
 *
 * Overlay is a coachmark, not a modal: spotlight never captures clicks.
 * Navigating off the tour's `routeScope` skips the tour so it cannot
 * follow the user around the app. If a step target unmounts and stays
 * gone, that step (or the whole tour) is skipped instead of trapping.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { logBetaEventSync } from "@/lib/beta/logEvent";
import { TOURS, getTour } from "@/lib/tours/tourRegistry";
import type { TourDefinition, TourStep } from "@/lib/tours/tourTypes";
import {
  findTourTarget,
  measureTarget,
  ensureTargetVisible,
  waitForTourTarget,
  pathnameInTourScope,
  type TargetRect,
} from "@/lib/tours/tourUtils";
import { loadTourState, makeState, saveTourState } from "@/lib/tours/tourPersistence";
import { TourOverlay } from "./TourOverlay";

/** If a step's target stays gone this long, skip it (or the tour). */
const MISSING_TARGET_MS = 700;

type LiveStep = {
  step: TourStep;
  index: number;
  /** steps after filtering out missing anchors */
  resolvedSteps: TourStep[];
};

type TourContextValue = {
  /** Consider starting a tour if the user hasn't completed/skipped its current version. */
  requestAutoStart: (tourId: string) => void;
  /** Force-start a tour (used by the manual reopen button). */
  startTour: (tourId: string) => void;
  /** True while a tour is currently on-screen. */
  isActive: boolean;
  /** Currently active tour id (or null). */
  activeTourId: string | null;
};

const Ctx = createContext<TourContextValue | null>(null);

export function useTourController(): TourContextValue {
  const v = useContext(Ctx);
  if (!v) {
    // Graceful fallback for pages rendered outside the provider (e.g.
    // unauth pages). No-op rather than crash.
    return {
      requestAutoStart: () => {},
      startTour: () => {},
      isActive: false,
      activeTourId: null,
    };
  }
  return v;
}

export function TourProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const [activeTour, setActiveTour] = useState<TourDefinition | null>(null);
  const [resolvedSteps, setResolvedSteps] = useState<TourStep[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);

  // Track auto-start requests so we don't re-evaluate in a tight loop if the
  // same page re-renders frequently.
  const evaluatedRef = useRef<Set<string>>(new Set());

  const clearActive = useCallback(() => {
    setActiveTour(null);
    setResolvedSteps([]);
    setStepIndex(0);
    setTargetRect(null);
  }, []);

  // Resolve + enter a tour. Filters out missing anchors; if nothing remains,
  // silently bails (we don't want empty overlays).
  const enterTour = useCallback(
    async (tour: TourDefinition, startStep = 0) => {
      const requiredPresent =
        !tour.requiredAnchors ||
        tour.requiredAnchors.some((a) => !!findTourTarget(a));
      if (!requiredPresent) {
        // Try once more after layout settles (async content).
        const waited = await Promise.all(
          (tour.requiredAnchors ?? []).map((a) => waitForTourTarget(a, 800))
        );
        if (!waited.some((el) => !!el)) return;
      }

      const filtered: TourStep[] = [];
      const missing: string[] = [];
      for (const step of tour.steps) {
        if (step.guard && !step.guard()) continue;
        const el = findTourTarget(step.target) ?? (await waitForTourTarget(step.target, 400));
        if (el) {
          filtered.push(step);
        } else {
          missing.push(`${step.id}@${step.target}`);
        }
      }
      // Dev-only: surface missing anchors so UI changes that detach a tour
      // step are caught early. Production users still get a graceful tour
      // (missing steps are silently skipped).
      if (
        missing.length > 0 &&
        typeof process !== "undefined" &&
        process.env?.NODE_ENV !== "production"
      ) {
        console.warn(
          `[tour:${tour.id}] missing anchors:`,
          missing.join(", "),
        );
      }
      if (filtered.length === 0) return;

      logBetaEventSync("tour_shown", { tourId: tour.id, version: tour.version });
      setActiveTour(tour);
      setResolvedSteps(filtered);
      setStepIndex(Math.min(Math.max(startStep, 0), filtered.length - 1));
    },
    []
  );

  const requestAutoStart = useCallback(
    (tourId: string) => {
      const tour = getTour(tourId);
      if (!tour) return;
      const evalKey = `${tour.id}@${tour.version}`;
      if (evaluatedRef.current.has(evalKey)) return;
      evaluatedRef.current.add(evalKey);

      let cancelled = false;
      void (async () => {
        const state = await loadTourState(tour.id);
        if (cancelled) return;
        // Policy: auto-start fires AT MOST ONCE per user per tour.
        //
        // Once a user has seen this tour (status === completed | skipped)
        // we never auto-pop it again, even after copy or version bumps.
        // The manual "가이드 보기" button (TourHelpButton) stays as the
        // re-entry path on demand. This avoids onboarding-overlay fatigue
        // on every release that touches tour copy.
        const shouldStart = !state || state.status === "not_seen";
        if (!shouldStart) return;
        // Defer slightly so the page's own data can paint first; keeps
        // the overlay from landing on a loading skeleton.
        window.setTimeout(() => {
          if (cancelled) return;
          void enterTour(tour, 0);
        }, 400);
      })();
      return () => {
        cancelled = true;
      };
    },
    [enterTour]
  );

  const startTour = useCallback(
    (tourId: string) => {
      const tour = getTour(tourId);
      if (!tour) return;
      void enterTour(tour, 0);
    },
    [enterTour]
  );

  const handleSkip = useCallback(async () => {
    if (!activeTour) return;
    logBetaEventSync("tour_skipped", {
      tourId: activeTour.id,
      stepIndex,
    });
    await saveTourState(makeState(activeTour.id, activeTour.version, "skipped", stepIndex));
    clearActive();
  }, [activeTour, stepIndex, clearActive]);

  const handleComplete = useCallback(async () => {
    if (!activeTour) return;
    logBetaEventSync("tour_completed", {
      tourId: activeTour.id,
      version: activeTour.version,
    });
    await saveTourState(
      makeState(activeTour.id, activeTour.version, "completed", resolvedSteps.length - 1)
    );
    clearActive();
  }, [activeTour, resolvedSteps.length, clearActive]);

  const handleNext = useCallback(() => {
    if (!activeTour) return;
    if (stepIndex < resolvedSteps.length - 1) {
      logBetaEventSync("tour_step_advanced", {
        tourId: activeTour.id,
        stepIndex: stepIndex + 1,
      });
      setStepIndex((i) => i + 1);
    } else {
      void handleComplete();
    }
  }, [activeTour, stepIndex, resolvedSteps.length, handleComplete]);

  const handlePrev = useCallback(() => {
    if (!activeTour) return;
    setStepIndex((i) => Math.max(0, i - 1));
  }, [activeTour]);

  const currentStep: LiveStep | null = useMemo(() => {
    if (!activeTour || resolvedSteps.length === 0) return null;
    const idx = Math.min(stepIndex, resolvedSteps.length - 1);
    return { step: resolvedSteps[idx], index: idx, resolvedSteps };
  }, [activeTour, resolvedSteps, stepIndex]);

  useEffect(() => {
    if (!currentStep) return;
    let missingSince: number | null = null;
    let dismissed = false;

    const advanceOrSkipMissing = () => {
      if (dismissed) return;
      const steps = currentStep.resolvedSteps;
      for (let i = currentStep.index + 1; i < steps.length; i++) {
        const nextEl = findTourTarget(steps[i].target);
        if (measureTarget(nextEl)) {
          setStepIndex(i);
          return;
        }
      }
      dismissed = true;
      void handleSkip();
    };

    const measureNow = () => {
      if (dismissed) return;
      const live = findTourTarget(currentStep.step.target);
      const rect = measureTarget(live);
      setTargetRect(rect);
      if (rect) {
        missingSince = null;
        return;
      }
      if (missingSince == null) {
        missingSince = Date.now();
        return;
      }
      if (Date.now() - missingSince >= MISSING_TARGET_MS) {
        advanceOrSkipMissing();
      }
    };

    const el = findTourTarget(currentStep.step.target);
    ensureTargetVisible(el);
    measureNow();
    const onScroll = () => measureNow();
    const onResize = () => measureNow();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    const raf = requestAnimationFrame(measureNow);
    const timer = window.setInterval(measureNow, 400);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
      window.clearInterval(timer);
    };
  }, [currentStep, handleSkip]);

  // TourProvider is root-mounted. Leaving the tour's page (sidebar tab,
  // in-app Link, etc.) must drop the overlay so it cannot follow the user.
  useEffect(() => {
    if (!activeTour) return;
    if (!pathnameInTourScope(pathname, activeTour.routeScope)) {
      void handleSkip();
    }
  }, [pathname, activeTour, handleSkip]);

  useEffect(() => {
    if (!activeTour) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        void handleSkip();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        handleNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        handlePrev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTour, handleSkip, handleNext, handlePrev]);

  const value = useMemo<TourContextValue>(
    () => ({
      requestAutoStart,
      startTour,
      isActive: !!activeTour,
      activeTourId: activeTour?.id ?? null,
    }),
    [requestAutoStart, startTour, activeTour]
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* Do not mount the overlay until the step has a live target
          rect. A null-target overlay used to paint a centered white
          card (and previously a full-viewport dim) on first paint of
          /upload, which read as a blank or locked page. */}
      {activeTour && currentStep && targetRect ? (
        <TourOverlay
          tour={activeTour}
          step={currentStep.step}
          stepIndex={currentStep.index}
          totalSteps={resolvedSteps.length}
          targetRect={targetRect}
          onNext={handleNext}
          onPrev={handlePrev}
          onSkip={() => {
            void handleSkip();
          }}
          onComplete={() => {
            void handleComplete();
          }}
        />
      ) : null}
    </Ctx.Provider>
  );
}

// ─── Static reference kept for DevTools / future admin tooling ──────────
export const _TOUR_INVENTORY = TOURS;
