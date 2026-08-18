"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n/useT";
import { formatDisplayName } from "@/lib/identity/format";
import { pickLocalizedTitle } from "@/lib/i18n/pickLocalized";
import type { Locale } from "@/lib/i18n/locale";
import {
  PRESET_PERMISSIONS,
  cancelDelegationInvite,
  dismissDelegationPermissionChangeRequest,
  getDelegationDetail,
  resignDelegationByDelegate,
  revokeDelegation,
  type DelegationDetail,
  type DelegationPreset,
} from "@/lib/supabase/delegations";
import { getArtworkImageUrl } from "@/lib/supabase/artworks";
import { formatSupabaseError } from "@/lib/errors/supabase";
import { permissionLabel } from "@/lib/delegation/permissionLabel";
import { UpdatePermissionsModal } from "./UpdatePermissionsModal";
import { RequestPermissionChangeModal } from "./RequestPermissionChangeModal";

export type DelegationDetailDrawerProps = {
  delegationId: string | null;
  onClose: () => void;
  onChanged?: () => void;
  /**
   * Whether the *current viewer* is the delegator (owner). When true,
   * sender-side actions (cancel invite, change permissions, revoke) are
   * rendered. When false, recipient-side actions (request permission
   * change, withdraw) are rendered. Drives the entire footer layout.
   */
  viewerIsOwner: boolean;
  /**
   * Optional initial action to launch automatically when the drawer
   * opens. Currently honored only for `update`, used by the deep-link
   * from a recipient's "권한 변경 요청" notification so the owner lands
   * directly in the permission editor with the proposal pre-applied.
   */
  initialAction?: "update" | null;
  /** Permission set proposed by the recipient — when arriving via a
   *  permission-change-requested notification deep link. Pre-fills the
   *  UpdatePermissionsModal. */
  proposedPermissions?: string[] | null;
};

const DENIES_SHARED = [
  "delegation.deniesShared.login",
  "delegation.deniesShared.billing",
  "delegation.deniesShared.deleteAccount",
  "delegation.deniesShared.delegations",
] as const;

function presetTitleKey(p: DelegationPreset): string {
  switch (p) {
    case "operations": return "delegation.preset.operations.title";
    case "content": return "delegation.preset.content.title";
    case "review": return "delegation.preset.review.title";
    case "project_co_edit": return "delegation.preset.projectCoEdit.title";
    case "project_works_only": return "delegation.preset.projectWorksOnly.title";
    case "project_review": return "delegation.preset.projectReview.title";
  }
}

function formatDate(value: string | null | undefined, locale = "ko-KR"): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString(locale, {
      year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return value;
  }
}

