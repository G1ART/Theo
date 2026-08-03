"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/useT";
import { supabase } from "@/lib/supabase/client";
import {
  listNotifications,
  markNotificationRead,
  type NotificationRow,
} from "@/lib/supabase/notifications";
import {
  acceptFollowRequest,
  declineFollowRequest,
} from "@/lib/supabase/follows";
import { getPeopleRecommendations } from "@/lib/supabase/recommendations";
import type { PeopleRec } from "@/lib/supabase/peopleRecs";
import { getArtworkImageUrl } from "@/lib/supabase/artworks";
import { formatDisplayName, formatUsername } from "@/lib/identity/format";

/**
 * Right-rail widget — "My Connection" (Aug-2026 wireframe redesign).
 *
 * Two compact sections stacked in one card:
 *
 *   1. Invitations — top 2 pending follow-request notifications. Each
 *      row has inline `decline / accept` buttons that call the same
 *      RPCs the /notifications page uses (`accept_follow_request` /
 *      `decline_follow_request`), then optimistically removes the row.
 *   2. Suggestions — top 2 recs from `getPeopleRecommendations` with
 *      the `follow_graph` lane (parity with the /people default).
 *
 * The header carries a top-of-column search bar that submits to
 * `/people?q=...`, matching the wireframe. "more >" routes to
 * `/my/network` — the single unified relationships hub.
 *
 * All fetches are self-contained (`use client` + `useEffect`); rail
 * data must never depend on main-column state or we'd reintroduce the
 * per-page rail coupling we deliberately removed.
 */
