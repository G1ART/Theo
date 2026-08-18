"use client";

/**
 * Sprint C.M / 2026-08-03 — Messages inbox redesign.
 *
 * The old inbox rendered one flat list. Designer's ask (see 2026-08-03
 * wireframes, "images 3 & 5"):
 *   1. Three tabs — Primary / General / New Request.
 *   2. Per-row state labels — Received / Opened / Sent / Read.
 *   3. New Request rows carry Decline / Accept buttons before you can
 *      open the thread.
 *
 * Both requirements live in the v2 `list_connection_conversations_v2`
 * RPC (see `20260803120000_connection_message_thread_categorization.sql`);
 * this file just renders whatever the RPC returns. Category & state are
 * source-of-truth server-side so a second tab that opens the thread in
 * another window still updates the label after `markConversationRead`.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { useT } from "@/lib/i18n/useT";
import { formatDisplayName } from "@/lib/identity/format";
import {
  acceptConnectionMessageThread,
  declineConnectionMessageThread,
  listMyConversationsV2,
  type ConnectionThreadCategory,
  type ConnectionThreadState,
  type ConversationSummary,
} from "@/lib/supabase/connectionMessages";
import { getArtworkImageUrl } from "@/lib/supabase/artworks";

const CATEGORY_ORDER: ConnectionThreadCategory[] = [
  "primary",
  "general",
  "request",
];

function parseCategory(raw: string | null): ConnectionThreadCategory {
  switch (raw) {
    case "general":
      return "general";
    case "request":
      return "request";
    default:
      return "primary";
  }
}

function relativeTime(iso: string, locale: "ko" | "en"): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const sec = Math.max(1, Math.floor(diffMs / 1000));
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (locale === "ko") {
    if (sec < 60) return "방금";
    if (min < 60) return `${min}분 전`;
    if (hr < 24) return `${hr}시간 전`;
    if (day < 7) return `${day}일 전`;
    return new Date(iso).toLocaleDateString("ko-KR");
  }
  if (sec < 60) return "just now";
  if (min < 60) return `${min}m ago`;
  if (hr < 24) return `${hr}h ago`;
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString("en-US");
}

function stateToneClass(state: ConnectionThreadState | null): string {
  switch (state) {
    case "received":
      return "text-zinc-900 font-semibold";
    case "opened":
      return "text-zinc-500";
    case "sent":
      return "text-zinc-500 italic";
    case "read":
      return "text-zinc-400 italic";
    default:
      return "text-zinc-400";
  }
}

export default function MyMessagesPage() {
  const { t, locale } = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeCategory = parseCategory(searchParams.get("category"));

  // One page per category — cheap, and lets tab switches paint from
  // cache instead of round-tripping the RPC.
  const [byCategory, setByCategory] = useState<
    Record<ConnectionThreadCategory, ConversationSummary[]>
  >({ primary: [], general: [], request: [] });
  const [cursorByCategory, setCursorByCategory] = useState<
    Record<ConnectionThreadCategory, string | null>
  >({ primary: null, general: null, request: null });
  const [loadedByCategory, setLoadedByCategory] = useState<
    Record<ConnectionThreadCategory, boolean>
  >({ primary: false, general: false, request: false });
  const [loadingCategory, setLoadingCategory] =
    useState<ConnectionThreadCategory | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const setActiveCategory = useCallback(
    (next: ConnectionThreadCategory) => {
      if (next === activeCategory) return;
      const params = new URLSearchParams(searchParams.toString());
      if (next === "primary") params.delete("category");
      else params.set("category", next);
      const qs = params.toString();
      router.replace(qs ? `/my/messages?${qs}` : "/my/messages", {
        scroll: false,
      });
    },
    [activeCategory, router, searchParams],
  );

  const fetchPage = useCallback(
    async (category: ConnectionThreadCategory, cursor?: string | null) => {
      if (cursor) setLoadingMore(true);
      else setLoadingCategory(category);
      const res = await listMyConversationsV2({
        category,
        limit: 20,
        beforeTs: cursor ?? null,
      });
      if (res.error) {
        if (cursor) setLoadingMore(false);
        else setLoadingCategory(null);
        return;
      }
      setByCategory((prev) => ({
        ...prev,
        [category]: cursor ? [...prev[category], ...res.data] : res.data,
      }));
      setCursorByCategory((prev) => ({ ...prev, [category]: res.nextCursor }));
      setLoadedByCategory((prev) => ({ ...prev, [category]: true }));
      if (cursor) setLoadingMore(false);
      else setLoadingCategory(null);
    },
    [],
  );

  // Fetch on tab activation. Same requestAnimationFrame indirection as
  // the v1 page — keeps `react-hooks/set-state-in-effect` happy.
  useEffect(() => {
    if (loadedByCategory[activeCategory]) return;
    const handle = requestAnimationFrame(() => {
      void fetchPage(activeCategory);
    });
    return () => cancelAnimationFrame(handle);
  }, [activeCategory, fetchPage, loadedByCategory]);

  // Preload New Request count so the tab shows an unread hint even
  // when the user hasn't switched tabs yet. Runs once on mount.
  useEffect(() => {
    if (loadedByCategory.request) return;
    const handle = requestAnimationFrame(() => {
      void fetchPage("request");
    });
    return () => cancelAnimationFrame(handle);
  }, [fetchPage, loadedByCategory.request]);

  const rows = byCategory[activeCategory];
  const cursor = cursorByCategory[activeCategory];
  const isLoading = loadingCategory === activeCategory;

  const requestCount = byCategory.request.length;

  const stateLabel = useMemo(
    () => ({
      received: t("messages.state.received"),
      opened: t("messages.state.opened"),
      sent: t("messages.state.sent"),
      read: t("messages.state.read"),
    }),
    [t],
  );

  const handleAccept = useCallback(
    async (conv: ConversationSummary) => {
      setActionError(null);
      setPendingActionId(conv.participantKey);
      const { error } = await acceptConnectionMessageThread(conv.otherUserId);
      setPendingActionId(null);
      if (error) {
        setActionError(t("messages.request.actionFailed"));
        return;
      }
      // Optimistic move-out of the request tab. The server-side category
      // depends on the follow graph, so we can't perfectly predict where
      // the row lands — but we can safely drop it from the request tab
      // here and force a refetch of primary+general on the next visit.
      setByCategory((prev) => ({
        primary: prev.primary,
        general: prev.general,
        request: prev.request.filter(
          (r) => r.participantKey !== conv.participantKey,
        ),
      }));
      setLoadedByCategory((prev) => ({
        ...prev,
        primary: false,
        general: false,
      }));
    },
    [t],
  );

  const handleDecline = useCallback(
    async (conv: ConversationSummary) => {
      setActionError(null);
      setPendingActionId(conv.participantKey);
      const { error } = await declineConnectionMessageThread(conv.otherUserId);
      setPendingActionId(null);
      if (error) {
        setActionError(t("messages.request.actionFailed"));
        return;
      }
      setByCategory((prev) => ({
        ...prev,
        request: prev.request.filter(
          (r) => r.participantKey !== conv.participantKey,
        ),
      }));
    },
    [t],
  );

  return (
    <AuthGate>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <Link
          href="/my"
          className="mb-6 inline-block text-sm text-zinc-600 hover:text-zinc-900"
        >
          ← {t("profile.privateBackToMy")}
        </Link>
        <h1 className="mb-1 text-2xl font-semibold text-zinc-900">
          {t("connection.inbox.title")}
        </h1>

        <nav
          role="tablist"
          aria-label={t("connection.inbox.title")}
          className="mt-6 mb-2 flex items-center gap-6 border-b border-zinc-200 text-sm"
        >
          {CATEGORY_ORDER.map((cat) => {
            const active = cat === activeCategory;
            const label =
              cat === "primary"
                ? t("messages.category.primary")
                : cat === "general"
                  ? t("messages.category.general")
                  : t("messages.category.request");
            const badge =
              cat === "request" && requestCount > 0 ? requestCount : null;
            return (
              <button
                key={cat}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveCategory(cat)}
                className={`-mb-px flex items-center gap-1.5 border-b-2 pb-3 transition-colors ${
                  active
                    ? "border-zinc-900 font-semibold text-zinc-900"
                    : "border-transparent text-zinc-400 hover:text-zinc-700"
                }`}
              >
                <span>{label}</span>
                {badge != null && (
                  <span
                    className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                      active
                        ? "bg-zinc-900 text-white"
                        : "bg-zinc-100 text-zinc-600"
                    }`}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <p className="mb-6 text-xs text-zinc-500">
          {activeCategory === "primary" &&
            t("messages.category.primary.subtitle")}
          {activeCategory === "general" &&
            t("messages.category.general.subtitle")}
          {activeCategory === "request" &&
            t("messages.category.request.subtitle")}
        </p>

        {actionError && (
          <p
            role="alert"
            className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
          >
            {actionError}
          </p>
        )}

        {isLoading ? (
          <p className="text-zinc-500">{t("common.loading")}</p>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/70 p-8 text-center">
            <p className="text-sm text-zinc-600">
              {t("connection.inbox.empty")}
            </p>
            <p className="mt-2 text-xs text-zinc-500">
              {t("connection.inbox.emptyHint")}
            </p>
            <Link
              href="/people"
              className="mt-4 inline-block text-xs font-medium text-zinc-700 underline-offset-2 hover:text-zinc-900 hover:underline"
            >
              {t("connection.inbox.findPeople")} →
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
            {rows.map((c) => {
              const peer = c.otherUser;
              const name =
                (peer && formatDisplayName(peer, t, locale)) ||
                peer?.username ||
                t("connection.inbox.unknownUser");
              const handle = peer?.username ? `@${peer.username}` : null;
              const avatarSrc = peer?.avatar_url
                ? peer.avatar_url.startsWith("http")
                  ? peer.avatar_url
                  : getArtworkImageUrl(peer.avatar_url, "avatar")
                : null;
              const href = peer?.username
                ? `/my/messages/${encodeURIComponent(peer.username)}`
                : `/my/messages/${c.otherUserId}`;
              const preview = c.lastIsFromMe
                ? `${t("connection.inbox.youLabel")} ${c.lastBody}`
                : `${name}: ${c.lastBody}`;
              const stateKey = c.state;
              const stateText = stateKey ? stateLabel[stateKey] : null;
              const isRequestRow = activeCategory === "request";
              const busy = pendingActionId === c.participantKey;

              return (
                <li key={c.participantKey}>
                  <div
                    className={`flex items-start gap-4 px-4 py-4 sm:gap-5 ${
                      isRequestRow ? "" : "hover:bg-zinc-50/60"
                    }`}
                  >
                    <ThreadAvatar
                      src={avatarSrc}
                      fallback={name.charAt(0).toUpperCase()}
                    />
                    <div className="min-w-0 flex-1">
                      {isRequestRow ? (
                        <div className="min-w-0">
                          <div className="flex items-baseline gap-2">
                            {handle && (
                              <span className="truncate text-sm text-zinc-500">
                                {handle}
                              </span>
                            )}
                            <span className="truncate font-medium text-zinc-900">
                              {name}
                            </span>
                          </div>
                          <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-zinc-700">
                            {preview}
                          </p>
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handleDecline(c)}
                                className="rounded-full border border-zinc-300 bg-white px-3.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                              >
                                {t("messages.request.decline")}
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handleAccept(c)}
                                className="rounded-full bg-zinc-900 px-3.5 py-1 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                              >
                                {t("messages.request.accept")}
                              </button>
                            </div>
                            <span className="text-[11px] text-zinc-400">
                              {relativeTime(c.lastCreatedAt, locale as "ko" | "en")}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <Link href={href} className="block">
                          <div className="flex items-baseline gap-2">
                            {handle && (
                              <span className="truncate text-sm text-zinc-500">
                                {handle}
                              </span>
                            )}
                            <span className="truncate font-medium text-zinc-900">
                              {name}
                            </span>
                          </div>
                          <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-zinc-700">
                            {preview}
                          </p>
                          <div className="mt-2 flex items-center justify-end gap-2">
                            {stateText && (
                              <span
                                className={`text-xs ${stateToneClass(stateKey)}`}
                              >
                                {stateText}
                              </span>
                            )}
                            <span className="text-[11px] text-zinc-400">
                              [{relativeTime(c.lastCreatedAt, locale as "ko" | "en")}]
                            </span>
                          </div>
                        </Link>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {cursor && (
          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => fetchPage(activeCategory, cursor)}
              disabled={loadingMore}
              className="rounded border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            >
              {loadingMore
                ? t("common.loading")
                : t("connection.inbox.loadMore")}
            </button>
          </div>
        )}
      </main>
    </AuthGate>
  );
}

function ThreadAvatar({
  src,
  fallback,
}: {
  src: string | null;
  fallback: string;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        className="h-12 w-12 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-base font-medium text-zinc-600">
      {fallback}
    </div>
  );
}
