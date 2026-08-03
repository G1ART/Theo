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
import { EmptyState } from "@/components/ds/EmptyState";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import {
  acceptFollowRequest,
  declineFollowRequest,
} from "@/lib/supabase/follows";
// Shared label/link helpers used by both this page and the sidebar
// NotificationsDrawer — extracted 2026-08-03 (Phase A redesign) so the
// two surfaces cannot drift.
import {
  notificationLabel,
  notificationLink,
} from "@/components/notifications/notificationLink";

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
