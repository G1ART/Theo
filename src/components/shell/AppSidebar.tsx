"use client";

import Link from "next/link";
import { TheoLogo } from "@/components/brand/TheoLogo";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { signOut } from "@/lib/supabase/auth";
import { getMyProfile } from "@/lib/supabase/profiles";
import { getUnreadCount } from "@/lib/supabase/notifications";
import { useT } from "@/lib/i18n/useT";
import { useActingAs } from "@/context/ActingAsContext";
import { isPlaceholderUsername } from "@/lib/identity/placeholder";
import {
  listMyDelegations,
  type DelegationWithDetails,
} from "@/lib/supabase/delegations";
import { formatDisplayName, formatUsername } from "@/lib/identity/format";
import { getArtworkImageUrl } from "@/lib/supabase/artworks";

/**
 * Desktop-only left navigation for the Theo AppShell (Aug-2026 redesign).
 *
 * Wireframe reference (see `/assets/KakaoTalk_Photo_2026-08-03-*.png`):
 *
 *   [Theo logo (arch + wordmark)]
 *
 *   Explore       → /feed
 *   Messages      → /my/messages
 *   Workspace     → /my                 (backend hub: drafts / inquiries / ownership / exhibitions / provenance)
 *   Saved         → /my/shortlists
 *   Upload        → /upload
 *
 *   ─ (spacer) ─
 *
 *   Notifications → button opens NotificationsDrawer (popover)
 *   Setting       → /settings
 *   Delegations   → /my/delegations
 *   Switch Account → clickable self-row leads to /u/{username} (public profile),
 *                    followed by received account-delegations
 *   Log out
 *
 * Public profile entry (QA 2026-08-04): earlier drafts explored adding a
 * dedicated "My Studio" primary nav row, but the final wireframe
 * intentionally routes the public-profile entry through the Switch
 * Account block's self-row (a classic social-app avatar-to-profile
 * pattern). To improve discoverability without deviating from the
 * wireframe, the self-row now surfaces a secondary "View my public
 * profile →" affordance (`nav.viewMyPublicProfile`) below the
 * display name.
 *
 * The active item is rendered with bold weight + a thin 2px vertical
 * accent on the left. The mobile chrome still uses the top Header +
 * hamburger, so this component is rendered only inside the desktop
 * AppShell slot (`hidden lg:flex`).
 */

type NavItem = {
  key: string;
  href: string;
  match: (p: string) => boolean;
  /** Optional numeric badge (e.g. delegation pending count). */
  badge?: number;
};

