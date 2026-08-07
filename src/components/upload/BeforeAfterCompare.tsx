"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

/**
 * Simple, dependency-free before/after slider.
 *
 * The wrapper is a fixed-aspect container that stacks the "before"
 * image full-width and the "after" image clipped to `[0, divider%]`.
 * The user drags the vertical divider handle or nudges it with the
 * arrow keys when focused. Fully keyboard-accessible so QA can drive
 * the slider from the keyboard.
 */
type Props = {
  beforeSrc: string;
  afterSrc: string;
  beforeAlt: string;
  afterAlt: string;
  className?: string;
  /** Initial divider position in percent. Defaults to 50. */
  initialPercent?: number;
};

export function BeforeAfterCompare({
  beforeSrc,
  afterSrc,
  beforeAlt,
  afterAlt,
  className = "",
  initialPercent = 50,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [percent, setPercent] = useState(() =>
    Math.min(100, Math.max(0, initialPercent)),
  );
  // Tracked in state (not read from the ref during render) so the "after"
  // image can be sized to the outer container's width while its wrapper is
  // clipped to `percent%`. Keeping ref reads out of render satisfies the
  // react-hooks/refs lint rule (2026-08-05).
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const draggingRef = useRef(false);
  // React-19 recommended "derived state from prop change" pattern —
  // reset the divider inline when the source pair changes, avoiding an
  // effect + setState cascade. See react.dev/learn/you-might-not-need-an-effect.
  const [prevKey, setPrevKey] = useState<string>(() => `${beforeSrc}|${afterSrc}`);
  const currentKey = `${beforeSrc}|${afterSrc}`;
  if (currentKey !== prevKey) {
    setPrevKey(currentKey);
    setPercent(Math.min(100, Math.max(0, initialPercent)));
  }

  const setFromClientX = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const raw = ((clientX - rect.left) / rect.width) * 100;
    setPercent(Math.min(100, Math.max(0, raw)));
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      draggingRef.current = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {}
      setFromClientX(e.clientX);
    },
    [setFromClientX],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      setFromClientX(e.clientX);
    },
    [setFromClientX],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
  }, []);

  const onKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setPercent((p) => Math.max(0, p - (e.shiftKey ? 10 : 2)));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setPercent((p) => Math.min(100, p + (e.shiftKey ? 10 : 2)));
    } else if (e.key === "Home") {
      e.preventDefault();
      setPercent(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setPercent(100);
    }
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.getBoundingClientRect().width);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className={`relative aspect-[4/5] w-full overflow-hidden rounded-lg bg-zinc-100 select-none ${className}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{ touchAction: "none" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={beforeSrc}
        alt={beforeAlt}
        className="absolute inset-0 h-full w-full object-contain"
        draggable={false}
      />
      <div
        className="pointer-events-none absolute inset-y-0 left-0 overflow-hidden"
        style={{ width: `${percent}%` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={afterSrc}
          alt={afterAlt}
          className="h-full w-full object-contain"
          style={{
            // Match the underlying object-contain rect so the two images align.
            width: containerWidth ?? "auto",
            maxWidth: "none",
          }}
          draggable={false}
        />
      </div>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Before / after compare"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        onKeyDown={onKeyDown}
        className="absolute top-0 h-full w-[2px] cursor-ew-resize bg-white/90 shadow"
        style={{ left: `calc(${percent}% - 1px)` }}
      >
        <div className="absolute top-1/2 left-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-900 bg-white shadow">
          <span className="text-[10px] font-semibold tracking-tight text-zinc-900">
            ⇔
          </span>
        </div>
      </div>
    </div>
  );
}

export default BeforeAfterCompare;