export function DelegationDetailDrawer({
  delegationId,
  onClose,
  onChanged,
  viewerIsOwner,
  initialAction = null,
  proposedPermissions = null,
}: DelegationDetailDrawerProps) {
  const { t, locale } = useT();
  const [detail, setDetail] = useState<DelegationDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<
    null | "cancel" | "revoke" | "resign" | "dismiss"
  >(null);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!delegationId) {
      setDetail(null);
      setUpdateOpen(false);
      setRequestOpen(false);
      setToast(null);
      return;
    }
    setLoading(true);
    setError(null);
    getDelegationDetail(delegationId).then(({ data, error: err }) => {
      if (err) {
        setError(formatSupabaseError(err, t, "delegation.error.unknown"));
      } else {
        setDetail(data);
      }
      setLoading(false);
    });
  }, [delegationId, t]);

  // Honor a deep-link request to auto-open the update modal once the
  // detail has loaded (only meaningful when the viewer is the owner of
  // an active delegation; otherwise we silently ignore the hint).
  //
  // Critical: do this exactly ONCE per drawer-open. If we re-trigger
  // every time `detail` is refetched (e.g. after the user saves the
  // permission edit and we silently refresh the detail in-place), the
  // modal would auto-reopen forever — that's the "keeps popping up
  // again on its own" symptom the QA team filed on 2026-04-29.
  const deepLinkConsumedRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      initialAction === "update" &&
      detail &&
      viewerIsOwner &&
      detail.delegation.status === "active" &&
      deepLinkConsumedRef.current !== detail.delegation.id
    ) {
      deepLinkConsumedRef.current = detail.delegation.id;
      setUpdateOpen(true);
    }
  }, [initialAction, detail, viewerIsOwner]);

  // Reset the deep-link guard when the drawer is closed so a future
  // open with the same delegation id can honor the hint again.
  useEffect(() => {
    if (!delegationId) deepLinkConsumedRef.current = null;
  }, [delegationId]);

  const handleCancelInvite = useCallback(async () => {
    if (!detail) return;
    if (!confirm(t("delegation.detail.cancelInviteConfirm"))) return;
    setBusy("cancel");
    const { error: err } = await cancelDelegationInvite(detail.delegation.id);
    setBusy(null);
    if (err) {
      setError(formatSupabaseError(err, t, "delegation.error.unknown"));
      return;
    }
    onChanged?.();
    onClose();
  }, [detail, onChanged, onClose, t]);

  const handleRevoke = useCallback(async () => {
    if (!detail) return;
    if (!confirm(t("delegation.detail.revokeConfirm"))) return;
    setBusy("revoke");
    const { error: err } = await revokeDelegation(detail.delegation.id);
    setBusy(null);
    if (err) {
      setError(formatSupabaseError(err, t, "delegation.error.unknown"));
      return;
    }
    onChanged?.();
    onClose();
  }, [detail, onChanged, onClose, t]);

  const handleDismissChangeRequest = useCallback(async () => {
    if (!detail) return;
    if (!confirm(t("delegation.detail.dismissChangeRequestConfirm"))) return;
    setBusy("dismiss");
    const { data, error: err } = await dismissDelegationPermissionChangeRequest({
      delegationId: detail.delegation.id,
    });
    setBusy(null);
    if (err) {
      setError(formatSupabaseError(err, t, "delegation.error.unknown"));
      return;
    }
    if (data && data.ok === false) {
      setError(t("delegation.error.unknown"));
      return;
    }
    setToast(t("delegation.detail.dismissChangeRequestDone"));
    onChanged?.();
    const { data: refreshed } = await getDelegationDetail(detail.delegation.id);
    if (refreshed) setDetail(refreshed);
  }, [detail, onChanged, t]);

  const handleResign = useCallback(async () => {
    if (!detail) return;
    if (!confirm(t("delegation.detail.resignConfirm"))) return;
    setBusy("resign");
    const { error: err } = await resignDelegationByDelegate(detail.delegation.id);
    setBusy(null);
    if (err) {
      setError(formatSupabaseError(err, t, "delegation.error.unknown"));
      return;
    }
    onChanged?.();
    onClose();
  }, [detail, onChanged, onClose, t]);

  const currentPermissions = useMemo<string[]>(() => {
    if (!detail) return [];
    const d = detail.delegation;
    if (d.preset && PRESET_PERMISSIONS[d.preset]) return PRESET_PERMISSIONS[d.preset];
    return d.permissions ?? [];
  }, [detail]);

  /**
   * Latest pending permission-change request from the recipient (if
   * any). We surface it on the owner's active-state footer so they
   * don't have to dig through the activity feed to see what was
   * proposed. The proposal also pre-fills the UpdatePermissionsModal
   * when no explicit `proposedPermissions` prop was provided (the
   * drawer was opened locally rather than via a deep link).
   */
  const pendingChangeRequest = useMemo<
    { message: string | null; proposed: string[]; createdAt: string } | null
  >(() => {
    if (!detail) return null;
    // Audit events are returned newest-first by `getDelegationDetail`.
    // Find the latest change request, then check whether a
    // `permissions_updated` event happened *after* it; if so, the
    // request has already been resolved and we should not show the
    // amber pending card / pre-fill the editor with the stale proposal.
    const lastRequest = detail.events.find(
      (e) => e.event_type === "permission_change_requested"
    );
    if (!lastRequest) return null;
    const lastUpdate = detail.events.find(
      (e) => e.event_type === "permissions_updated"
    );
    if (
      lastUpdate &&
      Date.parse(lastUpdate.created_at) >= Date.parse(lastRequest.created_at)
    ) {
      return null;
    }
    const meta = (lastRequest.metadata ?? {}) as Record<string, unknown>;
    const proposed = Array.isArray(meta.proposed_permissions)
      ? (meta.proposed_permissions as string[])
      : [];
    const messageRaw = typeof meta.message === "string" ? meta.message : null;
    return {
      message: messageRaw && messageRaw.trim() ? messageRaw : null,
      proposed,
      createdAt: lastRequest.created_at,
    };
  }, [detail]);

  const effectiveProposed = useMemo<string[] | null>(() => {
    if (proposedPermissions && proposedPermissions.length > 0) {
      return proposedPermissions;
    }
    if (pendingChangeRequest && pendingChangeRequest.proposed.length > 0) {
      return pendingChangeRequest.proposed;
    }
    return null;
  }, [proposedPermissions, pendingChangeRequest]);

  const open = !!delegationId;

  return (
    <div
      className={`fixed inset-0 z-40 transition-opacity ${
        open ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <button
        type="button"
        aria-label="close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t("delegation.detail.title")}
        className={`absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-white shadow-2xl transition-transform ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
          <h3 className="text-base font-semibold text-zinc-900">{t("delegation.detail.title")}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5 text-sm">
          {loading && <p className="text-zinc-500">{t("common.loading")}</p>}
          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
          )}
          {detail && (
            <DetailBody t={t} locale={locale} detail={detail} viewerIsOwner={viewerIsOwner} />
          )}
        </div>

        {detail && (
          <DetailFooter
            t={t}
            detail={detail}
            viewerIsOwner={viewerIsOwner}
            busy={busy}
            toast={toast}
            pendingChangeRequest={pendingChangeRequest}
            onCancelInvite={handleCancelInvite}
            onRevoke={handleRevoke}
            onResign={handleResign}
            onUpdate={() => setUpdateOpen(true)}
            onRequest={() => setRequestOpen(true)}
            onDismissChangeRequest={handleDismissChangeRequest}
          />
        )}
      </aside>

      {detail && viewerIsOwner && detail.delegation.status === "active" && (
        <UpdatePermissionsModal
          open={updateOpen}
          delegationId={detail.delegation.id}
          scopeType={detail.delegation.scope_type}
          initialPermissions={currentPermissions}
          proposedPermissions={effectiveProposed}
          responseMode={!!effectiveProposed}
          onClose={() => setUpdateOpen(false)}
          onSaved={(result) => {
            const added = result.added.length;
            const removed = result.removed.length;
            if (result.noop) {
              setToast(t("delegation.update.noop"));
            } else if (added && !removed) {
              setToast(
                t("delegation.update.successAdded").replace("{count}", String(added))
              );
            } else if (removed && !added) {
              setToast(
                t("delegation.update.successRemoved").replace("{count}", String(removed))
              );
            } else {
              setToast(
                `${t("delegation.update.successAdded").replace("{count}", String(added))} · ${
                  t("delegation.update.successRemoved").replace("{count}", String(removed))
                }`
              );
            }
            onChanged?.();
            // Drawer detail is now stale; refetch in-place so the
            // permissions section reflects the new set without closing.
            getDelegationDetail(detail.delegation.id).then(({ data }) => {
              if (data) setDetail(data);
            });
          }}
        />
      )}

      {detail && !viewerIsOwner && detail.delegation.status === "active" && (
        <RequestPermissionChangeModal
          open={requestOpen}
          delegationId={detail.delegation.id}
          currentPermissions={currentPermissions}
          onClose={() => setRequestOpen(false)}
          onSent={() => setToast(t("delegation.requestChange.success"))}
        />
      )}
    </div>
  );
}

