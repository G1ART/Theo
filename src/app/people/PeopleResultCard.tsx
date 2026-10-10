"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/useT";
import { Chip } from "@/components/ds/Chip";
import { FollowButton } from "@/components/FollowButton";
import { IntroMessageAssist } from "@/components/ai/IntroMessageAssist";
import { getArtworkImageUrl } from "@/lib/supabase/artworks";
import {
  formatIdentityPair,
  formatRoleChips,
} from "@/lib/identity/format";
import type { PeopleRec } from "@/lib/supabase/peopleRecs";

/**
 * People recommendation / search result card.
 *
 * Earlier the card was an `<article role="button">` with nested
 * `<button>` children — a screen-reader hazard (button-in-button)
 * and a Pinterest-style "click anywhere" pattern that conflicted
 * with the interior Follow / Intro / Dismiss controls. This
 * rewrite splits the card into two clean affordance regions:
 *
 *   1. The avatar + name + bio + role + reason area is a single
 *      `<Link>` covering the visible card surface. Keyboard
 *      navigation lands on it once and Enter takes you to the
 *      profile.
 *   2. Action buttons (Follow / Dismiss menu) live OUTSIDE the
 *      Link with their own focusable elements, in a flex column
 *      to the right. No nested `<button>` hazard.
 *
 * Additional details added in P2:
 *   - Activity dot (S2): small green dot on the avatar when the
 *     profile is `is_recently_active`.
 *   - Dismiss menu (S3): small kebab button → snooze / block.
 */

export type PeopleResultCardProps = {
  profile: PeopleRec;
  initialFollowing: boolean;
  isSelf: boolean;
  isFirstVisibleCard: boolean;
  // Reason copy for the recommendation lane (search mode passes null).
  reasonLine: string | null;
  badge: string | null;
  // P2 — dismiss handler. When provided, kebab menu is rendered.
  onDismiss?: (mode: "snooze" | "block") => void;
  // P2 — follow undo handler. When provided, FollowButton's
  // onFollowed bubbles up so the parent can show a toast.
  onFollowed?: (status: "accepted" | "pending") => void;
  // Caller-provided "me" snippet for IntroMessageAssist.
  me: {
    display_name: string | null;
    main_role: string | null;
    themes: string[];
    mediums: string[];
    city: string | null;
  } | null;
  userId: string | null;
  // Per-profile counter used as IntroMessageAssist's `openSignal`.
  introOpenSignal: number | undefined;
  setIntroOpenSignal: () => void;
};

