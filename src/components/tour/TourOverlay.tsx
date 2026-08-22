"use client";

/**
 * TourOverlay — the full-screen visual layer for an active tour.
 *
 * Renders three stacked parts:
 *   1. Dimmed backdrop with a rounded "cutout" around the target (spotlight)
 *   2. A soft halo ring that follows the target
 *   3. An anchored popover with title / body / step dots / controls
 *
 * Uses a React portal so it can live above modals and page content without
 * inheriting z-index/overflow from the nearest parent. Designed to be calm
 * and premium: no bouncing, no flashing; brief transitions only.
 *
 * This is a coachmark, not a modal: the dim/spotlight layer is visual-only
 * (`pointer-events-none`) so sidebar and other in-app nav always receive
 * clicks. Only the popover (Skip / Next / Done) is clickable.
 *
 * Why `"use no memo"`: React Compiler 1.0 can over-memoize text fragments
 * derived from i18n + per-step props. Combined with our portal + GPU
 * compositing, that produced visible glyph bleed across step transitions
 * (e.g. "Workshop" → "Oprkshop", "A private…" → "Eighivate…"). Per-step
 * `key`s on the popover + title/body forcibly remount the DOM, but we
 * also opt out of compiler memoization here so any future regression
 * inside this file fails loudly rather than silently caching text nodes.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n/useT";
import {
  TOUR_KO_CHROME,
  TOUR_KO_HEADER,
  TOUR_KO_STEP,
  TOUR_POPOVER_FONT_FAMILY,
  tourKoStepKey,
} from "@/lib/tours/tourKoCopy";
import type { TourDefinition, TourPlacement, TourStep } from "@/lib/tours/tourTypes";
import type { TargetRect } from "@/lib/tours/tourUtils";

type Props = {
  tour: TourDefinition;
  step: TourStep;
  stepIndex: number;
  totalSteps: number;
  targetRect: TargetRect | null;
  onPrev: () => void;
  onNext: () => void;
  onSkip: () => void;
  onComplete: () => void;
};

const PADDING = 10; // spotlight breathing room in px
const POPOVER_GAP = 14; // distance from target edge to popover edge
const POPOVER_WIDTH = 340;
const POPOVER_MAX_WIDTH_VW = 92; // mobile cap in vw

type PopoverPosition = {
  top: number;
  left: number;
  arrow: "top" | "bottom" | "left" | "right" | "none";
};

function pickPlacement(
  rect: TargetRect | null,
  preferred: TourPlacement | undefined,
  popW: number,
  popH: number
): TourPlacement {
  if (!rect) return "bottom";
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const room = {
    top: rect.top,
    bottom: vh - (rect.top + rect.height),
    left: rect.left,
    right: vw - (rect.left + rect.width),
  };
  const order: TourPlacement[] = preferred && preferred !== "auto"
    ? [preferred, "bottom", "top", "right", "left"]
    : ["bottom", "top", "right", "left"];
  for (const p of order) {
    if (p === "bottom" && room.bottom >= popH + POPOVER_GAP + 16) return "bottom";
    if (p === "top" && room.top >= popH + POPOVER_GAP + 16) return "top";
    if (p === "right" && room.right >= popW + POPOVER_GAP + 16) return "right";
    if (p === "left" && room.left >= popW + POPOVER_GAP + 16) return "left";
  }
  // Nothing fits; prefer the side with the most room.
  const best = (Object.entries(room) as [TourPlacement, number][])
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  return best ?? "bottom";
}

function computePosition(
  rect: TargetRect | null,
  preferred: TourPlacement | undefined,
  popW: number,
  popH: number
): PopoverPosition {
  if (!rect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return { top: Math.max(24, vh / 2 - popH / 2), left: Math.max(16, vw / 2 - popW / 2), arrow: "none" };
  }
  const placement = pickPlacement(rect, preferred, popW, popH);
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let top = 0;
  let left = 0;
  let arrow: PopoverPosition["arrow"] = "none";

  if (placement === "bottom") {
    top = rect.top + rect.height + POPOVER_GAP;
    left = rect.left + rect.width / 2 - popW / 2;
    arrow = "top";
  } else if (placement === "top") {
    top = rect.top - popH - POPOVER_GAP;
    left = rect.left + rect.width / 2 - popW / 2;
    arrow = "bottom";
  } else if (placement === "right") {
    top = rect.top + rect.height / 2 - popH / 2;
    left = rect.left + rect.width + POPOVER_GAP;
    arrow = "left";
  } else if (placement === "left") {
    top = rect.top + rect.height / 2 - popH / 2;
    left = rect.left - popW - POPOVER_GAP;
    arrow = "right";
  }

  // Clamp to viewport (with small margins).
  const margin = 12;
  left = Math.max(margin, Math.min(vw - popW - margin, left));
  top = Math.max(margin, Math.min(vh - popH - margin, top));

  return { top, left, arrow };
}

export function TourOverlay({
  tour,
  step,
  stepIndex,
  totalSteps,
  targetRect,
  onPrev,
  onNext,
  onSkip,
  onComplete,
}: Props) {
  // Opt this component out of React Compiler memoization. The compiler
  // sometimes caches per-step derived strings (title/body/eyebrow) and
  // re-uses text nodes across step transitions, which collided with our
  // portal + GPU compositing and produced visible glyph bleed.
  "use no memo";
  const { t, locale } = useT();
  const useKoCopy = locale === "ko";
  const koStep = useKoCopy ? TOUR_KO_STEP[tourKoStepKey(tour.id, step.id)] : undefined;
  const title = koStep?.title ?? t(step.titleKey);
  const body = koStep?.body ?? t(step.bodyKey);
  const tourEyebrow =
    useKoCopy && TOUR_KO_HEADER[tour.id] ? TOUR_KO_HEADER[tour.id] : t(tour.titleKey);
  const skipLabel = useKoCopy ? TOUR_KO_CHROME.skip : t("tour.skip");
  const prevLabel = useKoCopy ? TOUR_KO_CHROME.prev : t("tour.prev");
  const nextLabel = useKoCopy ? TOUR_KO_CHROME.next : t("tour.next");
  const doneLabel = useKoCopy ? TOUR_KO_CHROME.done : t("tour.done");
  const [mounted, setMounted] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const primaryBtnRef = useRef<HTMLButtonElement | null>(null);
  const [popSize, setPopSize] = useState<{ w: number; h: number }>({
    w: POPOVER_WIDTH,
    h: 180,
  });

  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Measure popover after render so placement math is accurate. The
  // threshold guards against infinite measure→setState loops.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!popoverRef.current) return;
    const r = popoverRef.current.getBoundingClientRect();
    if (Math.abs(r.width - popSize.w) > 1 || Math.abs(r.height - popSize.h) > 1) {
      setPopSize({ w: r.width, h: r.height });
    }
  });

  // Move initial focus to primary CTA when the step opens (accessibility).
  useEffect(() => {
    const id = window.setTimeout(() => {
      primaryBtnRef.current?.focus();
    }, 80);
    return () => window.clearTimeout(id);
  }, [stepIndex, step.id]);

  const position = useMemo(
    () => computePosition(targetRect, step.placement, popSize.w, popSize.h),
    [targetRect, step.placement, popSize.w, popSize.h]
  );

  if (!mounted || typeof document === "undefined") return null;

  const isLast = stepIndex >= totalSteps - 1;
  const cta = step.ctaKey ? t(step.ctaKey) : null;

  const overlayEl = (
    <div
      aria-hidden={false}
      role="region"
      aria-labelledby="tour-title"
      lang={locale === "ko" ? "ko" : "en"}
      className="fixed inset-0 z-[1200] pointer-events-none"
    >
      {/* Backdrop with spotlight cutout via SVG mask */}
      <Spotlight rect={targetRect} />

      {/* Subtle halo ring around target */}
      {targetRect ? <Halo rect={targetRect} /> : null}

      {/* Popover. The `key` forces a fresh DOM node per step so neither React
          Compiler memoization nor GPU layer rasterization can leak glyphs
          from the previous step into the current one (root cause of the
          "Eighivate / withparate" bleed users were reporting). */}
      <div
        key={`${tour.id}:${step.id}:${locale}`}
        ref={popoverRef}
        style={{
          top: position.top,
          left: position.left,
          maxWidth: `min(${POPOVER_WIDTH}px, ${POPOVER_MAX_WIDTH_VW}vw)`,
          fontFamily: TOUR_POPOVER_FONT_FAMILY,
        }}
        className="pointer-events-auto absolute w-[min(340px,92vw)] rounded-2xl bg-white text-zinc-900 shadow-[0_20px_60px_-20px_rgba(24,24,27,0.35),0_8px_18px_-8px_rgba(24,24,27,0.25)] ring-1 ring-zinc-200/80"
      >
        {/* Arrow */}
        <ArrowIndicator direction={position.arrow} />

        <div className={`px-5 pt-4 pb-3${useKoCopy ? " [word-break:keep-all]" : ""}`}>
          <div className="mb-2 flex items-center justify-between text-[11px] font-medium text-zinc-400">
            <span className={useKoCopy ? "" : "uppercase tracking-[0.12em]"}>{tourEyebrow}</span>
            <span className="tabular-nums">{stepIndex + 1} / {totalSteps}</span>
          </div>
          <h2
            id="tour-title"
            key={`title:${step.id}`}
            className="text-base font-semibold leading-snug text-zinc-900"
          >
            {title}
          </h2>
          <p
            key={`body:${step.id}`}
            className="mt-1 text-[13px] leading-relaxed text-zinc-600"
          >
            {body}
          </p>
        </div>

        {/* Step dots */}
        <div className="flex items-center gap-1.5 px-5">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <span
              key={i}
              aria-hidden
              className={`h-1 rounded-full transition-all duration-200 ${
                i === stepIndex ? "w-5 bg-zinc-900" : "w-1.5 bg-zinc-200"
              }`}
            />
          ))}
        </div>

        {/* Controls */}
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-zinc-100 px-4 py-3">
          <button
            type="button"
            onClick={onSkip}
            className="shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-[12px] font-medium text-zinc-500 hover:text-zinc-900"
            aria-label={skipLabel}
          >
            {skipLabel}
          </button>

          <div className="flex shrink-0 items-center gap-2">
            {stepIndex > 0 ? (
              <button
                type="button"
                onClick={onPrev}
                className="whitespace-nowrap rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-[12px] font-medium text-zinc-700 hover:bg-zinc-50"
              >
                {prevLabel}
              </button>
            ) : null}
            <button
              ref={primaryBtnRef}
              type="button"
              onClick={isLast ? onComplete : onNext}
              className="whitespace-nowrap rounded-md bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2"
            >
              {cta ?? (isLast ? doneLabel : nextLabel)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(overlayEl, document.body);
}