/**
 * Footer button matrix:
 *
 *   role  | status   | buttons
 *   ------|----------|----------------------------------------------------
 *   owner | pending  | [Cancel invite]                              (gray)
 *   owner | active   | [Change permissions]   [Revoke delegation]   (gray + red)
 *   dlgte | active   | [Request perm change]  [Withdraw from delegation] (gray + gray)
 *   *     | terminal | (no footer)
 *
 * Recipient-side `pending` is intentionally absent: pending invites
 * are accepted/declined directly from the list cards, not from the
 * drawer.
 */
function DetailFooter({
  t,
  detail,
  viewerIsOwner,
  busy,
  toast,
  pendingChangeRequest,
  onCancelInvite,
  onRevoke,
  onResign,
  onUpdate,
  onRequest,
  onDismissChangeRequest,
}: {
  t: (k: string) => string;
  detail: DelegationDetail;
  viewerIsOwner: boolean;
  busy: null | "cancel" | "revoke" | "resign" | "dismiss";
  toast: string | null;
  pendingChangeRequest:
    | { message: string | null; proposed: string[]; createdAt: string }
    | null;
  onCancelInvite: () => void;
  onRevoke: () => void;
  onResign: () => void;
  onUpdate: () => void;
  onRequest: () => void;
  onDismissChangeRequest: () => void;
}) {
  const status = detail.delegation.status;

  if (viewerIsOwner && status === "pending") {
    return (
      <footer className="border-t border-zinc-100 px-5 py-3">
        {toast && (
          <p className="mb-2 rounded-md bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800">
            {toast}
          </p>
        )}
        <button
          type="button"
          onClick={onCancelInvite}
          disabled={busy === "cancel"}
          className="w-full rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
        >
          {busy === "cancel"
            ? t("delegation.detail.cancelingInvite")
            : t("delegation.detail.cancelInvite")}
        </button>
      </footer>
    );
  }

  if (viewerIsOwner && status === "active") {
    return (
      <footer className="border-t border-zinc-100 px-5 py-3">
        {toast && (
          <p className="mb-2 rounded-md bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800">
            {toast}
          </p>
        )}
        {pendingChangeRequest && (
          <div
            role="status"
            className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          >
            <p className="font-medium">
              {t("delegation.detail.pendingRequestHeadline")}
            </p>
            {pendingChangeRequest.message && (
              <p className="mt-1 whitespace-pre-wrap">
                &ldquo;{pendingChangeRequest.message}&rdquo;
              </p>
            )}
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={onUpdate}
                className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-100"
              >
                {t("delegation.detail.pendingRequestReview")}
              </button>
              <button
                type="button"
                onClick={onDismissChangeRequest}
                disabled={busy === "dismiss"}
                className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
              >
                {busy === "dismiss"
                  ? t("delegation.detail.pendingRequestDismissing")
                  : t("delegation.detail.pendingRequestDismiss")}
              </button>
            </div>
          </div>
        )}
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
          {t("delegation.detail.ownerActionsLabel")}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onUpdate}
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
          >
            {t("delegation.detail.updatePermissions")}
          </button>
          <button
            type="button"
            onClick={onRevoke}
            disabled={busy === "revoke"}
            className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            {busy === "revoke"
              ? t("delegation.detail.revoking")
              : t("delegation.revoke")}
          </button>
        </div>
      </footer>
    );
  }

  if (!viewerIsOwner && status === "active") {
    return (
      <footer className="border-t border-zinc-100 px-5 py-3">
        {toast && (
          <p className="mb-2 rounded-md bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800">
            {toast}
          </p>
        )}
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
          {t("delegation.detail.delegateActionsLabel")}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onRequest}
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
          >
            {t("delegation.detail.requestPermissionChange")}
          </button>
          <button
            type="button"
            onClick={onResign}
            disabled={busy === "resign"}
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
          >
            {busy === "resign"
              ? t("delegation.detail.resigning")
              : t("delegation.detail.resignDelegation")}
          </button>
        </div>
      </footer>
    );
  }

  // Terminal states (revoked/declined/expired) → drawer is read-only.
  return null;
}

