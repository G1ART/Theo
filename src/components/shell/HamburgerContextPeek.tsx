"use client";

/**
 * Mobile stand-in for the desktop right rail (My Connection + Theo Board).
 *
 * The feed stays a feed. On phone/tablet the hamburger is the third
 * column: Network and Board as first-class rows, plus one quiet preview
 * line each. Invitation count can badge the hamburger; Board never does.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/useT";
import { formatDisplayName, formatUsername } from "@/lib/identity/format";
import {
  listNotifications,
  type NotificationRow,
} from "@/lib/supabase/notifications";
import { getTheoBoardRail, type TheoBoardPost } from "@/lib/supabase/theoBoard";
import { listMySpaces } from "@/lib/supabase/spaces";

export function useFollowInviteCount(enabled: boolean): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return;
    }
    let cancelled = false;

    async function load() {
      const { data } = await listNotifications({ limit: 30 });
      if (cancelled) return;
      setCount((data ?? []).filter((row) => row.type === "follow_request").length);
    }

    void load();
    const onRead = () => void load();
    window.addEventListener("notifications-read", onRead);
    return () => {
      cancelled = true;
      window.removeEventListener("notifications-read", onRead);
    };
  }, [enabled]);

  return count;
}

type Props = {
  loggedIn: boolean;
  onNavigate: () => void;
};

export function HamburgerContextPeek({ loggedIn, onNavigate }: Props) {
  const { t, locale } = useT();
  const [invite, setInvite] = useState<NotificationRow | null>(null);
  const [inviteCount, setInviteCount] = useState(0);
  const [boardPost, setBoardPost] = useState<TheoBoardPost | null>(null);
  const [spacesCount, setSpacesCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const boardRes = await getTheoBoardRail(1);
      if (!cancelled) setBoardPost(boardRes.data[0] ?? null);

      if (!loggedIn) {
        if (!cancelled) {
          setInvite(null);
          setInviteCount(0);
          setSpacesCount(null);
        }
        return;
      }

      const { data } = await listNotifications({ limit: 30 });
      if (cancelled) return;
      const invites = (data ?? []).filter((row) => row.type === "follow_request");
      setInviteCount(invites.length);
      setInvite(invites[0] ?? null);

      // 2026-08-17 (14) Chunk C — surface a quiet "count of spaces"
      // preview under the sidebar peek. Fails silently on RLS/network
      // hiccups; the row still routes to /my/spaces so a broken
      // preview never becomes a broken link.
      const spaces = await listMySpaces();
      if (cancelled) return;
      setSpacesCount(spaces.data.length);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [loggedIn]);

  const actor = invite?.actor;
  const inviteName =
    formatDisplayName(actor, t, locale) || formatUsername(actor) || "";
  const networkHint = invite
    ? t("nav.peek.networkInvite").replace("{name}", inviteName)
    : t("nav.peek.networkIdle");
  const boardHint = boardPost?.title?.trim() || t("nav.peek.boardIdle");
  const boardHref = boardPost ? `/theo-board/${boardPost.id}` : "/theo-board";
  const spacesHint =
    spacesCount != null && spacesCount > 0
      ? t("nav.peek.spacesActive").replace("{n}", String(spacesCount))
      : t("nav.peek.spacesIdle");

  return (
    <section
      aria-label={t("nav.menu")}
      className="my-2 rounded-2xl border border-zinc-200 bg-zinc-50/80 p-3"
    >
      {loggedIn && (
        <Link
          href="/my/network"
          onClick={onNavigate}
          className="block rounded-xl px-1 py-1.5 hover:bg-white"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-zinc-900">
              {t("nav.network")}
            </span>
            {inviteCount > 0 && (
              <span className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-zinc-900 px-1 text-[10px] font-medium text-white">
                {inviteCount > 99 ? "99+" : inviteCount}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-zinc-500">{networkHint}</p>
        </Link>
      )}

      <Link
        href={boardHref}
        onClick={onNavigate}
        className={`block rounded-xl px-1 py-1.5 hover:bg-white ${loggedIn ? "mt-1" : ""}`}
      >
        <p className="text-sm font-medium text-zinc-900">{t("nav.theoBoard")}</p>
        <p className="mt-0.5 truncate text-xs text-zinc-500">{boardHint}</p>
      </Link>

      {loggedIn && (
        // 2026-08-17 (14) Chunk C — quiet "내 공간" preview beneath
        // Network + Board so mobile users have parity with the
        // desktop sidebar entry (added to PRIMARY_NAV) even at a
        // glance. Route stays the same as the sidebar link.
        <Link
          href="/my/spaces"
          onClick={onNavigate}
          className="mt-1 block rounded-xl px-1 py-1.5 hover:bg-white"
        >
          <p className="text-sm font-medium text-zinc-900">
            {t("sidebar.spaces")}
          </p>
          <p className="mt-0.5 truncate text-xs text-zinc-500">{spacesHint}</p>
        </Link>
      )}
    </section>
  );
}
