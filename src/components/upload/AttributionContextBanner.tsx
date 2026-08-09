"use client";

import { useT } from "@/lib/i18n/useT";

/**
 * Persistent context bar shown once the user has confirmed "who this
 * upload is for" and moved into the main upload flow.
 *
 * Design intent (QA 2026-07 upgrade plan Phase 2-1):
 *   - Bulk/single uploads are long-form flows. Once past the attribution
 *     step, the operator can lose sight of which artist they're
 *     uploading for, especially when acting for a gallery/friend.
 *   - This bar keeps the choice visible + easily reversible without
 *     stealing screen space (≤ h-10, sticky at the top of the flow).
 *   - When the target is an external artist with a valid email, a chip
 *     signals the future side-effect ("email will send at publish"),
 *     mirroring the confirm-step hint so the two moments agree.
 *
 * Non-goals:
 *   - Not a replacement for the attribution step itself; just a persistent
 *     summary. "Change" resets attribution and returns to that step.
 *   - Not the confirmation card that surfaces after publish — this is
 *     forward-looking (what will happen), not backward-looking (what did).
 */
export function AttributionContextBanner(props: {
  /** Display name for the target artist (onboarded or external). */
  artistName: string;
  /** True when the target is an external artist not yet onboarded. */
  isExternal: boolean;
  /**
   * Email captured on the external artist, if any. Used only to decide
   * whether to show the "invite will send" chip. Not displayed as text.
   */
  externalEmail?: string | null;
  /**
   * Only relevant for the external-with-email case; when true, an invite
   * for this email already exists (e.g. from a previous upload) and no
   * new email will fire on publish. Overrides the pending chip.
   */
  hasPendingInviteForEmail?: boolean;
  /** Handler for the "Change" action. Should reset attribution state. */
  onChange: () => void;
}) {
  const { t } = useT();
  const {
    artistName,
    isExternal,
    externalEmail,
    hasPendingInviteForEmail,
    onChange,
  } = props;

  const hasEmail = Boolean(externalEmail && externalEmail.trim().length > 0);
  const showPendingChip = isExternal && hasEmail && !hasPendingInviteForEmail;
  const showAlreadyPendingChip = isExternal && hasEmail && hasPendingInviteForEmail;

  // 2026-08-09: inline slim banner (was previously `sticky top-14 z-20`).
  // The upload flow now renders an interactive image editor with a
  // perspective corner picker; a sticky banner sitting above them
  // covered controls at the top of the editor. Parents render this
  // component ABOVE the editor already so the message is still highly
  // visible without needing to overlay other UI.
  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs"
      role="status"
      aria-label={t("upload.contextBanner.uploadingFor").replace("{name}", artistName)}
    >
      {/* Left accent bar — narrow visual anchor, no color meaning */}
      <span aria-hidden className="hidden h-4 w-1 rounded-full bg-zinc-400 sm:inline-block" />
      <span className="min-w-0 truncate font-medium text-zinc-900">
        {t("upload.contextBanner.uploadingFor").replace("{name}", artistName)}
      </span>
      {showPendingChip && (
        <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
          {t("upload.contextBanner.pendingInviteChip")}
        </span>
      )}
      {showAlreadyPendingChip && (
        <span
          className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600"
          title={t("upload.contextBanner.hasPendingInvite")}
        >
          {t("upload.contextBanner.hasPendingInvite")}
        </span>
      )}
      <button
        type="button"
        onClick={onChange}
        className="ml-auto rounded px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 underline-offset-2 hover:bg-white hover:text-zinc-900 hover:underline"
      >
        {t("upload.contextBanner.change")}
      </button>
    </div>
  );
}
