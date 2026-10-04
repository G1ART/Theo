"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { layer } from "@/lib/ui/layers";
import { useT } from "@/lib/i18n/useT";
import { MessageComposer } from "./MessageComposer";

type Props = {
  recipientId: string;
  recipientLabel?: string | null;
  size?: "sm" | "md";
};

/**
 * Outlined "Message" button that opens a focused composer sheet. Sits
 * alongside `FollowButton` on public profiles so users can reach out
 * directly without needing to navigate to /people or the AI intro flow.
 *
 * The send path reuses `MessageComposer`, so metering + entitlement UX
 * stay identical to the inline thread composer.
 */
export function MessageRecipientButton({
  recipientId,
  recipientLabel,
  size = "md",
}: Props) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [justSent, setJustSent] = useState(false);
  const sentTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    // Defer the `setMounted` flip so we don't trigger a synchronous
    // setState cascade from an effect body. The portal only renders
    // after this lands, which is the desired semantics anyway — we want
    // the sheet available one frame after hydration completes.
    const handle = requestAnimationFrame(() => {
      setMounted(true);
    });
    return () => {
      cancelAnimationFrame(handle);
      if (sentTimeoutRef.current !== null) {
        window.clearTimeout(sentTimeoutRef.current);
      }
    };
  }, []);

  const openSheet = useCallback(() => {
    setJustSent(false);
    setOpen(true);
  }, []);

  const closeSheet = useCallback(() => {
    setOpen(false);
  }, []);

  const handleSent = useCallback(() => {
    setJustSent(true);
    // Auto-dismiss after a short success hold so the user sees confirmation
    // and the page doesn't remain covered by the sheet.
    if (sentTimeoutRef.current !== null) {
      window.clearTimeout(sentTimeoutRef.current);
    }
    sentTimeoutRef.current = window.setTimeout(() => {
      setOpen(false);
      setJustSent(false);
      sentTimeoutRef.current = null;
    }, 1400);
  }, []);

  const sizeClass =
    size === "sm"
      ? "px-2.5 py-1 text-xs"
      : "px-3 py-1.5 text-sm";

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        className={`inline-flex items-center gap-1.5 rounded border border-zinc-300 bg-white font-medium text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50 ${sizeClass}`}
      >
        <span aria-hidden>✉</span>
        {t("connection.composer.ctaMessage")}
      </button>

      {open && mounted &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("connection.composer.sheetTitle")}
            className={`fixed inset-0 ${layer.scrim} flex items-end justify-center md:items-center`}
          >
            <div
              className="absolute inset-0 bg-black/25 backdrop-blur-[2px]"
              onClick={closeSheet}
              aria-hidden="true"
            />
            <div className="relative z-10 flex w-full max-h-[82vh] flex-col rounded-t-3xl bg-white shadow-2xl md:w-[480px] md:max-w-[90vw] md:rounded-2xl">
              <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-zinc-200 md:hidden" />
              <div className="flex items-start justify-between px-5 pt-4 pb-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-900">
                    {t("connection.composer.sheetTitle")}
                  </p>
                  {recipientLabel && (
                    <p className="mt-0.5 truncate text-xs text-zinc-500">
                      {recipientLabel}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={closeSheet}
                  className="ml-2 shrink-0 rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                  aria-label={t("common.close")}
                >
                  ×
                </button>
              </div>
              <div className="h-px bg-zinc-100" />
              <div className="p-5">
                {justSent ? (
                  <div className="flex flex-col items-center gap-2 rounded-xl bg-emerald-50 px-4 py-6 text-center text-sm text-emerald-700">
                    <span aria-hidden>✓</span>
                    <span>{t("connection.composer.sent")}</span>
                  </div>
                ) : (
                  <MessageComposer
                    recipientId={recipientId}
                    recipientLabel={recipientLabel}
                    onSent={handleSent}
                    variant="inline"
                    autoFocus
                  />
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
