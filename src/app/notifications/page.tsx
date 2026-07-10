"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AuthGate } from "@/components/AuthGate";
import { supabase } from "@/lib/supabase/client";
import {
  listNotifications,
  markAllAsRead,
  markNotificationRead,
  type NotificationRow,
} from "@/lib/supabase/notifications";
import { useT } from "@/lib/i18n/useT";
import { backToLabel } from "@/lib/i18n/back";
import { formatDisplayName } from "@/lib/identity/format";
import { EmptyState } from "@/components/ds/EmptyState";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import {
  acceptFollowRequest,
  declineFollowRequest,
} from "@/lib/supabase/follows";

/**
 * Inline accept/decline controls for a follow_request notification.
 *
 * Behaviour rules (post-2026-04-29 hardening):
 *   • Successful RPC (data === true) → render the resolved label
 *     ("수락됨" / "거절됨"), mark the notification read, and ask the
 *     parent to refetch. The follow_request notification is now also
 *     deleted server-side by the RPC, so the row will simply
 *     disappear on the next refresh — the inline label is just a
 *     bridge so the user gets immediate feedback.
 *   • RPC returns false (matching row already gone) → treat as a
 *     stale notification. Same UI as the success path; the refetch
 *     will drop the row.
 *   • RPC throws (network / RLS / auth) → surface the error inline
 *     so the user knows the action didn't land. They can retry
 *     without reloading the page.
 */
function FollowRequestActions({
  row,
  onResolved,
  t,
}: {
  row: NotificationRow;
  onResolved: () => void;
  t: (key: string) => string;
}) {
  const [busy, setBusy] = useState(false);
  const [resolved, setResolved] = useState<"accepted" | "declined" | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!row.actor_id) return null;

  if (resolved) {
    return (
      <span className="ml-2 text-xs text-zinc-500">
        {resolved === "accepted"
          ? t("follow.requests.accepted")
          : t("follow.requests.declined")}
      </span>
    );
  }

  return (
    <span className="ml-2 inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (busy || !row.actor_id) return;
          setBusy(true);
          setErrorMessage(null);
          const { error } = await acceptFollowRequest(row.actor_id);
          setBusy(false);
          if (error) {
            setErrorMessage(t("follow.requests.actionFailed"));
            return;
          }
          // Either the RPC flipped the row (data=true) or the row was
          // already gone (data=false). Both cases are terminal from
          // the principal's POV — the follow_request notification has
          // been deleted server-side, so refetching will drop it.
          setResolved("accepted");
          void markNotificationRead(row.id);
          onResolved();
        }}
        className="rounded border border-zinc-900 bg-zinc-900 px-2 py-0.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
      >
        {t("follow.requests.accept")}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (busy || !row.actor_id) return;
          setBusy(true);
          setErrorMessage(null);
          const { error } = await declineFollowRequest(row.actor_id);
          setBusy(false);
          if (error) {
            setErrorMessage(t("follow.requests.actionFailed"));
            return;
          }
          setResolved("declined");
          void markNotificationRead(row.id);
          onResolved();
        }}
        className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
      >
        {t("follow.requests.decline")}
      </button>
      {errorMessage && (
        <span className="text-[11px] text-red-600">{errorMessage}</span>
      )}
    </span>
  );
}

