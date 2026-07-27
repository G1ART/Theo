"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n/useT";

/**
 * Post-publish confirmation card for external-artist invites.
 *
 * Replaces the 3-second toast on the bulk/single upload flows so the
 * gallerist has a clear record of what actually happened, plus a direct
 * path to manage the invited artist. Both success and failure share the
 * same shape; failure surfaces a soft "you can resend from …" message.
 *
 * QA1 mental-model fix: the previous toast disappeared before users
 * could read the artist's name, leaving them unsure whether the invite
 * went out. This card sits at the bottom-right (mobile: full-width
 * bottom) and stays until dismissed OR 10s auto-dismiss.
 */
export function InviteResultCard(props: {
  kind: "sent" | "failed";
  artistName: string;
  onDismiss: () => void;
  /** Auto-dismiss delay in ms. `null` disables auto-dismiss. Default 10s. */
  autoDismissMs?: number | null;
}) {
  const { t } = useT();
  const { kind, artistName, onDismiss, autoDismissMs = 10_000 } = props;
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (autoDismissMs == null) return;
    const tmr = window.setTimeout(onDismiss, autoDismissMs);
    return () => window.clearTimeout(tmr);
  }, [autoDismissMs, onDismiss]);

  const titleKey =
    kind === "sent"
      ? "upload.inviteSentCard.title"
      : "upload.inviteFailedCard.title";
  const bodyKey =
    kind === "sent"
      ? "upload.inviteSentCard.body"
      : "upload.inviteFailedCard.body";

  const titleText = t(titleKey).replace("{name}", artistName);
  const bodyText = t(bodyKey).replace("{name}", artistName);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed inset-x-2 bottom-2 z-40 mx-auto max-w-md rounded-2xl border ${
        kind === "sent"
          ? "border-zinc-200 bg-white"
          : "border-amber-200 bg-amber-50"
      } shadow-xl transition-all duration-300 ease-out sm:inset-x-auto sm:right-4 sm:bottom-4 ${
        entered ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      }`}
    >
      <div className="flex items-start gap-3 p-4">
        {/* Icon dot — subtle status color */}
        <span
          aria-hidden
          className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${
            kind === "sent" ? "bg-emerald-500" : "bg-amber-500"
          }`}
        />
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold ${kind === "sent" ? "text-zinc-900" : "text-amber-900"}`}>
            {titleText}
          </p>
          <p className={`mt-1 text-xs leading-relaxed ${kind === "sent" ? "text-zinc-600" : "text-amber-900/80"}`}>
            {bodyText}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Link
              href="/my/artists"
              onClick={onDismiss}
              className="text-xs font-medium text-zinc-900 underline underline-offset-2 hover:text-zinc-700"
            >
              {t("upload.inviteSentCard.manageLink")}
            </Link>
            <button
              type="button"
              onClick={onDismiss}
              className="text-xs font-medium text-zinc-500 hover:text-zinc-700"
            >
              {t("upload.inviteSentCard.dismiss")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
