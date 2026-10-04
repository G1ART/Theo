"use client";

/**
 * RequestPermissionChangeModal — recipient-side surface for asking the
 * sender to adjust the delegation permission set.
 *
 * Lightweight by design:
 *   • No state transition on the delegation row.
 *   • The recipient picks a *proposed* set + writes a free-text memo.
 *   • The SQL helper records an audit event and pings the sender via
 *     `delegation_permission_change_requested`. The notification deep
 *     links the sender to the permission editor pre-filled with the
 *     proposal so they can apply / modify / ignore in one click.
 */

import { useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n/useT";
import { requestDelegationPermissionChange } from "@/lib/supabase/delegations";
import { formatSupabaseError } from "@/lib/errors/supabase";
import { permissionLabel } from "@/lib/delegation/permissionLabel";
import { BodyPortal } from "@/components/ui/BodyPortal";
import { layer } from "@/lib/ui/layers";

// Canonical permission pool — kept in sync with the RLS-anchored
// whitelist in supabase/migrations/20260518000000_delegation_perm_pool_realign.sql.
const ALL_PERMISSIONS = [
  "view",
  "edit_metadata",
  "manage_works",
  "manage_artworks",
  "manage_exhibitions",
  "manage_inquiries",
  "manage_claims",
  "edit_profile_public_content",
] as const;

const MEMO_MAX = 500;

export type RequestPermissionChangeModalProps = {
  open: boolean;
  delegationId: string | null;
  currentPermissions: string[];
  onClose: () => void;
  onSent?: () => void;
};

export function RequestPermissionChangeModal({
  open,
  delegationId,
  currentPermissions,
  onClose,
  onSent,
}: RequestPermissionChangeModalProps) {
  const { t } = useT();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set(currentPermissions));
    setMessage("");
    setError(null);
  }, [open, currentPermissions]);

  const dirty = useMemo(() => {
    if (!open) return false;
    const current = new Set(currentPermissions);
    if (current.size !== selected.size) return true;
    for (const p of selected) if (!current.has(p)) return true;
    return false;
  }, [open, selected, currentPermissions]);

  const handleToggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const memoTrimmed = message.trim();
  const canSubmit = !!delegationId && (dirty || memoTrimmed.length > 0);

  const handleSubmit = async () => {
    if (!delegationId || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    const { data, error: err } = await requestDelegationPermissionChange({
      delegationId,
      message: memoTrimmed || null,
      proposedPermissions: dirty ? Array.from(selected) : [],
    });
    setSubmitting(false);
    if (err) {
      setError(formatSupabaseError(err, t, "delegation.requestChange.error"));
      return;
    }
    if (data && data.ok === false) {
      // RPC returned a structured failure (e.g. delegation no longer
      // active by the time the request landed); surface it instead of
      // silently closing the modal as if it had succeeded.
      setError(t("delegation.requestChange.error"));
      return;
    }
    onSent?.();
    onClose();
  };

  if (!open) return null;

  return (
    <BodyPortal>
    <div className={`fixed inset-0 ${layer.scrim} flex items-end justify-center sm:items-center`}>
      <button
        type="button"
        aria-label="close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("delegation.requestChange.title")}
        className="relative w-full max-w-md rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl"
      >
        <h3 className="text-base font-semibold text-zinc-900">
          {t("delegation.requestChange.title")}
        </h3>
        <p className="mt-1 text-xs text-zinc-600">
          {t("delegation.requestChange.body")}
        </p>

        <ul className="mt-4 space-y-2">
          {ALL_PERMISSIONS.map((key) => {
            const checked = selected.has(key);
            const wasOn = currentPermissions.includes(key);
            return (
              <li key={key}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 hover:bg-zinc-50">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => handleToggle(key)}
                    className="h-4 w-4 rounded border-zinc-300"
                  />
                  <span className="text-sm text-zinc-800">
                    {permissionLabel(key, t)}
                  </span>
                  {checked !== wasOn && (
                    <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      checked
                        ? "bg-emerald-100 text-emerald-900"
                        : "bg-amber-100 text-amber-900"
                    }`}>
                      {checked ? "+" : "−"}
                    </span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>

        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium text-zinc-600">
            {t("delegation.requestChange.messageLabel")}
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, MEMO_MAX))}
            rows={3}
            placeholder={t("delegation.requestChange.messagePlaceholder")}
            className="w-full resize-none rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
          />
          <p className="mt-1 text-right text-[11px] text-zinc-400">
            {message.length} / {MEMO_MAX}
          </p>
        </div>

        {error && (
          <p
            role="alert"
            className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
          >
            {error}
          </p>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 disabled:opacity-50"
          >
            {t("delegation.requestChange.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !canSubmit}
            className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {submitting
              ? t("delegation.requestChange.submitting")
              : t("delegation.requestChange.submit")}
          </button>
        </div>
      </div>
    </div>
    </BodyPortal>
  );
}
