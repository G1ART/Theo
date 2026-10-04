"use client";

/**
 * UpdatePermissionsModal — sender-side permission editor for an
 * ACTIVE delegation.
 *
 * The picker is intentionally simple: a flat checkbox list against the
 * canonical permission whitelist (kept in sync with the SQL helper
 * `update_delegation_permissions` and `delegation.permissionLabel.*`
 * i18n keys). We do NOT re-expose presets here — the diff against the
 * current set is what matters, and the SQL helper auto-clears
 * `delegations.preset` when a custom set lands so future surfaces
 * don't show a stale preset label.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n/useT";
import { updateDelegationPermissions } from "@/lib/supabase/delegations";
import { formatSupabaseError } from "@/lib/errors/supabase";
import { permissionLabel } from "@/lib/delegation/permissionLabel";
import { BodyPortal } from "@/components/ui/BodyPortal";
import { layer } from "@/lib/ui/layers";

// Canonical permission pool — must match the RLS-anchored whitelist
// in supabase/migrations/20260518000000_delegation_perm_pool_realign.sql
// and `delegation.permissionLabel.*` i18n keys. Adding a new key
// requires updating BOTH the SQL whitelist and the RLS policies that
// gate on it (otherwise the new key has no real effect).
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
type Permission = (typeof ALL_PERMISSIONS)[number];

// QA 2026-06-26 (#10) — project-scope delegations only express
// project-bounded permissions. Account-wide tokens (manage_artworks,
// manage_claims, manage_inquiries, manage_exhibitions,
// edit_profile_public_content) have no RLS effect on a single project
// and were just noise that confused senders into thinking they were
// granting more than they were. With Wave 4's helper extension,
// `manage_works` on a project-scope delegation now ALSO covers
// uploading new works attributed to the principal for that project,
// so the relevant pool collapses to: view / edit_metadata / manage_works.
const PROJECT_SCOPE_PERMISSIONS: ReadonlySet<Permission> = new Set([
  "view",
  "edit_metadata",
  "manage_works",
]);

export type UpdatePermissionsModalProps = {
  open: boolean;
  delegationId: string | null;
  /** Scope of the delegation being edited. When "project" we hide
   *  account-wide permission tokens that have no RLS effect on a
   *  single project — see PROJECT_SCOPE_PERMISSIONS above.
   *
   *  Accepts the full `DelegationScopeType` enum (incl. legacy
   *  "inventory" / "exhibition" tokens that older rows may still
   *  carry) so we can stay forward-compatible without an enum import. */
  scopeType?: string | null;
  initialPermissions: string[];
  /** Pre-fill diff (used when the sender opens the editor from a
   *  recipient's "권한 변경 요청" notification). The proposed set is
   *  what the recipient asked for; we render it as the starting state
   *  and let the sender approve, modify, or cancel. */
  proposedPermissions?: string[] | null;
  /** When true, the modal was opened in response to a recipient
   *  permission-change request. We relax the "must be dirty to save"
   *  constraint so that the sender can also explicitly *acknowledge*
   *  a request whose proposal happens to match the current set
   *  (memo-only request). Saving a no-op still clears the inbox chip
   *  via the SQL RPC. */
  responseMode?: boolean;
  onClose: () => void;
  onSaved?: (result: { added: string[]; removed: string[]; noop?: boolean }) => void;
};

export function UpdatePermissionsModal({
  open,
  delegationId,
  scopeType = "account",
  initialPermissions,
  proposedPermissions,
  responseMode = false,
  onClose,
  onSaved,
}: UpdatePermissionsModalProps) {
  const { t } = useT();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track whether the dialog should snap to the proposal on each open
  // event, even if `initialPermissions` happens to identity-match what
  // we last saw (open→close→re-open with the same row).
  const lastDelegationRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const seed =
      proposedPermissions && proposedPermissions.length > 0
        ? proposedPermissions
        : initialPermissions;
    setSelected(new Set(seed));
    setError(null);
    lastDelegationRef.current = delegationId;
  }, [open, delegationId, initialPermissions, proposedPermissions]);

  // Filter to the scope-relevant subset so the sender only sees
  // permissions that actually have RLS impact for THIS delegation.
  const ordered = useMemo(() => {
    if (scopeType === "project") {
      return ALL_PERMISSIONS.filter((p) =>
        PROJECT_SCOPE_PERMISSIONS.has(p)
      );
    }
    return ALL_PERMISSIONS;
  }, [scopeType]);

  const dirty = useMemo(() => {
    if (!open) return false;
    const initial = new Set(initialPermissions);
    if (initial.size !== selected.size) return true;
    for (const p of selected) if (!initial.has(p)) return true;
    return false;
  }, [open, selected, initialPermissions]);

  const empty = selected.size === 0;

  const handleToggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSave = async () => {
    if (!delegationId) return;
    if (empty) {
      setError(t("delegation.update.empty"));
      return;
    }
    setSaving(true);
    setError(null);
    const { data, error: err } = await updateDelegationPermissions(
      delegationId,
      Array.from(selected)
    );
    setSaving(false);
    if (err) {
      setError(formatSupabaseError(err, t, "errors.fallback"));
      return;
    }
    if (data && data.ok === false) {
      setError(t("errors.fallback"));
      return;
    }
    onSaved?.({
      added: data?.added ?? [],
      removed: data?.removed ?? [],
      noop: data?.noop ?? false,
    });
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
        aria-label={t("delegation.update.title")}
        className="relative w-full max-w-md rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl"
      >
        <h3 className="text-base font-semibold text-zinc-900">
          {t("delegation.update.title")}
        </h3>
        <p className="mt-1 text-xs text-zinc-600">{t("delegation.update.body")}</p>

        <ul className="mt-4 space-y-2">
          {ordered.map((key) => {
            const checked = selected.has(key);
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
                </label>
              </li>
            );
          })}
        </ul>

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
            disabled={saving}
            className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 disabled:opacity-50"
          >
            {t("delegation.update.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || empty || (!dirty && !responseMode)}
            className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {saving
              ? t("delegation.update.saving")
              : responseMode && !dirty
              ? t("delegation.update.acknowledge")
              : t("delegation.update.save")}
          </button>
        </div>
      </div>
    </div>
    </BodyPortal>
  );
}

export type { Permission };
