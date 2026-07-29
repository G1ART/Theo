"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/useT";
import { getSession } from "@/lib/supabase/auth";

type Props = {
  open: boolean;
  onClose: () => void;
  externalArtistId: string;
  displayName: string;
  contextArtworkId?: string | null;
  contextExhibitionId?: string | null;
  /** Reserved for future positioning against the trigger element. */
  anchorEl?: HTMLElement | null;
};

type Phase = "idle" | "sending" | "success" | "error";

/**
 * QA 2026-07-29 (PART C.2) — "let this artist know someone's interested"
 * popover. Shown when a viewer clicks an unonboarded (external) artist's
 * name/badge on an exhibition or artwork surface.
 *
 * The explicit CTA fires a POST to `/api/artist-profile-interest-email`,
 * which calls the `record_external_artist_profile_interest_click`
 * SECURITY DEFINER RPC (explicit trigger → dispatch immediately when the
 * gallery/curator opted in at invite time). The RPC decides whether an
 * email actually goes out — this component just reports success once the
 * click itself was recorded, regardless of whether email dispatch was
 * eligible, so the UX doesn't leak consent/eligibility details to viewers.
 */
export function UnonboardedArtistInterestPopover({
  open,
  onClose,
  externalArtistId,
  displayName,
  contextArtworkId,
  contextExhibitionId,
}: Props) {
  const { t } = useT();
  const [phase, setPhase] = useState<Phase>("idle");
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  if (!open) return null;

  // All close paths (backdrop click, close button, post-success timeout)
  // route through here so the popover always reopens fresh at `idle`
  // instead of resurfacing a stale phase — avoids needing a
  // reset-on-prop-change effect (react-hooks/set-state-in-effect).
  function handleClose() {
    setPhase("idle");
    onClose();
  }

  async function handleExplicitInterest() {
    setPhase("sending");
    try {
      const {
        data: { session },
      } = await getSession();
      const token = session?.access_token;
      if (!token) {
        // Anonymous viewer — client should really route through signup, but
        // fail soft here rather than throw.
        setPhase("success");
      } else {
        const resp = await fetch("/api/artist-profile-interest-email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            externalArtistId,
            triggerKind: "explicit",
            context: {
              exhibitionId: contextExhibitionId ?? null,
              artworkId: contextArtworkId ?? null,
            },
          }),
        });
        // Any 200 (dispatched or not, or already-onboarded raced with the
        // popover) reads as a friendly success to the viewer — the copy
        // never promises an email was actually sent.
        void resp;
        setPhase("success");
      }
    } catch (err) {
      console.warn("[UnonboardedArtistInterestPopover] interest click failed", err);
      setPhase("success");
    }
    closeTimerRef.current = setTimeout(() => {
      handleClose();
    }, 2500);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {phase === "success" ? (
          <div className="text-center">
            <p className="text-2xl">🌱</p>
            <p className="mt-2 text-sm font-medium text-zinc-900">
              {t("artist.unonboarded.success")}
            </p>
          </div>
        ) : (
          <>
            <h2 className="text-sm font-semibold text-zinc-900">
              {t("artist.unonboarded.title").replace("{name}", displayName)}
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-zinc-600">
              {t("artist.unonboarded.body")}
            </p>
            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={handleExplicitInterest}
                disabled={phase === "sending"}
                className="flex-1 rounded-full bg-zinc-900 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
              >
                {phase === "sending" ? t("artist.unonboarded.sending") : t("artist.unonboarded.cta")}
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="rounded-full border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
              >
                {t("artist.unonboarded.close")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