export function MyConnectionRail() {
  const { t } = useT();
  const router = useRouter();
  const [q, setQ] = useState("");

  const [invitations, setInvitations] = useState<NotificationRow[] | null>(null);
  const [suggestions, setSuggestions] = useState<PeopleRec[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        if (!cancelled) {
          setInvitations([]);
          setSuggestions([]);
        }
        return;
      }

      // Follow-request invitations — filtered client-side from the
      // notifications feed to avoid a second RPC. Cap to top 2 to
      // preserve the wireframe's compact layout; deeper triage
      // happens on `/notifications`.
      const [notifRes, recRes] = await Promise.all([
        listNotifications({ limit: 30 }),
        getPeopleRecommendations({ lane: "follow_graph", limit: 6 }),
      ]);

      if (cancelled) return;
      const invites = (notifRes.data ?? []).filter(
        (r) => r.type === "follow_request"
      );
      setInvitations(invites.slice(0, 2));
      setSuggestions((recRes.data ?? []).slice(0, 2));
    }

    void load();
    const onRead = () => void load();
    window.addEventListener("notifications-read", onRead);
    return () => {
      cancelled = true;
      window.removeEventListener("notifications-read", onRead);
    };
  }, []);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const query = q.trim();
    router.push(query ? `/people?q=${encodeURIComponent(query)}` : "/people");
  }

  async function handleAccept(row: NotificationRow) {
    if (!row.actor_id) return;
    setInvitations((prev) => (prev ?? []).filter((r) => r.id !== row.id));
    await acceptFollowRequest(row.actor_id);
    void markNotificationRead(row.id);
    window.dispatchEvent(new CustomEvent("notifications-read"));
  }
  async function handleDecline(row: NotificationRow) {
    if (!row.actor_id) return;
    setInvitations((prev) => (prev ?? []).filter((r) => r.id !== row.id));
    await declineFollowRequest(row.actor_id);
    void markNotificationRead(row.id);
    window.dispatchEvent(new CustomEvent("notifications-read"));
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={submitSearch} className="relative">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("rail.myConnection.searchPlaceholder")}
          aria-label={t("rail.myConnection.searchPlaceholder")}
          className="w-full rounded-full border border-zinc-300 bg-white py-2 pl-4 pr-10 text-sm text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none"
        />
        <button
          type="submit"
          aria-label={t("shell.searchSubmit")}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-zinc-500 hover:text-zinc-900"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </form>

      <section aria-label={t("rail.myConnection.title")}>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-zinc-900">
            {t("rail.myConnection.title")}
          </h2>
          <Link
            href="/my/network"
            className="text-xs text-zinc-500 hover:text-zinc-900"
          >
            {t("rail.myConnection.more")} ›
          </Link>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-3">
          {/* Invitations */}
          <div>
            <p className="text-xs font-medium text-zinc-500">
              {t("rail.myConnection.invitations")}
            </p>
            <ul className="mt-2 flex flex-col gap-2">
              {invitations === null ? (
                <li className="h-8 animate-pulse rounded bg-zinc-50" />
              ) : invitations.length === 0 ? (
                <li className="py-1 text-xs text-zinc-400">
                  {t("rail.myConnection.invitationsEmpty")}
                </li>
              ) : (
                invitations.map((row) => (
                  <InvitationRow
                    key={row.id}
                    row={row}
                    onAccept={() => void handleAccept(row)}
                    onDecline={() => void handleDecline(row)}
                    acceptLabel={t("rail.myConnection.accept")}
                    declineLabel={t("rail.myConnection.decline")}
                  />
                ))
              )}
            </ul>
          </div>

          {/* Suggestions — 2 cards, side by side. */}
          <div className="mt-4">
            <p className="text-xs font-medium text-zinc-500">
              {t("rail.myConnection.suggestions")}
            </p>
            {suggestions === null ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className="h-24 animate-pulse rounded bg-zinc-50" />
                <div className="h-24 animate-pulse rounded bg-zinc-50" />
              </div>
            ) : suggestions.length === 0 ? (
              <p className="mt-2 text-xs text-zinc-400">
                {t("rail.myConnection.suggestionsEmpty")}
              </p>
            ) : (
              <div className="mt-2 grid grid-cols-2 gap-2">
                {suggestions.map((p) => (
                  <SuggestionCard key={p.id} person={p} />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function InvitationRow({
  row,
  onAccept,
  onDecline,
  acceptLabel,
  declineLabel,
}: {
  row: NotificationRow;
  onAccept: () => void;
  onDecline: () => void;
  acceptLabel: string;
  declineLabel: string;
}) {
  const actor = row.actor;
  const name = formatDisplayName(actor) || formatUsername(actor);
  const handle = actor?.username ? `@${actor.username}` : "";
  return (
    <li className="flex items-center gap-2">
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-200 bg-zinc-100 text-[10px] font-medium text-zinc-500">
        {actor?.username ? actor.username.charAt(0).toUpperCase() : "?"}
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-xs font-medium text-zinc-800">
          {name || handle || "—"}
        </p>
        {handle && (
          <p className="truncate text-[11px] text-zinc-500">{handle}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onDecline}
          className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50"
        >
          {declineLabel}
        </button>
        <button
          type="button"
          onClick={onAccept}
          className="rounded border border-zinc-900 bg-zinc-900 px-1.5 py-0.5 text-[11px] font-medium text-white hover:bg-zinc-800"
        >
          {acceptLabel}
        </button>
      </div>
    </li>
  );
}

function SuggestionCard({ person }: { person: PeopleRec }) {
  const href = person.username ? `/u/${person.username}` : "#";
  const name = formatDisplayName(person) || formatUsername(person);
  const handle = person.username ? `@${person.username}` : "";
  const role = person.main_role ?? null;
  const avatar = person.avatar_url
    ? person.avatar_url.startsWith("http")
      ? person.avatar_url
      : getArtworkImageUrl(person.avatar_url, "avatar")
    : null;
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 rounded-md border border-zinc-200 bg-white p-2 hover:border-zinc-400"
    >
      <span className="inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-zinc-200 bg-zinc-100 text-[10px] font-medium text-zinc-500">
        {avatar ? (
          <Image
            src={avatar}
            alt=""
            width={32}
            height={32}
            className="h-full w-full object-cover"
          />
        ) : (
          <span>{person.username?.charAt(0).toUpperCase() ?? "?"}</span>
        )}
      </span>
      <p className="truncate text-xs font-medium text-zinc-800">
        {name || handle || "—"}
      </p>
      {handle && (
        <p className="truncate text-[11px] text-zinc-500">{handle}</p>
      )}
      {role && (
        <p className="truncate text-[11px] text-zinc-400">{role}</p>
      )}
    </Link>
  );
}