function notificationLabel(
  row: NotificationRow,
  t: (k: string) => string,
  entitlements: { canSeeBoardSaver: boolean; canSeeBoardPublicActor: boolean }
): string {
  const name = formatDisplayName(row.actor);
  const title = row.artwork?.title || "Untitled";
  switch (row.type) {
    case "like":
      return t("notifications.likeText").replace("{name}", name).replace("{title}", title);
    case "follow":
      return t("notifications.followText").replace("{name}", name);
    case "claim_request":
      return t("notifications.claimRequestText").replace("{name}", name).replace("{title}", title);
    case "claim_confirmed":
      return t("notifications.claimConfirmedText").replace("{name}", name).replace("{title}", title);
    case "claim_rejected":
      return t("notifications.claimRejectedText").replace("{name}", name).replace("{title}", title);
    case "price_inquiry":
      return t("notifications.priceInquiryText").replace("{name}", name).replace("{title}", title);
    case "price_inquiry_reply":
      return t("notifications.priceInquiryReplyText").replace("{name}", name).replace("{title}", title);
    case "new_work": {
      if (row.payload?.source === "interest") {
        return `New work matching your "${row.payload.interest_type ?? ""}" interest: ${title}`;
      }
      return `${name} uploaded a new work: ${title}`;
    }
    case "connection_message":
      return t("notifications.connectionMessageText").replace("{name}", name);
    case "board_save": {
      // Free tier: anonymized nudge. Paid tier: reveal actor identity.
      const key = entitlements.canSeeBoardSaver
        ? "notifications.boardSaveTextPaid"
        : "notifications.boardSaveText";
      return t(key).replace("{name}", name).replace("{title}", title);
    }
    case "board_public": {
      const shortlistTitle = (row.payload?.shortlist_title as string | undefined) ?? "";
      // Free tier: "a board featuring your work is public" without actor/title.
      // Paid tier: full reveal including board owner name + board title.
      const key = entitlements.canSeeBoardPublicActor
        ? "notifications.boardPublicTextPaid"
        : "notifications.boardPublicText";
      return t(key)
        .replace("{name}", name)
        .replace("{shortlistTitle}", shortlistTitle)
        .replace("{title}", title);
    }
    case "delegation_invite_received": {
      const scope = row.payload?.scope_type as string | undefined;
      const projectTitle = (row.payload?.project_title as string | undefined) ?? "";
      const key =
        scope === "project"
          ? "notifications.delegationInviteReceivedProjectText"
          : "notifications.delegationInviteReceivedText";
      return t(key).replace("{name}", name).replace("{title}", projectTitle);
    }
    case "delegation_accepted":
      return t("notifications.delegationAcceptedText").replace("{name}", name);
    case "delegation_declined":
      return t("notifications.delegationDeclinedText").replace("{name}", name);
    case "delegation_revoked":
      return t("notifications.delegationRevokedText").replace("{name}", name);
    case "delegation_invite_canceled":
      return t("notifications.delegationInviteCanceledText").replace("{name}", name);
    case "delegation_resigned":
      return t("notifications.delegationResignedText").replace("{name}", name);
    case "delegation_permissions_updated": {
      const added = Array.isArray(row.payload?.added) ? (row.payload?.added as string[]) : [];
      const removed = Array.isArray(row.payload?.removed) ? (row.payload?.removed as string[]) : [];
      if (added.length > 0 && removed.length === 0) {
        return t("notifications.delegationPermissionsUpdatedAddedOnlyText")
          .replace("{name}", name)
          .replace("{count}", String(added.length));
      }
      if (removed.length > 0 && added.length === 0) {
        return t("notifications.delegationPermissionsUpdatedRemovedOnlyText")
          .replace("{name}", name)
          .replace("{count}", String(removed.length));
      }
      return t("notifications.delegationPermissionsUpdatedText").replace("{name}", name);
    }
    case "delegation_permission_change_requested":
      return t("notifications.delegationPermissionChangeRequestedText").replace("{name}", name);
    case "delegation_permission_change_dismissed":
      return t("notifications.delegationPermissionChangeDismissedText").replace("{name}", name);
    case "follow_request":
      return t("notifications.followRequest.body").replace("{name}", name);
    case "follow_request_accepted":
      return t("notifications.followRequestAccepted.body").replace("{name}", name);
    default:
      return "";
  }
}

function notificationLink(
  row: NotificationRow,
  entitlements: { canSeeBoardSaver: boolean; canSeeBoardPublicActor: boolean },
  viewerId: string | null
): string | null {
  // A new inquiry only ever notifies the artist / delegates → artist inbox.
  if (row.type === "price_inquiry") {
    return "/my/inquiries";
  }
  // A reply fans out to BOTH the inquirer AND the artist-side recipients
  // (artist + other delegates). Route the artwork's artist to their inbox;
  // everyone else (the inquirer who sent it) to the artwork thread, where
  // their conversation lives. Falls back to the sent inbox if the artwork
  // link is missing.
  if (row.type === "price_inquiry_reply") {
    const artistId = row.artwork?.artist_id ?? null;
    if (viewerId && artistId && viewerId === artistId) return "/my/inquiries";
    if (row.artwork_id) return `/artwork/${row.artwork_id}`;
    return "/my/inquiries/sent";
  }
  if (row.type === "connection_message") {
    return "/my/messages";
  }
  if (
    (row.type === "follow" || row.type === "follow_request_accepted") &&
    row.actor_id
  ) {
    const u = row.actor?.username;
    return u ? `/u/${u}` : null;
  }
  if (row.type === "board_public") {
    // Paid: deep-link to the shareable room. Free: keep them on their own
    // artwork page — the upgrade prompt is the curiosity gap.
    if (entitlements.canSeeBoardPublicActor) {
      const token = row.payload?.share_token as string | undefined;
      if (token) return `/room/${token}`;
    }
    if (row.artwork_id) return `/artwork/${row.artwork_id}`;
    return null;
  }
  if (row.type === "board_save") {
    // Always route to the artist's artwork page. Board is (potentially)
    // private, so we never link to it directly regardless of plan.
    if (row.artwork_id) return `/artwork/${row.artwork_id}`;
    return null;
  }
  if (
    row.type === "delegation_invite_received" ||
    row.type === "delegation_accepted" ||
    row.type === "delegation_declined" ||
    row.type === "delegation_revoked" ||
    row.type === "delegation_invite_canceled" ||
    row.type === "delegation_resigned" ||
    row.type === "delegation_permissions_updated" ||
    row.type === "delegation_permission_change_requested" ||
    row.type === "delegation_permission_change_dismissed"
  ) {
    // Sender-side permission-change requests deep-link to the
    // delegation detail with a query hint so DelegationsList can open
    // the editor pre-filled. Other rows just route to the list page.
    const delegationId = row.payload?.delegation_id as string | undefined;
    if (
      row.type === "delegation_permission_change_requested" &&
      delegationId
    ) {
      return `/my/delegations?openId=${delegationId}&action=update`;
    }
    return "/my/delegations";
  }
  if (row.artwork_id) return `/artwork/${row.artwork_id}`;
  return null;
}

