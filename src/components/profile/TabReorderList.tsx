"use client";

import { useRef } from "react";
import { hitTarget } from "@/components/ds/buttonStyles";
import { useT } from "@/lib/i18n/useT";

export type ReorderRow = {
  key: string;
  label: string;
  count: number;
  publicOnProfile?: boolean;
};

type Props<T extends ReorderRow> = {
  rows: T[];
  onChange: (next: T[]) => void;
};

function swap<T>(rows: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= rows.length) return rows;
  const next = [...rows];
  const current = next[index];
  const other = next[target];
  if (!current || !other) return rows;
  next[index] = other;
  next[target] = current;
  return next;
}

/** Left and right controls, plus a sideways drag, for a horizontal tab strip. */
export function TabReorderList<T extends ReorderRow>({ rows, onChange }: Props<T>) {
  const { t } = useT();
  const startX = useRef(0);

  return (
    <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto">
      {rows.map((row, idx) => (
        <span key={row.key} className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            disabled={idx === 0}
            onClick={() => onChange(swap(rows, idx, -1))}
            className={`${hitTarget} inline-flex min-h-11 min-w-11 items-center justify-center rounded border border-zinc-300 text-base text-zinc-700 hover:bg-zinc-100 disabled:opacity-40`}
            aria-label={t("profile.tabs.moveLeft")}
          >
            ←
          </button>
          <span
            className={`cursor-grab touch-none rounded-full px-3 py-2 text-sm ${
              row.publicOnProfile === false ? "bg-zinc-50 text-zinc-400" : "bg-zinc-100 text-zinc-800"
            }`}
            onPointerDown={(event) => {
              startX.current = event.clientX;
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerUp={(event) => {
              const dx = event.clientX - startX.current;
              if (dx > 28) onChange(swap(rows, idx, 1));
              else if (dx < -28) onChange(swap(rows, idx, -1));
            }}
          >
            {row.label} ({row.count})
          </span>
          <button
            type="button"
            disabled={idx >= rows.length - 1}
            onClick={() => onChange(swap(rows, idx, 1))}
            className={`${hitTarget} inline-flex min-h-11 min-w-11 items-center justify-center rounded border border-zinc-300 text-base text-zinc-700 hover:bg-zinc-100 disabled:opacity-40`}
            aria-label={t("profile.tabs.moveRight")}
          >
            →
          </button>
        </span>
      ))}
    </div>
  );
}
