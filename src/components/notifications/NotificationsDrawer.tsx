"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import {
  listNotifications,
  markAllAsRead,
  markNotificationRead,
  type NotificationRow,
} from "@/lib/supabase/notifications";
import { useT } from "@/lib/i18n/useT";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import {
  notificationLabel,
  notificationLink,
} from "./notificationLink";
import { stampBackFromHref } from "@/lib/artworkBack";

/**
 * Sidebar-side notifications popover (Aug-2026 redesign).
 *
 * Behaviour rules distilled from the wireframe:
 *   • Slides in from the LEFT sidebar (right of the nav column), does
 *     NOT dim the page or block clicks on the rest of the layout —
 *     users close it via the X, ESC, or by clicking anywhere outside.
 *   • Reuses the SAME `notificationLink` / `notificationLabel`
 *     resolvers as `/notifications` so the two surfaces never drift.
 *   • On open, marks all unread as read (parity with the page) and
 *     dispatches `notifications-read` so the sidebar/header badges
 *     zero out immediately.
 *   • Footer "See all" routes to the full `/notifications` page for
 *     history + follow-request inline actions (kept on the page only
 *     to preserve the tap-target-heavy accept/decline UI).
 */
export function NotificationsDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useT();
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewerId, setViewerId] = useState<string | null>(null);

  const boardSaverAccess = useFeatureAccess("insights.board_saver_identity", {
    skipQuotaCheck: true,
  });
  const boardPublicActorAccess = useFeatureAccess(
    "insights.board_public_actor_details",
    { skipQuotaCheck: true }
  );
  const entitlements = {
    canSeeBoardSaver: boardSaverAccess.decision?.allowed ?? false,
    canSeeBoardPublicActor: boardPublicActorAccess.decision?.allowed ?? false,
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data } = await listNotifications({ limit: 20 });
    setRows(data);
    setLoading(false);
  }, []);

  // Viewer id resolves once — used only for `notificationLink` role
  // routing (artist vs. inquirer inbox). Refetched on auth changes.
  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (alive) setViewerId(data.session?.user?.id ?? null);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Fetch + mark-read when the drawer opens. Matches the /notifications
  // page semantics: opening the surface = you've "seen" the pending
  // items, even before you tap into any of them. React 19 flags the
  // downstream setLoading/setRows as set-state-in-effect; the pattern
  // is deliberate (show a skeleton on open) and mirrors the page.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    void markAllAsRead().then(() => {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("notifications-read"));
      }
    });
  }, [open, refresh]);

  // ESC to close — matches expected drawer semantics without stealing
  // focus from the main column.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Transparent outside-click catcher. The wireframe intentionally
          has no backdrop dim — the page stays legible — but we still
          need a full-viewport hit target so clicks outside the drawer
          close it. `pointer-events-auto` on the catcher + on the panel
          gives us clean event ordering without a portal. */}
      <div
        aria-hidden
        className="fixed inset-0 z-40 bg-transparent"
        onMouseDown={onClose}
      />
      <aside
        role="dialog"
        aria-modal="false"
        aria-label={t("notifications.drawer.title")}
        // Position: right of the desktop sidebar (~w-52 = 208px + a
        // margin). On smaller viewports below `lg`, the AppSidebar is
        // hidden anyway; if the drawer ever opens there (mobile
        // avatar dropdown routes to the page instead so this is rare)
        // it falls back to left:4.
        className="fixed left-4 top-4 z-50 flex h-[calc(100vh-2rem)] w-[340px] flex-col rounded-2xl border border-zinc-200 bg-white shadow-xl lg:left-[228px]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900">
            {t("notifications.drawer.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("notifications.drawer.close")}
            className="rounded-full p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {loading && rows.length === 0 ? (
            <p className="px-3 py-6 text-sm text-zinc-500">
              {t("common.loading")}
            </p>
          ) : rows.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-zinc-500">
              {t("notifications.drawer.empty")}
            </p>
          ) : (
            <ul className="flex flex-col">
              {rows.map((row) => {
                const href = notificationLink(row, entitlements, viewerId);
                const label = notificationLabel(row, t, entitlements);
                const unread = row.read_at == null;
                const item = (
                  <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-zinc-50">
                    {/* Circular badge — matches the wireframe's grey
                        avatar disc. We don't yet fetch actor avatars
                        here (would triple the payload); a monochrome
                        placeholder reads as intended in the wireframe. */}
                    <span
                      aria-hidden
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs text-zinc-400"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="9" r="3.5" stroke="currentColor" strokeWidth="1.5" />
                        <path
                          d="M5 20c1.5-3.5 4.5-5 7-5s5.5 1.5 7 5"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        />
                      </svg>
                    </span>
                    <span
                      className={`min-w-0 flex-1 truncate text-sm ${
                        unread ? "font-medium text-zinc-900" : "text-zinc-600"
                      }`}
                    >
                      {label}
                    </span>
                    <span className="shrink-0 text-xs text-zinc-500">
                      {t("notifications.drawer.action.go")} ›
                    </span>
                  </div>
                );

                // Follow-request rows have inline accept/decline
                // controls that only exist on the full page. Keep the
                // drawer entry as a plain link to that page so the
                // action surface is unambiguous.
                if (!href || row.type === "follow_request") {
                  return (
                    <li key={row.id}>
                      <Link
                        href="/notifications"
                        onClick={onClose}
                        className="block"
                      >
                        {item}
                      </Link>
                    </li>
                  );
                }
                return (
                  <li key={row.id}>
                    <Link
                      href={href}
                      onClick={() => {
                        stampBackFromHref(href);
                        void markNotificationRead(row.id);
                        onClose();
                      }}
                      className="block"
                    >
                      {item}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="border-t border-zinc-100 px-5 py-3">
          <Link
            href="/notifications"
            onClick={onClose}
            className="inline-flex items-center gap-1 text-sm font-medium text-zinc-700 hover:text-zinc-900"
          >
            {t("notifications.drawer.seeAll")} →
          </Link>
        </footer>
      </aside>
    </>
  );
}