function NotificationsContent() {
  const { t, locale } = useT();
  const [list, setList] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);
  const [viewerId, setViewerId] = useState<string | null>(null);

  // Resolver-backed gates. We skip the quota lookup for these render-path
  // checks because they are cheap boolean gates, not usage-bearing actions.
  const boardSaverAccess = useFeatureAccess("insights.board_saver_identity", {
    skipQuotaCheck: true,
  });
  const boardPublicActorAccess = useFeatureAccess("insights.board_public_actor_details", {
    skipQuotaCheck: true,
  });
  const entitlements = {
    canSeeBoardSaver: boardSaverAccess.decision?.allowed ?? false,
    canSeeBoardPublicActor: boardPublicActorAccess.decision?.allowed ?? false,
  };

  const refresh = useCallback(() => {
    listNotifications({ limit: 50 }).then(({ data }) => {
      setList(data);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    const t = requestAnimationFrame(() => {
      refresh();
    });
    return () => cancelAnimationFrame(t);
  }, [refresh]);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (alive) setViewerId(data.session?.user?.id ?? null);
    });
    return () => {
      alive = false;
    };
  }, []);

  const handleMarkAll = useCallback(async () => {
    setMarkingAll(true);
    await markAllAsRead();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("notifications-read"));
    }
    await refresh();
    setMarkingAll(false);
  }, [refresh]);

  if (loading) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <p className="text-zinc-600">{t("common.loading")}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link
        href="/feed?tab=all&sort=latest"
        className="mb-6 inline-block text-sm text-zinc-600 hover:text-zinc-900"
      >
        ← {backToLabel(t("nav.feed"), locale)}
      </Link>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-zinc-900">{t("notifications.title")}</h1>
        {list.length > 0 && (
          <button
            type="button"
            disabled={markingAll}
            onClick={() => void handleMarkAll()}
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            {markingAll ? t("common.loading") : t("notifications.markAllRead")}
          </button>
        )}
      </div>
      {list.length === 0 ? (
        <EmptyState title={t("notifications.empty")} size="sm" />
      ) : (
        <ul className="mt-4 divide-y divide-zinc-100">
          {list.map((row) => {
            const href = notificationLink(row, entitlements, viewerId);
            const label = notificationLabel(row, t, entitlements);
            const unread = row.read_at == null;
            const isFollowRequest = row.type === "follow_request";
            const inlineControls = isFollowRequest ? (
              <FollowRequestActions
                row={row}
                t={t}
                onResolved={() => {
                  window.dispatchEvent(
                    new CustomEvent("notifications-read")
                  );
                  void refresh();
                }}
              />
            ) : null;
            const content = (
              <span className="block py-3 text-sm text-zinc-700">
                {unread && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-blue-500 align-middle" aria-hidden />}
                {label}
                <span className="ml-2 text-zinc-400">
                  {new Date(row.created_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                {inlineControls}
              </span>
            );
            // Follow requests get inline accept/decline controls and
            // intentionally do NOT wrap the content in a Link — clicks
            // anywhere else on the row would otherwise navigate away
            // before the user could act on the buttons.
            if (isFollowRequest) {
              return (
                <li key={row.id} className="px-1">
                  {content}
                </li>
              );
            }
            return (
              <li key={row.id}>
                {href ? (
                  <Link
                    href={href}
                    className="block hover:bg-zinc-50"
                    onClick={() => {
                      void markNotificationRead(row.id);
                      window.dispatchEvent(new CustomEvent("notifications-read"));
                    }}
                  >
                    {content}
                  </Link>
                ) : (
                  content
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

export default function NotificationsPage() {
  return (
    <AuthGate>
      <NotificationsContent />
    </AuthGate>
  );
}
