"use client";

/**
 * Overflow menu (`⋯`) shown on each `/my/spaces` list card.
 *
 * Owns three concerns and nothing else:
 *   1. A single trigger button rendered in the card's action row.
 *   2. A tiny popover surface positioned below the trigger with two
 *      actions — Edit (link) and Delete (destructive callback).
 *   3. Outside-click + `Escape` dismissal so callers don't have to
 *      wire portals or focus traps.
 *
 * The confirm dialog itself lives on the page (`ConfirmActionDialog`)
 * because the page owns the optimistic delete state — this component
 * only surfaces the intent.
 *
 * We deliberately avoid `react-aria` / `radix` (not present in the
 * project) and keep the popover local so styling stays consistent
 * with the surrounding zinc-neutral card language.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  /** Aria label for the trigger (i18n `spaces.list.menu.open`). */
  ariaLabel: string;
  /** Href for the Edit item — clicking it navigates and closes. */
  editHref: string;
  editLabel: string;
  deleteLabel: string;
  onDelete: () => void;
};

export function SpaceCardMenu({
  ariaLabel,
  editHref,
  editLabel,
  deleteLabel,
  onDelete,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const handleDelete = useCallback(() => {
    setOpen(false);
    onDelete();
  }, [onDelete]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
      >
        <span aria-hidden className="text-base leading-none">⋯</span>
      </button>
      {open && (
        // Opens upward (`bottom-full`) because the card is
        // `overflow-hidden` (needed for rounded photo corners) — a
        // downward popover would be clipped by the card boundary.
        <div
          role="menu"
          className="absolute right-0 bottom-full z-20 mb-1 w-32 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg"
        >
          <Link
            href={editHref}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-left text-xs text-zinc-700 hover:bg-zinc-50"
          >
            {editLabel}
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={handleDelete}
            className="block w-full border-t border-zinc-100 px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50"
          >
            {deleteLabel}
          </button>
        </div>
      )}
    </div>
  );
}