export function AppSidebar({
  onOpenNotifications,
}: {
  /** Fires when the user clicks the "Notifications" nav item.
   *  The AppShell owns the drawer's open state so it can render
   *  outside this rail's clipping context. */
  onOpenNotifications: () => void;
}) {
  const { t, locale, setLocale } = useT();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const {
    actingAsProfileId,
    actingAsLabel,
    setActingAs,
    clearActingAs,
  } = useActingAs();

  const [session, setSession] = useState<Session | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [accounts, setAccounts] = useState<DelegationWithDetails[]>([]);
  const [pendingDelegations, setPendingDelegations] = useState(0);
  const inflight = useRef(false);

  const loggedIn = !!session;
  const isPlaceholder = isPlaceholderUsername(username);
  const profileHref =
    !username || isPlaceholder ? "/onboarding/identity" : `/u/${username}`;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user?.id) {
      // React 19's set-state-in-effect rule flags this, but resetting
      // local mirrors of an auth-driven store when the store empties
      // is exactly the recommended pattern (Header.tsx does the same).
      /* eslint-disable react-hooks/set-state-in-effect */
      setUsername(null);
      setDisplayName(null);
      setAvatarUrl(null);
      setUnread(0);
      setAccounts([]);
      setPendingDelegations(0);
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }
    let cancelled = false;
    const load = () => {
      getMyProfile().then(({ data }) => {
        if (cancelled) return;
        const p = data as {
          username?: string | null;
          display_name?: string | null;
          avatar_url?: string | null;
        } | null;
        setUsername(p?.username ?? null);
        setDisplayName(p?.display_name ?? null);
        setAvatarUrl(p?.avatar_url ?? null);
      });
      getUnreadCount().then(({ data }) => !cancelled && setUnread(data ?? 0));
    };
    load();
    window.addEventListener("profile-updated", load);
    const onRead = () => setUnread(0);
    window.addEventListener("notifications-read", onRead);
    return () => {
      cancelled = true;
      window.removeEventListener("profile-updated", load);
      window.removeEventListener("notifications-read", onRead);
    };
  }, [session?.user?.id]);

  useEffect(() => {
    if (!loggedIn || inflight.current) return;
    inflight.current = true;
    void listMyDelegations()
      .then(({ data }) => {
        const received = data?.received ?? [];
        const activeAccounts = received.filter(
          (d) => d.scope_type === "account" && d.status === "active"
        );
        setAccounts(activeAccounts);
        // Pending inbound (any scope) — surfaces on the "Delegations"
        // nav row as a subtle badge. Matches the /my/delegations page
        // heuristic so the badge disappears the moment the user opens
        // the list.
        setPendingDelegations(
          received.filter((d) => d.status === "pending").length
        );
      })
      .finally(() => {
        inflight.current = false;
      });
  }, [loggedIn]);

  // Primary nav — top block. Order matches the wireframe exactly.
  // Public profile is intentionally NOT here — see the docblock and
  // the Switch Account self-row polish below.
  const PRIMARY_NAV: NavItem[] = [
    {
      key: "nav.explore",
      href: "/feed?tab=all&sort=latest",
      match: (p) => p.startsWith("/feed"),
    },
    {
      key: "nav.messages",
      href: "/my/messages",
      match: (p) => p.startsWith("/my/messages"),
    },
    {
      key: "nav.workspace",
      href: "/my",
      // Workspace hub only — sub-pages have their own nav slots
      // (Saved → /my/shortlists, etc.) so /my/xxx should NOT light up
      // this entry.
      match: (p) => p === "/my",
    },
    {
      key: "nav.saved",
      href: "/my/shortlists",
      match: (p) => p.startsWith("/my/shortlists"),
    },
    {
      key: "nav.upload",
      href: "/upload",
      match: (p) => p.startsWith("/upload"),
    },
  ];

  function switchToOwn() {
    clearActingAs();
    router.refresh();
  }
  function switchToPrincipal(d: DelegationWithDetails) {
    const p = d.delegator_profile;
    if (!p?.id) return;
    setActingAs(p.id, formatDisplayName(p) || formatUsername(p));
    router.push("/my");
    router.refresh();
  }
  async function handleLogout() {
    await signOut();
    router.replace("/login");
  }

  const ownName =
    displayName || (username ? `@${username}` : t("acting.switcher.myAccount"));

  const activeAccent = "before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[2px] before:bg-zinc-900 before:content-['']";

  function renderNavRow(item: NavItem) {
    const active = item.match(pathname);
    return (
      <Link
        key={item.key}
        href={item.href}
        className={`relative flex items-center justify-between rounded-md py-1.5 pl-3 pr-2 text-[15px] transition-colors ${
          active
            ? `font-bold text-zinc-900 ${activeAccent}`
            : "text-zinc-600 hover:text-zinc-900"
        }`}
      >
        <span>{t(item.key)}</span>
        {/* Guard with `!= null` because `0 && …` evaluates to `0`, which
            React would render as literal text next to the label (that's
            the "위임 0" glitch reported in the redesign QA). */}
        {item.badge != null && item.badge > 0 && (
          <span className="ml-2 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
            {item.badge > 99 ? "99+" : item.badge}
          </span>
        )}
      </Link>
    );
  }

  const delegationsItem: NavItem = {
    key: "nav.delegations",
    href: "/my/delegations",
    match: (p) => p.startsWith("/my/delegations"),
    badge: pendingDelegations,
  };

  const settingsItem: NavItem = {
    key: "nav.setting",
    href: "/settings",
    match: (p) => p === "/settings",
  };

  return (
    <nav
      aria-label="Primary"
      className="flex h-full min-h-screen flex-col gap-6 py-8 pr-6 text-[15px]"
    >
      <Link
        href="/feed?tab=all&sort=latest"
        aria-label="Theo"
        className="inline-block text-zinc-900 transition-opacity hover:opacity-80"
      >
        {/* Brand mark — official raster with session-once reveal + settle
            animation (see TheoLogo). Above-the-fold, so `priority`. */}
        <TheoLogo className="h-12" size="md" priority />
      </Link>

      <div className="flex flex-col gap-1">
        {PRIMARY_NAV.map(renderNavRow)}
      </div>

      <div className="mt-auto flex flex-col gap-1">
        {/* Secondary nav — spacer then Notifications / Setting / Delegations. */}
        <button
          type="button"
          onClick={onOpenNotifications}
          className={`relative flex items-center justify-between rounded-md py-1.5 pl-3 pr-2 text-left text-[15px] text-zinc-600 transition-colors hover:text-zinc-900`}
          aria-haspopup="dialog"
        >
          <span>{t("nav.notifications")}</span>
          {unread > 0 && (
            <span className="ml-2 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
        {renderNavRow(settingsItem)}
        {renderNavRow(delegationsItem)}

        <div className="mt-2 flex items-center gap-3 pl-3 text-xs text-zinc-400">
          <button
            type="button"
            onClick={() => setLocale("en")}
            className={locale === "en" ? "font-semibold text-zinc-900" : "hover:text-zinc-700"}
          >
            EN
          </button>
          <span>/</span>
          <button
            type="button"
            onClick={() => setLocale("ko")}
            className={locale.startsWith("ko") ? "font-semibold text-zinc-900" : "hover:text-zinc-700"}
          >
            KO
          </button>
        </div>

        {loggedIn ? (
          <div className="mt-3 flex flex-col gap-2 pl-3">
            <p className="text-sm text-zinc-500">{t("nav.switchAccount")}</p>
            <ul className="flex flex-col gap-1.5">
              {/* Own account — the wireframe-sanctioned public profile
                  entry point. Clicking either the avatar or the name
                  navigates to /u/{username}; when the user is
                  currently acting-as a principal, the same button
                  first returns them to their own persona (safer
                  gesture, since jumping straight to another
                  identity's public profile could confuse the acting-
                  as banner). A secondary "View my public profile →"
                  affordance sits below the name to surface the
                  destination — otherwise the row reads as an
                  ambient identity indicator and QA reported users
                  never tried clicking it (2026-08-04). */}
              <li>
                <button
                  type="button"
                  onClick={() => {
                    if (actingAsProfileId) {
                      switchToOwn();
                    } else {
                      router.push(profileHref);
                    }
                  }}
                  className="group flex w-full items-start gap-2 rounded-md py-1 text-left transition-colors hover:bg-zinc-50"
                >
                  <AvatarDisc
                    imageUrl={avatarUrl}
                    fallback={
                      username && !isPlaceholder
                        ? username.charAt(0).toUpperCase()
                        : "?"
                    }
                    active={!actingAsProfileId}
                  />
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span
                      className={`truncate text-sm ${
                        !actingAsProfileId
                          ? "font-semibold text-zinc-900"
                          : "text-zinc-500"
                      }`}
                    >
                      {ownName}
                    </span>
                    {!actingAsProfileId && !isPlaceholder && username && (
                      <span className="mt-0.5 truncate text-[11px] text-zinc-400 transition-colors group-hover:text-zinc-600">
                        {t("nav.viewMyPublicProfile")}{" "}
                        <span aria-hidden="true">→</span>
                      </span>
                    )}
                  </span>
                </button>
              </li>
              {accounts.map((d) => {
                const p = d.delegator_profile;
                const label = p
                  ? formatDisplayName(p) || formatUsername(p)
                  : "—";
                const active = actingAsProfileId === p?.id;
                return (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => switchToPrincipal(d)}
                      className="flex w-full items-center gap-2 text-left"
                    >
                      <AvatarDisc
                        imageUrl={p?.avatar_url ?? null}
                        fallback={
                          p?.username
                            ? p.username.charAt(0).toUpperCase()
                            : "?"
                        }
                        active={active}
                      />
                      <span
                        className={`truncate text-sm ${
                          active
                            ? "font-semibold text-zinc-900"
                            : "text-zinc-500"
                        }`}
                      >
                        {label}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {actingAsLabel && (
              <p className="text-[11px] text-amber-700">
                {t("delegation.banner.label").replace("{name}", actingAsLabel)}
              </p>
            )}
            <button
              type="button"
              onClick={handleLogout}
              className="mt-1 self-start text-xs text-zinc-400 hover:text-zinc-700"
            >
              {t("nav.logout")}
            </button>
          </div>
        ) : (
          <Link href="/login" className="pl-3 text-zinc-600 hover:text-zinc-900">
            {t("nav.login")}
          </Link>
        )}
      </div>
    </nav>
  );
}

/**
 * Sidebar Switch-Account avatar — small circular disc with an optional
 * yellow dot indicator (matches the wireframe's active state).
 *
 * The outer wrapper is `relative` **without** `overflow-hidden` so the
 * status dot can sit outside the circular clip. The circular crop is
 * applied only to the inner image wrapper.
 */
function AvatarDisc({
  imageUrl,
  fallback,
  active,
}: {
  imageUrl: string | null;
  fallback: string;
  active: boolean;
}) {
  const src = imageUrl
    ? imageUrl.startsWith("http")
      ? imageUrl
      : getArtworkImageUrl(imageUrl, "avatar")
    : null;
  return (
    <span className="relative inline-block h-6 w-6 shrink-0">
      <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-zinc-200 bg-zinc-100 text-[10px] font-medium text-zinc-500">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="h-full w-full object-cover" />
        ) : (
          <span>{fallback}</span>
        )}
      </span>
      {active && (
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 inline-block h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-white"
        />
      )}
    </span>
  );
}
