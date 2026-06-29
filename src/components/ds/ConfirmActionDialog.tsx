"use client";

import { useEffect, useId, useRef } from "react";

/**
 * Design-system confirm dialog.
 *
 * Replaces scattered `window.confirm()` calls and ad-hoc `<div class="fixed
 * inset-0...">` overlays so destructive / overwrite actions share a single
 * accessible pattern:
 *
 *   - Esc cancels.
 *   - Backdrop click cancels.
 *   - Body scroll is locked while open.
 *   - Focus moves to the primary confirm button on open; the element that
 *     opened the dialog is restored on close (best-effort).
 *   - `tone="destructive"` paints the primary button red for deletes /
 *     overwrites; `tone="neutral"` keeps a zinc primary.
 *
 * The dialog is intentionally minimal — callers keep their own state for
 * `open` and whatever optimistic UI they want after confirmation. The
 * component never performs side effects itself.
 */

type Tone = "neutral" | "destructive";

type Props = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  tone?: Tone;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const TONE_PRIMARY: Record<Tone, string> = {
  neutral: "bg-zinc-900 text-white hover:bg-zinc-800",
  destructive: "bg-red-600 text-white hover:bg-red-700",
};

export function ConfirmActionDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = "neutral",
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const titleId = useId();
  const descId = useId();
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const lastActive = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    lastActive.current = typeof document !== "undefined" ? document.activeElement : null;
    const prevOverflow = typeof document !== "undefined" ? document.body.style.overflow : "";
    if (typeof document !== "undefined") {
      document.body.style.overflow = "hidden";
    }
    const raf = typeof window !== "undefined" ? window.requestAnimationFrame(() => {
      confirmRef.current?.focus();
    }) : 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.stopPropagation();
        onCancel();
      }
    };
    if (typeof window !== "undefined") window.addEventListener("keydown", onKey, true);
    return () => {
      if (typeof window !== "undefined") {
        window.cancelAnimationFrame(raf);
        window.removeEventListener("keydown", onKey, true);
      }
      if (typeof document !== "undefined") {
        document.body.style.overflow = prevOverflow;
      }
      const el = lastActive.current as HTMLElement | null;
      if (el && typeof el.focus === "function") {
        try {
          el.focus();
        } catch {
          /* best-effort */
        }
      }
    };
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        // `whitespace-normal break-words` defensively resets any inherited
        // `white-space: nowrap` / truncation from the element that opened the
        // dialog (e.g. a feed card's `truncate` artist-name span). Without it
        // the modal copy renders on one line and overflows the box.
        className="w-full max-w-sm whitespace-normal break-words rounded-2xl bg-white p-5 text-left shadow-xl"
      >
        <h2 id={titleId} className="text-sm font-semibold text-zinc-900">
          {title}
        </h2>
        {description && (
          <p id={descId} className="mt-2 text-sm text-zinc-700">
            {description}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:border-zinc-500 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${TONE_PRIMARY[tone]}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
