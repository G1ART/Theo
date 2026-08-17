"use client";

import Link from "next/link";
import { TheoLogo } from "@/components/brand/TheoLogo";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { getMyProfile } from "@/lib/supabase/profiles";
import { getUnreadCount } from "@/lib/supabase/notifications";
import { useT } from "@/lib/i18n/useT";
import {
  listMyDelegations,
  type DelegationWithDetails,
} from "@/lib/supabase/delegations";
import { onboardingUrlWithNext } from "@/lib/identity/routing";
import {
  PRIMARY_NAV,
  SECONDARY_NAV,
  type NavItem,
  isNavItemActive,
} from "@/lib/shell/navConfig";
import { AccountSwitcher } from "@/components/shell/AccountSwitcher";

/**
 * Desktop-only left navigation for the Theo AppShell (Aug-2026 redesign).
 *
 * Wireframe reference (see `/assets/KakaoTalk_Photo_2026-08-03-*.png`):
 *
 *   [Theo logo (arch + wordmark)]
 *
 *   Explore       → /feed
 *   Messages      → /my/messages
 *   Workspace     → /my                 (backend hub)
 *   Saved         → /my/shortlists
 *   Upload        → /upload
 *
 *   ─ (spacer) ─
 *
 *   Notifications → button opens NotificationsDrawer (popover)
 *   Network       → /my/network
 *   Board         → /theo-board
 *   Setting       → /settings
 *   Delegations   → /my/delegations
 *   Switch Account → self-row (routes to /u/{username}) + received
 *                    account-delegations, with a secondary
 *                    "View my public profile →" affordance.
 *   Log out
 *
 * Since Aug-2026 (mobile/desktop cleanup): nav items, labels, and
 * match rules come from `@/lib/shell/navConfig`, and the Switch
 * Account block is rendered by the shared `<AccountSwitcher>`
 * component. Both are consumed by the hamburger (below `lg`) and the
 * `lg+` avatar dropdown too, so labels/routes cannot drift.
 *
 * The active item is rendered with bold weight + a thin 2px vertical
 * accent on the left. The mobile chrome still uses the top Header +
 * hamburger, so this component is rendered only inside the desktop
 * AppShell slot (`hidden lg:flex`).
 */

export function AppSidebar({
  onOpenNotifications,
}: {
  /** Fires when the user clicks the "Notifications" nav item.
   *  The AppShell owns the drawer's open state so it can render
   *  outside this rail's clipping context. */
  onOpenNotifications: () => void;
}) {
  const { t, locale, setLocale } = useT();
  const pathname = usePathname() ?? "";

  const [session, setSession] = useState<Session | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [accounts, setAccounts] = useState<DelegationWithDetails[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [pendingDelegations, setPendingDelegations] = useState(0);
  const inflight = useRef(false);

  const loggedIn = !!session;

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
      setAccountsLoaded(false);
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
        setAccountsLoaded(true);
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

  const activeAccent =
    "before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[2px] before:bg-zinc-900 before:content-['']";

  function resolveBadge(item: NavItem): number {
    if (item.badge === "delegationsPending") return pendingDelegations;
    if (item.badge === "unread") return unread;
    return 0;
  }

  function renderNavRow(item: NavItem) {
    const active = isNavItemActive(item, pathname);
    // Feed-first cold front door: anonymous visitors follow public rows
    // (Explore) directly, but account-gated rows route to sign-up with
    // the destination preserved as `next` so tapping never dead-ends on
    // a bare /login bounce that loses where they were headed.
    const href =
      loggedIn || !item.gated
        ? item.href
        : onboardingUrlWithNext({ nextPath: item.href });
    const badgeCount = resolveBadge(item);
    return (
      <Link
        key={item.key}
        href={href}
        className={`relative flex items-center justify-between rounded-md py-1.5 pl-3 pr-2 text-[15px] transition-colors ${
          active
            ? `font-bold text-zinc-900 ${activeAccent}`
            : "text-zinc-600 hover:text-zinc-900"
        }`}
      >
        <span>{t(item.labelKey)}</span>
        {/* Guard with `> 0` because `0 && …` evaluates to `0`, which
            React would render as literal text next to the label (that's
            the "위임 0" glitch reported in the redesign QA). */}
        {badgeCount > 0 && (
          <span className="ml-2 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
            {badgeCount > 99 ? "99+" : badgeCount}
          </span>
        )}
      </Link>
    );
  }

  // Secondary nav rows filtered by session — Delegations is a deep
  // account feature, so it's hidden entirely for anonymous visitors.
  // The Notifications row is intercepted with a button (opens the
  // drawer for members; anonymous visitors get a gated Link).
  const secondaryVisible = SECONDARY_NAV.filter((item) =>
    loggedIn ? true : !item.gated
  );

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
        {secondaryVisible.map((item) => {
          // Notifications: intercept the row to open the drawer for
          // members instead of following the /notifications route.
          // Anonymous visitors fall through to the gated Link path.
          if (item.key === "notifications" && loggedIn) {
            const badgeCount = resolveBadge(item);
            return (
              <button
                key={item.key}
                type="button"
                onClick={onOpenNotifications}
                className="relative flex items-center justify-between rounded-md py-1.5 pl-3 pr-2 text-left text-[15px] text-zinc-600 transition-colors hover:text-zinc-900"
                aria-haspopup="dialog"
              >
                <span>{t(item.labelKey)}</span>
                {badgeCount > 0 && (
                  <span className="ml-2 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
                    {badgeCount > 99 ? "99+" : badgeCount}
                  </span>
                )}
              </button>
            );
          }
          return renderNavRow(item);
        })}

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
          <AccountSwitcher
            layout="sidebar"
            username={username}
            displayName={displayName}
            avatarUrl={avatarUrl}
            accounts={accounts}
            accountsLoaded={accountsLoaded}
          />
        ) : (
          // Anonymous — single prominent "시작하기 / 로그인" CTA replacing
          // the whole Switch Account / Log out block. Sign-up primary
          // (cold-visitor convention), login secondary for returning
          // members. Both preserve the current location as `next`.
          <div className="mt-3 flex flex-col gap-2 pl-3 pr-2">
            <Link
              href={onboardingUrlWithNext({ nextPath: pathname || null })}
              className="inline-flex items-center justify-center rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
            >
              {t("nav.getStarted")}
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
            >
              {t("nav.login")}
            </Link>
          </div>
        )}
      </div>
    </nav>
  );
}