// ─── Spotlight (dimmed layer with rounded cutout around target) ─────────
function Spotlight({ rect }: { rect: TargetRect | null }) {
  const vw = typeof window !== "undefined" ? window.innerWidth : 0;
  const vh = typeof window !== "undefined" ? window.innerHeight : 0;

  // No target: do not paint a full-screen layer. A dim here used to
  // sit on `pointer-events-auto` and trap every click (including the
  // main sidebar) while the step's anchor was unmounted.
  if (!rect) return null;

  const x = Math.max(0, rect.left - PADDING);
  const y = Math.max(0, rect.top - PADDING);
  const w = Math.min(vw - x, rect.width + PADDING * 2);
  const h = Math.min(vh - y, rect.height + PADDING * 2);
  const r = 14;

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden
    >
      <defs>
        <mask id="tour-mask">
          <rect x={0} y={0} width={vw} height={vh} fill="white" />
          <rect x={x} y={y} width={w} height={h} rx={r} ry={r} fill="black" />
        </mask>
      </defs>
      <rect
        x={0}
        y={0}
        width={vw}
        height={vh}
        fill="rgba(24,24,27,0.55)"
        mask="url(#tour-mask)"
      />
    </svg>
  );
}

// ─── Halo (soft highlight ring around target) ───────────────────────────
function Halo({ rect }: { rect: TargetRect }) {
  return (
    <div
      className="pointer-events-none absolute rounded-2xl ring-1 ring-white/70 shadow-[0_0_0_3px_rgba(255,255,255,0.35),0_0_24px_4px_rgba(255,255,255,0.25)]"
      style={{
        top: rect.top - PADDING,
        left: rect.left - PADDING,
        width: rect.width + PADDING * 2,
        height: rect.height + PADDING * 2,
        borderRadius: 14,
      }}
      aria-hidden
    />
  );
}

// ─── Arrow ──────────────────────────────────────────────────────────────
function ArrowIndicator({ direction }: { direction: PopoverPosition["arrow"] }) {
  if (direction === "none") return null;
  const base = "absolute h-3 w-3 rotate-45 bg-white ring-1 ring-zinc-200/80";
  if (direction === "top") {
    return <span className={`${base} -top-[6px] left-1/2 -translate-x-1/2`} aria-hidden />;
  }
  if (direction === "bottom") {
    return <span className={`${base} -bottom-[6px] left-1/2 -translate-x-1/2`} aria-hidden />;
  }
  if (direction === "left") {
    return <span className={`${base} -left-[6px] top-1/2 -translate-y-1/2`} aria-hidden />;
  }
  return <span className={`${base} -right-[6px] top-1/2 -translate-y-1/2`} aria-hidden />;
}
