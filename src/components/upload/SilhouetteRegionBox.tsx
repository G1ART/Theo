"use client";

import { useRef, useState } from "react";
import { PHOTOROOM_SEGMENT_MAX_EDGE } from "@/lib/image/enhancement/photoroomSegment";

export type NormBox = { x: number; y: number; w: number; h: number };

const MIN = 0.08;

/**
 * Loose rectangle the artist drags around one artwork before
 * background removal. Only the pixels inside this box are sent to
 * the segmenter, so a round canvas in a furnished room is not
 * competing with the sofa.
 */
export function SilhouetteRegionBox({
  src,
  box,
  onChange,
}: {
  src: string;
  box: NormBox;
  onChange: (next: NormBox) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    kind: "move" | "nw" | "ne" | "sw" | "se";
    px: number;
    py: number;
    orig: NormBox;
  } | null>(null);
  const [, bump] = useState(0);

  function normPoint(event: React.PointerEvent) {
    const frame = frameRef.current;
    if (!frame) return { x: 0, y: 0 };
    const rect = frame.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / Math.max(1, rect.width),
      y: (event.clientY - rect.top) / Math.max(1, rect.height),
    };
  }

  function move(event: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const p = normPoint(event);
    const dx = p.x - drag.px;
    const dy = p.y - drag.py;
    const o = drag.orig;
    let next = { ...o };
    if (drag.kind === "move") {
      next.x = clamp(o.x + dx, 0, 1 - o.w);
      next.y = clamp(o.y + dy, 0, 1 - o.h);
    } else {
      let x0 = o.x;
      let y0 = o.y;
      let x1 = o.x + o.w;
      let y1 = o.y + o.h;
      if (drag.kind === "nw" || drag.kind === "sw") x0 = clamp(o.x + dx, 0, x1 - MIN);
      if (drag.kind === "ne" || drag.kind === "se") x1 = clamp(o.x + o.w + dx, x0 + MIN, 1);
      if (drag.kind === "nw" || drag.kind === "ne") y0 = clamp(o.y + dy, 0, y1 - MIN);
      if (drag.kind === "sw" || drag.kind === "se") y1 = clamp(o.y + o.h + dy, y0 + MIN, 1);
      next = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    onChange(next);
    bump((n) => n + 1);
  }

  function start(kind: "move" | "nw" | "ne" | "sw" | "se", event: React.PointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    const p = normPoint(event);
    dragRef.current = { kind, px: p.x, py: p.y, orig: box };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  const handles = [
    ["nw", "left-0 top-0 cursor-nwse-resize"],
    ["ne", "right-0 top-0 cursor-nesw-resize"],
    ["sw", "left-0 bottom-0 cursor-nesw-resize"],
    ["se", "right-0 bottom-0 cursor-nwse-resize"],
  ] as const;

  return (
    <div className="flex justify-center overflow-hidden rounded-lg bg-[#f3f3f3]">
    <div
      ref={frameRef}
      className="relative inline-block max-w-full"
      onPointerMove={move}
      onPointerUp={() => {
        dragRef.current = null;
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="block max-h-[420px] max-w-full h-auto w-auto" draggable={false} />
      <div
        className="absolute border-2 border-zinc-900 bg-zinc-900/10"
        style={{
          left: `${box.x * 100}%`,
          top: `${box.y * 100}%`,
          width: `${box.w * 100}%`,
          height: `${box.h * 100}%`,
        }}
        onPointerDown={(event) => start("move", event)}
      >
        {handles.map(([kind, place]) => (
          <span
            key={kind}
            className={`absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-zinc-900 ${place}`}
            onPointerDown={(event) => start(kind, event)}
          />
        ))}
      </div>
    </div>
    </div>
  );
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

/**
 * JPEG of the pixels inside `box`, plus a little wall around it.
 * The segmenter only sees this crop. The margin keeps the canvas edge
 * off the frame, where the matte otherwise sticks to the crop border.
 * Long edge is capped at the same size the segment call keeps.
 */
const SEGMENT_CONTEXT = 0.04;

export async function cropFileToNormBox(file: File, box: NormBox): Promise<File> {
  const bmp = await createImageBitmap(file);
  const mx = box.w * SEGMENT_CONTEXT;
  const my = box.h * SEGMENT_CONTEXT;
  const x0 = clamp(box.x - mx, 0, 1);
  const y0 = clamp(box.y - my, 0, 1);
  const x1 = clamp(box.x + box.w + mx, 0, 1);
  const y1 = clamp(box.y + box.h + my, 0, 1);
  const sx = Math.round(x0 * bmp.width);
  const sy = Math.round(y0 * bmp.height);
  const sw = Math.max(1, Math.min(bmp.width - sx, Math.round(x1 * bmp.width) - sx));
  const sh = Math.max(1, Math.min(bmp.height - sy, Math.round(y1 * bmp.height) - sy));
  const long = Math.max(sw, sh);
  const scale = long > PHOTOROOM_SEGMENT_MAX_EDGE ? PHOTOROOM_SEGMENT_MAX_EDGE / long : 1;
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bmp.close();
    throw new Error("error");
  }
  ctx.imageSmoothingEnabled = scale < 1;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, dw, dh);
  bmp.close();
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (out) => (out ? resolve(out) : reject(new Error("error"))),
      "image/jpeg",
      0.97,
    );
  });
  return new File([blob], "region.jpg", { type: "image/jpeg" });
}
