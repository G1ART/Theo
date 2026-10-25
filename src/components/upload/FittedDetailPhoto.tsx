"use client";

import { useEffect, useRef, useState } from "react";
import { fittedPhotoBox } from "@/lib/upload/fittedPhotoBox";

type Box = { width: number; height: number };

type Props = {
  src: string;
  /** Green when this work can be published, red while required fields are empty. */
  ready: boolean;
  onRemove?: () => void;
  removeLabel?: string;
  onActivate?: () => void;
  activateLabel?: string;
};

/**
 * Detail photo plus the readiness stripe under it.
 * The stripe matches the visible photo width. The photo sits in the
 * horizontal and vertical center of the slot. Landscape aspect is kept.
 */
export function FittedDetailPhoto({
  src,
  ready,
  onRemove,
  removeLabel,
  onActivate,
  activateLabel,
}: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);

  useEffect(() => {
    const frame = frameRef.current;
    const img = imgRef.current;
    if (!frame || !img) return;

    const measure = () => {
      const naturalWidth = img.naturalWidth;
      const naturalHeight = img.naturalHeight;
      const barPx = barRef.current?.offsetHeight ?? 4;
      const slotW = frame.clientWidth;
      const slotH = frame.clientHeight - barPx;
      if (!naturalWidth || !naturalHeight || slotW <= 0 || slotH <= 0) {
        setBox(null);
        return;
      }
      const next = fittedPhotoBox(naturalWidth, naturalHeight, slotW, slotH);
      setBox((prev) =>
        prev && prev.width === next.width && prev.height === next.height ? prev : next,
      );
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(frame);
    return () => observer.disconnect();
  }, [src]);

  const photo = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imgRef}
      src={src}
      alt=""
      onLoad={() => {
        const frame = frameRef.current;
        const img = imgRef.current;
        if (!frame || !img) return;
        const barPx = barRef.current?.offsetHeight ?? 4;
        const next = fittedPhotoBox(
          img.naturalWidth,
          img.naturalHeight,
          frame.clientWidth,
          frame.clientHeight - barPx,
        );
        if (next.width > 0 && next.height > 0) setBox(next);
      }}
      className={`block bg-zinc-100 object-contain outline outline-1 outline-zinc-200 ${box ? "" : "max-h-16 max-w-full"}`}
      style={box ? { width: box.width, height: box.height } : undefined}
    />
  );

  return (
    <div ref={frameRef} className="flex h-[4.25rem] w-full items-center justify-center">
      <div className="relative max-w-full" style={box ? { width: box.width } : undefined}>
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="absolute -right-1 -top-1 z-10 flex h-4 w-4 items-center justify-center rounded-full border border-zinc-300 bg-white text-[10px] leading-none text-zinc-600 hover:text-zinc-900"
            aria-label={removeLabel}
          >
            ×
          </button>
        ) : null}
        {onActivate ? (
          <button type="button" onClick={onActivate} aria-label={activateLabel} className="block max-w-full">
            {photo}
          </button>
        ) : (
          photo
        )}
        <div
          ref={barRef}
          data-detail-readiness-bar=""
          className={`h-1 w-full ${box ? (ready ? "bg-emerald-500" : "bg-red-500") : "bg-transparent"}`}
        />
      </div>
    </div>
  );
}