function DetailBody({
  t, locale, detail, viewerIsOwner,
}: {
  t: (k: string) => string;
  locale: Locale;
  detail: DelegationDetail;
  viewerIsOwner: boolean;
}) {
  const d = detail.delegation;
  const counterpart = viewerIsOwner ? detail.delegate_profile : detail.delegator_profile;
  const counterpartLabel =
    (counterpart && formatDisplayName(counterpart, t, locale)) ||
    (counterpart?.username ? `@${counterpart.username}` : null) ||
    d.delegate_email ||
    "—";

  const projectTitle = detail.project
    ? pickLocalizedTitle(detail.project, locale) || detail.project.title
    : null;
  const scopeLabel =
    d.scope_type === "project"
      ? projectTitle
        ? t("delegation.scopeExhibitionPrefix").replace("{title}", projectTitle)
        : t("delegation.scopeProject")
      : t("delegation.scopeAccount");

  const presetLabel = d.preset ? t(presetTitleKey(d.preset)) : "—";
  const permissions = d.preset
    ? PRESET_PERMISSIONS[d.preset]
    : d.permissions ?? [];

  return (
    <>
      <section className="mb-5 flex items-center gap-3 rounded-lg bg-zinc-50 px-3 py-3">
        <Avatar profile={counterpart} email={d.delegate_email} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-zinc-900">{counterpartLabel}</p>
          <p className="truncate text-xs text-zinc-500">{scopeLabel}</p>
        </div>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${statusToneClasses(d.status)}`}>
          {t(statusKey(d.status))}
        </span>
      </section>

      <section className="mb-5">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
          {t("delegation.detail.presetLabel")}
        </p>
        <p className="text-sm text-zinc-800">{presetLabel}</p>
      </section>

      <section className="mb-5">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
          {t("delegation.detail.canDo")}
        </p>
        <ul className="space-y-1 text-sm text-zinc-700">
          {(permissions ?? []).map((p) => (
            <li key={p}>· {permissionLabel(p, t)}</li>
          ))}
          {(!permissions || permissions.length === 0) && (
            <li className="text-zinc-400">—</li>
          )}
        </ul>
      </section>

      <section className="mb-5">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
          {t("delegation.detail.cannotShare")}
        </p>
        <ul className="space-y-1 text-sm text-zinc-700">
          {DENIES_SHARED.map((k) => (
            <li key={k}>· {t(k)}</li>
          ))}
        </ul>
      </section>

      {d.note && (
        <section className="mb-5">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
            {t("delegation.detail.noteLabel")}
          </p>
          <p className="rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-800">{d.note}</p>
        </section>
      )}

      <section className="mb-5">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
          {t("delegation.detail.timeline")}
        </p>
        <ul className="space-y-1 text-sm text-zinc-700">
          {d.invited_at && (
            <li>· {t("delegation.dateInvited").replace("{date}", formatDate(d.invited_at))}</li>
          )}
          {d.accepted_at && (
            <li>· {t("delegation.dateAccepted").replace("{date}", formatDate(d.accepted_at))}</li>
          )}
          {d.declined_at && (
            <li>· {t("delegation.dateDeclined").replace("{date}", formatDate(d.declined_at))}</li>
          )}
          {d.revoked_at && (
            <li>· {t("delegation.dateRevoked").replace("{date}", formatDate(d.revoked_at))}</li>
          )}
        </ul>
      </section>

      {detail.events.length > 0 && (
        <section className="mb-3">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
            {t("delegation.detail.recentActivity")}
          </p>
          <ul className="space-y-1.5 text-sm text-zinc-700">
            {detail.events.slice(0, 5).map((e) => (
              <li key={e.id} className="flex items-baseline justify-between gap-3">
                <span className="truncate">{eventLabel(t, e.event_type)}</span>
                <span className="shrink-0 text-xs text-zinc-400">{formatDate(e.created_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/**
 * Resolve a delegation_activity_events.event_type to a human-readable
 * label. Two-tier strategy:
 *
 *   1. Try `delegation.event.<type>` — known lifecycle/mutation events
 *      have explicit i18n entries.
 *   2. If `useT()` returns the literal key (the i18n miss sentinel),
 *      fall back to `delegation.event.unknown` so users never see raw
 *      keys in the audit drawer.
 *
 * Server-side we are conservative about which event_types we emit, but
 * future migrations may add new ones; the fallback prevents a regression
 * window where a new event surfaces as a debug-looking string.
 */
function eventLabel(t: (k: string) => string, eventType: string): string {
  if (!eventType) return t("delegation.event.unknown");
  const key = `delegation.event.${eventType}`;
  const candidate = t(key);
  if (candidate && candidate !== key) return candidate;
  return t("delegation.event.unknown");
}

function statusKey(status: string): string {
  switch (status) {
    case "pending": return "delegation.tabPending";
    case "active": return "delegation.tabActive";
    default: return "delegation.tabClosed";
  }
}

function statusToneClasses(status: string): string {
  switch (status) {
    case "pending": return "bg-amber-100 text-amber-900";
    case "active": return "bg-emerald-100 text-emerald-900";
    default: return "bg-zinc-200 text-zinc-700";
  }
}

function Avatar({
  profile, email,
}: { profile: DelegationDetail["delegator_profile"] | DelegationDetail["delegate_profile"]; email?: string | null }) {
  const url = profile?.avatar_url
    ? profile.avatar_url.startsWith("http")
      ? profile.avatar_url
      : getArtworkImageUrl(profile.avatar_url, "avatar")
    : null;
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="h-10 w-10 rounded-full object-cover" />;
  }
  const seed = profile?.display_name ?? profile?.username ?? email ?? "?";
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-200 text-sm font-medium text-zinc-600">
      {seed.charAt(0).toUpperCase()}
    </div>
  );
}
