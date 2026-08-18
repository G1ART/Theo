"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { MessageComposer } from "@/components/connection/MessageComposer";
import { useT } from "@/lib/i18n/useT";
import { getSession } from "@/lib/supabase/auth";
import {
  acceptConnectionMessageThread,
  listConversationWith,
  markConversationRead,
  type ConnectionMessageRow,
} from "@/lib/supabase/connectionMessages";
import { getArtworkImageUrl } from "@/lib/supabase/artworks";
import {
  getProfileById,
  lookupPublicProfileByUsername,
  type ProfilePublic,
} from "@/lib/supabase/profiles";
import { formatDisplayName } from "@/lib/identity/format";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatTime(iso: string, locale: "ko" | "en"): string {
  const d = new Date(iso);
  if (locale === "ko") {
    return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatDate(iso: string, locale: "ko" | "en"): string {
  const d = new Date(iso);
  if (locale === "ko") {
    return d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
  }
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

type PeerProfile = {
  id: string;
  username: string | null;
  display_name: string | null;
  display_name_ko: string | null;
  display_name_en: string | null;
  avatar_url: string | null;
};

export default function MessageThreadPage() {
  const { t, locale } = useT();
  const params = useParams<{ peer: string }>();
  const router = useRouter();
  const rawPeer = typeof params.peer === "string" ? params.peer : "";

  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [peer, setPeer] = useState<PeerProfile | null>(null);
  const [peerError, setPeerError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConnectionMessageRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void getSession().then(({ data }) =>
      setMyUserId(data.session?.user?.id ?? null),
    );
  }, []);

  // Resolve `peer` → peer profile. The URL key may be a username (pretty
  // form) or a raw uuid (fallback for accounts without usernames).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!rawPeer) {
        setPeerError(t("connection.thread.notFound"));
        return;
      }
      if (UUID_RE.test(rawPeer)) {
        const { data, error } = await getProfileById(rawPeer);
        if (cancelled) return;
        if (error || !data) {
          setPeerError(t("connection.thread.notFound"));
          return;
        }
        setPeer({
          id: data.id,
          username: data.username ?? null,
          display_name: data.display_name ?? null,
          display_name_ko:
            (data as { display_name_ko?: string | null }).display_name_ko ??
            null,
          display_name_en:
            (data as { display_name_en?: string | null }).display_name_en ??
            null,
          avatar_url: data.avatar_url ?? null,
        });
        return;
      }
      const { data, isPrivate, notFound } = await lookupPublicProfileByUsername(rawPeer);
      if (cancelled) return;
      if (notFound) {
        setPeerError(t("connection.thread.notFound"));
        return;
      }
      const source: ProfilePublic | null = data ?? null;
      if (!source && isPrivate) {
        // Private profile: we still allow messaging if the user already
        // shares a thread (message surface was authored by either side).
        // The thread load below resolves actual ids so we can proceed
        // with partial peer metadata.
        setPeer({
          id: "",
          username: rawPeer,
          display_name: null,
          display_name_ko: null,
          display_name_en: null,
          avatar_url: null,
        });
        return;
      }
      if (!source) {
        setPeerError(t("connection.thread.notFound"));
        return;
      }
      setPeer({
        id: source.id,
        username: source.username ?? null,
        display_name: source.display_name ?? null,
        display_name_ko: source.display_name_ko ?? null,
        display_name_en: source.display_name_en ?? null,
        avatar_url: source.avatar_url ?? null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [rawPeer, t]);

  const peerId = peer?.id ?? null;

  const loadInitial = useCallback(async () => {
    if (!peerId) return;
    setLoading(true);
    // Sprint C.M / 2026-08-03 — opening the thread page implicitly
    // accepts a pending `request`. The RPC is idempotent + no-ops for
    // already-accepted threads, so we can fire it unconditionally
    // alongside the read-mark. Category flips server-side (primary or
    // general based on mutual-follow state).
    const [thread] = await Promise.all([
      listConversationWith(peerId, { limit: 40 }),
      markConversationRead(peerId),
      acceptConnectionMessageThread(peerId).catch(() => ({ error: null })),
    ]);
    if (thread.error) {
      setLoading(false);
      return;
    }
    setMessages(thread.data);
    setNextCursor(thread.nextCursor);
    setLoading(false);
  }, [peerId]);

  useEffect(() => {
    if (!peerId) return;
    // Defer the initial fetch so the setState cascade inside
    // `loadInitial` doesn't fire synchronously from an effect body
    // (react-hooks/set-state-in-effect).
    const handle = requestAnimationFrame(() => {
      void loadInitial();
    });
    return () => cancelAnimationFrame(handle);
  }, [peerId, loadInitial]);

  // Keep the bottom of the thread in view whenever a new message lands.
  useEffect(() => {
    if (!loading && messages.length > 0) {
      scrollAnchorRef.current?.scrollIntoView({ block: "end", behavior: "auto" });
    }
  }, [loading, messages.length]);

  const handleLoadOlder = useCallback(async () => {
    if (!peerId || !nextCursor) return;
    setLoadingMore(true);
    const res = await listConversationWith(peerId, {
      limit: 40,
      beforeTs: nextCursor,
    });
    setLoadingMore(false);
    if (res.error) return;
    setMessages((prev) => [...res.data, ...prev]);
    setNextCursor(res.nextCursor);
  }, [peerId, nextCursor]);

  const handleSent = useCallback(
    ({ messageId, body }: { messageId: string; body: string }) => {
      if (!myUserId || !peerId) return;
      const now = new Date().toISOString();
      const optimistic: ConnectionMessageRow = {
        id: messageId,
        sender_id: myUserId,
        recipient_id: peerId,
        body,
        read_at: null,
        created_at: now,
        sender: null,
      };
      setMessages((prev) => [...prev, optimistic]);
    },
    [myUserId, peerId],
  );

  const peerName = useMemo(() => {
    if (!peer) return t("connection.inbox.unknownUser");
    const localized = formatDisplayName(peer, t, locale);
    if (localized) return localized;
    return peer.display_name ?? peer.username ?? t("connection.inbox.unknownUser");
  }, [peer, t, locale]);

  const peerAvatarSrc = peer?.avatar_url
    ? peer.avatar_url.startsWith("http")
      ? peer.avatar_url
      : getArtworkImageUrl(peer.avatar_url, "avatar")
    : null;

  // Insert day-dividers in the bubble list so long threads remain
  // navigable without a dedicated timeline UI.
  const renderable = useMemo(() => {
    const out: Array<
      | { kind: "divider"; key: string; label: string }
      | { kind: "bubble"; key: string; msg: ConnectionMessageRow; mine: boolean }
    > = [];
    let lastDay = "";
    for (const m of messages) {
      const dayKey = m.created_at.slice(0, 10);
      if (dayKey !== lastDay) {
        out.push({
          kind: "divider",
          key: `d-${dayKey}`,
          label: formatDate(m.created_at, locale as "ko" | "en"),
        });
        lastDay = dayKey;
      }
      out.push({
        kind: "bubble",
        key: m.id,
        msg: m,
        mine: m.sender_id === myUserId,
      });
    }
    return out;
  }, [messages, myUserId, locale]);

  if (peerError) {
    return (
      <AuthGate>
        <main className="mx-auto max-w-2xl px-4 py-8">
          <Link
            href="/my/messages"
            className="mb-6 inline-block text-sm text-zinc-600 hover:text-zinc-900"
          >
            ← {t("connection.thread.backToInbox")}
          </Link>
          <p className="text-zinc-600">{peerError}</p>
        </main>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <main className="mx-auto flex h-[calc(100vh-4rem)] max-w-2xl flex-col px-4 py-6">
        <Link
          href="/my/messages"
          className="mb-4 inline-block text-sm text-zinc-600 hover:text-zinc-900"
        >
          ← {t("connection.thread.backToInbox")}
        </Link>

        <header className="mb-4 flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3">
          {peerAvatarSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={peerAvatarSrc}
              alt=""
              className="h-10 w-10 shrink-0 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-base font-medium text-zinc-600">
              {peerName.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-zinc-900">{peerName}</p>
            {peer?.username && (
              <p className="truncate text-xs text-zinc-500">@{peer.username}</p>
            )}
          </div>
          {peer?.username && (
            <button
              type="button"
              onClick={() => router.push(`/u/${peer.username}`)}
              className="shrink-0 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-300"
            >
              {t("connection.thread.viewProfile")}
            </button>
          )}
        </header>

        <section className="flex-1 overflow-y-auto rounded-xl border border-zinc-200 bg-zinc-50/70 p-4">
          {nextCursor && (
            <div className="mb-3 flex justify-center">
              <button
                type="button"
                onClick={handleLoadOlder}
                disabled={loadingMore}
                className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-[11px] font-medium text-zinc-600 hover:border-zinc-300 disabled:opacity-50"
              >
                {loadingMore
                  ? t("common.loading")
                  : t("connection.thread.loadOlder")}
              </button>
            </div>
          )}

          {loading ? (
            <p className="text-center text-sm text-zinc-500">{t("common.loading")}</p>
          ) : renderable.length === 0 ? (
            <p className="text-center text-sm text-zinc-500">
              {t("connection.thread.empty")}
            </p>
          ) : (
            <ul className="space-y-2">
              {renderable.map((item) => {
                if (item.kind === "divider") {
                  return (
                    <li
                      key={item.key}
                      className="my-3 flex items-center justify-center gap-2 text-[10px] uppercase tracking-wide text-zinc-400"
                    >
                      <span className="h-px flex-1 bg-zinc-200" />
                      <span>{item.label}</span>
                      <span className="h-px flex-1 bg-zinc-200" />
                    </li>
                  );
                }
                const { msg, mine } = item;
                return (
                  <li
                    key={item.key}
                    className={[
                      "flex",
                      mine ? "justify-end" : "justify-start",
                    ].join(" ")}
                  >
                    <div
                      className={[
                        "max-w-[78%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap shadow-sm",
                        mine
                          ? "bg-zinc-900 text-white"
                          : "bg-white text-zinc-800 border border-zinc-200",
                      ].join(" ")}
                    >
                      <p>{msg.body}</p>
                      <p
                        className={[
                          "mt-1 text-[10px]",
                          mine ? "text-zinc-300" : "text-zinc-400",
                        ].join(" ")}
                      >
                        {formatTime(msg.created_at, locale as "ko" | "en")}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div ref={scrollAnchorRef} />
        </section>

        {peerId && (
          <div className="mt-3">
            <MessageComposer
              recipientId={peerId}
              recipientLabel={peerName}
              onSent={handleSent}
              variant="inline"
            />
          </div>
        )}
      </main>
    </AuthGate>
  );
}