export function PeopleResultCard({
  profile,
  initialFollowing,
  isSelf,
  isFirstVisibleCard,
  reasonLine,
  badge,
  onDismiss,
  onFollowed,
  me,
  userId,
  introOpenSignal,
  setIntroOpenSignal,
}: PeopleResultCardProps) {
  const { t, locale } = useT();
  const username = profile.username ?? "";
  const isPrivateTarget = profile.is_public === false;
  const identity = formatIdentityPair(profile, t, locale);
  const roleChips = formatRoleChips(profile, t, { max: 3 });
  const isRecentlyActive = profile.is_recently_active === true;
  const avatarUrl = profile.avatar_url
    ? profile.avatar_url.startsWith("http")
      ? profile.avatar_url
      : getArtworkImageUrl(profile.avatar_url, "avatar")
    : null;

  return (
    <article
      data-people-card
      tabIndex={-1}
      className="group relative flex items-start gap-4 rounded-2xl border border-zinc-200 bg-white p-5 transition-colors hover:bg-zinc-50/70 focus-within:ring-1 focus-within:ring-zinc-300 focus-within:ring-offset-2 focus-within:ring-offset-white"
    >
      <Link
        href={`/u/${username}`}
        className="flex min-w-0 flex-1 items-start gap-4 rounded-xl focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
      >
        <div className="relative h-14 w-14 shrink-0">
          <div className="h-14 w-14 overflow-hidden rounded-full bg-zinc-100">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-lg font-medium text-zinc-500">
                {identity.primary.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          {isRecentlyActive && (
            <span
              aria-label={t("people.signal.recentlyActive")}
              title={t("people.signal.recentlyActive")}
              className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[15px] font-semibold tracking-tight text-zinc-900">
            <span className="truncate">{identity.primary}</span>
            {identity.secondary && (
              <span className="text-sm font-normal text-zinc-500">
                {identity.secondary}
              </span>
            )}
            {isPrivateTarget ? (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-zinc-300 bg-zinc-50 px-2 py-0.5 text-[10px] font-medium text-zinc-600"
                title={t("profile.private.lockBadge")}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="h-3 w-3"
                  aria-hidden="true"
                >
                  <rect x="5" y="11" width="14" height="9" rx="2" />
                  <path d="M8 11V8a4 4 0 1 1 8 0v3" />
                </svg>
                {t("profile.private.lockBadge")}
              </span>
            ) : null}
          </p>
          {profile.bio && (
            <p className="mt-1 line-clamp-2 whitespace-pre-line text-sm text-zinc-600">
              {profile.bio}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-1">
            {roleChips.map((chip) => (
              <Chip key={chip.key} tone={chip.isPrimary ? "accent" : "neutral"}>
                {chip.label}
              </Chip>
            ))}
          </div>
          {reasonLine && (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <MutualAvatarStack sources={profile.mutual_avatars ?? []} />
              <span>{reasonLine}</span>
              {badge && <Chip tone="muted">{badge}</Chip>}
            </p>
          )}
        </div>
      </Link>

      {/* Action column — outside the Link so it does not nest
          interactive elements. */}
      {!isSelf && (
        <div
          data-tour={isFirstVisibleCard ? "people-card-actions" : undefined}
          className="flex shrink-0 flex-col items-end gap-2"
        >
          {onDismiss && <DismissMenu onDismiss={onDismiss} />}
          <FollowButton
            targetProfileId={profile.id}
            initialFollowing={initialFollowing}
            isPrivateTarget={isPrivateTarget}
            size="sm"
            onFollowed={
              onFollowed
                ? () => onFollowed(isPrivateTarget ? "pending" : "accepted")
                : undefined
            }
            interceptFollow={
              isPrivateTarget
                ? undefined
                : () => {
                    // Intro sheet acts as the review surface — it
                    // commits the follow itself via handleSend /
                    // handleFollowOnly. We just bump the per-profile
                    // counter so the matching IntroMessageAssist
                    // opens.
                    setIntroOpenSignal();
                  }
            }
          />
          {userId && !isPrivateTarget && (
            <IntroMessageAssist
              me={{
                display_name: me?.display_name ?? null,
                role: me?.main_role ?? null,
                themes: me?.themes ?? [],
                mediums: me?.mediums ?? [],
                city: me?.city ?? null,
              }}
              recipient={{
                id: profile.id,
                display_name: profile.display_name,
                role: profile.main_role,
                sharedSignals: profile.reason_tags ?? [],
              }}
              recipientId={profile.id}
              isFollowing={initialFollowing}
              openSignal={introOpenSignal}
              onFollowed={
                onFollowed ? () => onFollowed("accepted") : undefined
              }
            />
          )}
        </div>
      )}
    </article>
  );
}

function MutualAvatarStack({
  sources,
}: {
  sources: Array<{
    id: string;
    avatar_url: string | null;
    display_name: string | null;
    username: string | null;
  }>;
}) {
  if (!sources || sources.length === 0) return null;
  const visible = sources.slice(0, 3);
  return (
    <span aria-hidden="true" className="inline-flex -space-x-1.5">
      {visible.map((s) => {
        const url = !s.avatar_url
          ? null
          : s.avatar_url.startsWith("http")
            ? s.avatar_url
            : getArtworkImageUrl(s.avatar_url, "avatar");
        const initial = (s.display_name ?? s.username ?? "·")
          .charAt(0)
          .toUpperCase();
        return (
          <span
            key={s.id}
            className="inline-flex h-5 w-5 items-center justify-center overflow-hidden rounded-full border border-white bg-zinc-100 text-[9px] font-medium text-zinc-500"
          >
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt="" className="h-full w-full object-cover" />
            ) : (
              <span>{initial}</span>
            )}
          </span>
        );
      })}
    </span>
  );
}

/**
 * Per-card kebab menu — "Hide for 30 days" / "Don't suggest again".
 * Sits in the action column, opens a small popover on click. Closes
 * on outside click / Escape. Both options call back to the parent
 * with the chosen mode; the parent is responsible for the optimistic
 * UI and the toast with undo.
 */
function DismissMenu({
  onDismiss,
}: {
  onDismiss: (mode: "snooze" | "block") => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={t("people.dismiss.menuLabel")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-300"
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          className="h-4 w-4"
          aria-hidden
        >
          <circle cx="5" cy="12" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="19" cy="12" r="1.5" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-9 z-10 min-w-[176px] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onDismiss("snooze");
            }}
            className="block w-full px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
          >
            {t("people.dismiss.snooze")}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onDismiss("block");
            }}
            className="block w-full px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
          >
            {t("people.dismiss.block")}
          </button>
        </div>
      )}
    </div>
  );
}
