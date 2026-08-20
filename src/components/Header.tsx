"use client";

import { TheoLogo } from "@/components/brand/TheoLogo";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { isAuthFrontDoorRoute, isShellRoute } from "@/lib/shell/routes";
import { useEffect, useId, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { getMyProfile } from "@/lib/supabase/profiles";
import { hydrateSizeUnitPref } from "@/lib/size/preference";
import { getArtworkImageUrl } from "@/lib/supabase/artworks";
import { getUnreadCount } from "@/lib/supabase/notifications";
import { useT } from "@/lib/i18n/useT";
import { useActingAs } from "@/context/ActingAsContext";
import { isPlaceholderUsername } from "@/lib/identity/placeholder";
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
import {
  HamburgerContextPeek,
  useFollowInviteCount,
} from "@/components/shell/HamburgerContextPeek";
import { hitTarget } from "@/components/ds/buttonStyles";

/**
 * Global top-bar. On desktop AppShell routes (`lg+`) the sidebar takes
 * over so this only renders below `lg`. Phone and tablet share one
 * chrome language: hamburger + (when logged in) a direct avatar link
 * to the public profile. There is no tablet horizontal nav strip —
 * sidebar at `lg+` plus hamburger below `lg` is enough.
 *
 * Below `lg`:
 *   - Avatar is a **direct link** to the user's public profile
 *     (`/u/{username}` or `/onboarding/identity` if the handle is
 *     placeholder/missing). The dropdown menu is not rendered —
 *     the hamburger owns the full menu surface.
 *   - Hamburger panel renders PRIMARY_NAV + SECONDARY_NAV +
 *     AccountSwitcher (via the shared component) + locale switcher
 *     + anonymous "Get started"/"Login" footer.
 *   - Panel is a `role="dialog"` / `aria-modal="true"` with Escape
 *     close, focus trap, and `aria-controls` linkage on the trigger.
 *
 * `lg+` on non-AppShell routes:
 *   - Avatar dropdown owns the secondary surface. It consumes the same
 *     shared config + `AccountSwitcher` so it can't drift from the
 *     sidebar. `BuildStamp` has moved out of here into the Settings
 *     page footer.
 */

/** Selector for focusable elements within a container. Kept in sync
 *  with the WCAG focus-trap conventions — no third-party dep. */
const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Header() {
  const router = useRouter();
  const pathname = usePathname();
  // On AppShell routes the desktop (lg+) chrome is the left sidebar, so we
  // hide the top nav there. Mobile keeps the proven Header + hamburger.
  const shellRoute = isShellRoute(pathname);
  const authFrontDoor = isAuthFrontDoorRoute(pathname);
  const { t, locale, setLocale } = useT();
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profileUsername, setProfileUsername] = useState<string | null>(null);
  const isPlaceholderProfile = isPlaceholderUsername(profileUsername);
  const mobileProfileHref =
    !profileUsername || isPlaceholderProfile
      ? "/onboarding/identity"
      : `/u/${profileUsername}`;
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pageBlocked, setPageBlocked] = useState(false);
  const pageBlockTimerRef = useRef<number | null>(null);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const avatarRef = useRef<HTMLDivElement>(null);
  const hamburgerButtonRef = useRef<HTMLButtonElement>(null);
  const mobilePanelRef = useRef<HTMLDivElement>(null);
  const mobilePanelId = useId();
  const mobilePanelHeadingId = useId();

  const {
    actingAsLabel,
    clearActingAs,
    staleCleared,
    acknowledgeStaleCleared,
  } = useActingAs();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user?.id) {
      setProfileUsername(null);
      setAvatarUrl(null);
      setUnreadCount(0);
      return;
    }
    let cancelled = false;
    const loadProfile = () => {
      getMyProfile().then(({ data }) => {
        if (cancelled) return;
        const p = data as {
          username?: string | null;
          avatar_url?: string | null;
          profile_details?: { size_unit_pref?: unknown } | null;
        } | null;
        setProfileUsername(p?.username ?? null);
        setAvatarUrl(p?.avatar_url ?? null);
        // Mirror the server-side size-unit display preference into the
        // localStorage cache so every artwork surface renders in the unit
        // the viewer picked, on any device (see @/lib/size/preference).
        hydrateSizeUnitPref(p?.profile_details?.size_unit_pref);
      });
    };
    loadProfile();
    // After onboarding/profile saves the username changes (placeholder →
    // chosen handle). The root layout doesn't remount on client
    // navigation, so without this refresh the mobile avatar link would
    // stay pinned to /onboarding/identity (QA loop 2026-06-29).
    window.addEventListener("profile-updated", loadProfile);
    return () => {
      cancelled = true;
      window.removeEventListener("profile-updated", loadProfile);
    };
  }, [session?.user?.id]);

  const fetchUnread = useCallback(() => {
    if (!session?.user?.id) return;
    getUnreadCount().then(({ data }) => setUnreadCount(data ?? 0));
  }, [session?.user?.id]);

  useEffect(() => {
    fetchUnread();
  }, [fetchUnread]);

  useEffect(() => {
    function onRead() {
      setUnreadCount(0);
    }
    window.addEventListener("notifications-read", onRead);
    return () => window.removeEventListener("notifications-read", onRead);
  }, []);

  const [activeAccountDelegations, setActiveAccountDelegations] = useState<
    DelegationWithDetails[]
  >([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [pendingDelegations, setPendingDelegations] = useState(0);
  const switcherFetchInflightRef = useRef(false);

  const loggedIn = !!session;
  const inviteCount = useFollowInviteCount(loggedIn);

  useEffect(() => {
    if (!loggedIn) {
      setActiveAccountDelegations([]);
      setAccountsLoaded(false);
      setPendingDelegations(0);
    }
  }, [loggedIn]);

  const loadActiveAccountDelegations = useCallback(() => {
    if (switcherFetchInflightRef.current) return;
    switcherFetchInflightRef.current = true;
    void listMyDelegations()
      .then(({ data }) => {
        const received = data?.received ?? [];
        const filtered = received.filter(
          (d) => d.scope_type === "account" && d.status === "active"
        );
        setActiveAccountDelegations(filtered);
        setAccountsLoaded(true);
        setPendingDelegations(
          received.filter((d) => d.status === "pending").length
        );
      })
      .finally(() => {
        switcherFetchInflightRef.current = false;
      });
  }, []);

  useEffect(() => {
    if (avatarOpen) {
      fetchUnread();
      if (session) loadActiveAccountDelegations();
    }
  }, [avatarOpen, session, fetchUnread, loadActiveAccountDelegations]);

  // Mobile parity: when the hamburger menu opens, also lazy-load the
  // active account delegations so the mobile switcher reflects the same
  // state as the desktop dropdown without requiring a separate fetch.
  useEffect(() => {
    if (mobileOpen && session) {
      loadActiveAccountDelegations();
    }
  }, [mobileOpen, session, loadActiveAccountDelegations]);

  // Load pending count without opening any menu, so the hamburger row
  // shows its badge without waiting for a first tap.
  useEffect(() => {
    if (!loggedIn) return;
    loadActiveAccountDelegations();
  }, [loggedIn, loadActiveAccountDelegations]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) {
        setAvatarOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const openMobile = useCallback(() => {
    if (pageBlockTimerRef.current != null) {
      window.clearTimeout(pageBlockTimerRef.current);
      pageBlockTimerRef.current = null;
    }
    setPageBlocked(true);
    setMobileOpen(true);
  }, []);

  const closeMobile = useCallback(() => {
    setMobileOpen(false);
    if (pageBlockTimerRef.current != null) {
      window.clearTimeout(pageBlockTimerRef.current);
    }
    // Keep the scrim + pointer-events lock through the ghost click
    // that iOS/Chrome retarget onto the artwork under the finger.
    pageBlockTimerRef.current = window.setTimeout(() => {
      setPageBlocked(false);
      pageBlockTimerRef.current = null;
    }, 450);
  }, []);

  useEffect(() => {
    return () => {
      if (pageBlockTimerRef.current != null) {
        window.clearTimeout(pageBlockTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("theo-nav-blocked", pageBlocked);
    return () => {
      document.documentElement.classList.remove("theo-nav-blocked");
    };
  }, [pageBlocked]);

  // ── Mobile hamburger a11y: Escape close + focus trap ──────────────
  // The drawer becomes a modal dialog when open, so we (1) trap Tab
  // within the panel, (2) close on Escape, (3) restore focus to the
  // trigger when it closes. Simple manual implementation — no new
  // dependencies.
  useEffect(() => {
    if (!mobileOpen) return;
    const panel = mobilePanelRef.current;
    if (!panel) return;

    // Move focus into the panel on open. Use a microtask so the newly
    // mounted DOM is settled before we query for focusables.
    const focusTimer = window.setTimeout(() => {
      const focusables = panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      focusables[0]?.focus();
    }, 0);

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeMobile();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = Array.from(
        panel!.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => !el.hasAttribute("aria-hidden"));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !panel!.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileOpen, closeMobile]);

  // Restore focus to the trigger when the drawer closes (only if the
  // trigger is still in the DOM — a route change would remount it).
  const wasMobileOpenRef = useRef(false);
  useEffect(() => {
    if (wasMobileOpenRef.current && !mobileOpen) {
      hamburgerButtonRef.current?.focus();
    }
    wasMobileOpenRef.current = mobileOpen;
  }, [mobileOpen]);

  /**
   * Safe operator return, called from the acting-as banner and
   * dropdown/hamburger "return to my account" affordances. Mirrors the
   * AccountSwitcher's own switch-to-own semantics so the entry points
   * cannot drift: `clearActingAs()` alone leaves the user on whatever
   * page they were on, which may be a *principal-only* surface, so we
   * always route to `/my` (a safe operator workspace) before refreshing
   * layout caches.
   */
  function handleSwitchToOperator() {
    clearActingAs();
    setAvatarOpen(false);
    setMobileOpen(false);
    router.push("/my");
    router.refresh();
  }

  // Auto-dismiss the stale-cleared notice after a few seconds so it
  // doesn't linger as visual debt. The provider keeps the flag until
  // we acknowledge — this guarantees the user gets at least one render
  // pass with it visible even on slow networks.
  useEffect(() => {
    if (!staleCleared) return;
    const handle = window.setTimeout(() => acknowledgeStaleCleared(), 6000);
    return () => window.clearTimeout(handle);
  }, [staleCleared, acknowledgeStaleCleared]);

  function resolveBadge(item: NavItem): number {
    if (item.badge === "delegationsPending") return pendingDelegations;
    if (item.badge === "unread") return unreadCount;
    return 0;
  }

  function renderMobileRow(item: NavItem) {
    const href =
      loggedIn || !item.gated
        ? item.href
        : onboardingUrlWithNext({ nextPath: item.href });
    const badgeCount = resolveBadge(item);
    const active = isNavItemActive(item, pathname ?? "");
    return (
      <Link
        key={item.key}
        href={href}
        onClick={closeMobile}
        className={`flex items-center justify-between py-2 px-1 text-sm transition-colors ${
          active
            ? "font-semibold text-zinc-900"
            : "text-zinc-600 hover:text-zinc-900"
        }`}
      >
        <span>{t(item.labelKey)}</span>
        {badgeCount > 0 && (
          <span className="ml-2 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
            {badgeCount > 99 ? "99+" : badgeCount}
          </span>
        )}
      </Link>
    );
  }

  const hamburgerSecondary = SECONDARY_NAV.filter(
    (item) => item.key !== "network" && item.key !== "board",
  );

  const accountMenuLabel = t("nav.accountMenu");
  const avatarAriaLabel =
    unreadCount > 0
      ? `${accountMenuLabel} (${unreadCount > 99 ? "99+" : unreadCount})`
      : accountMenuLabel;

  // Login / signup wireframes are a full-bleed canvas with no global
  // chrome. AuthShell owns the logo (large centered mark on /login,
  // none on /signup). Hooks above must still run.
  if (authFrontDoor) return null;

  return (
    <>
    {/* QA 2026-06-26 (#1) — sticky top so the header stays in view from
        the very first paint, even on pages where the user lands with
        scrollY > 0. Banner+header stick together. z-40 below modals;
        z-50 while the hamburger is open so the sheet sits above the
        body-level scrim. */}
    <div
      data-mobile-nav
      className={`sticky top-0 bg-white ${mobileOpen ? "z-50" : "z-40"}`}
    >
      {staleCleared && !actingAsLabel && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-between gap-3 border-b border-rose-200 bg-rose-50 px-4 py-1.5 text-xs text-rose-900 sm:text-sm"
        >
          <span className="truncate">{t("delegation.banner.staleCleared")}</span>
          <button
            type="button"
            onClick={acknowledgeStaleCleared}
            className="shrink-0 font-medium hover:underline"
          >
            {t("common.dismiss")}
          </button>
        </div>
      )}
      {actingAsLabel && (
        <div
          role="status"
          aria-live="polite"
          data-tour="acting-as-banner"
          className="flex flex-wrap items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-900 sm:text-sm"
        >
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <span
              aria-hidden="true"
              className="hidden h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500 sm:inline-block"
            />
            <span className="min-w-0">
              {t("delegation.banner.label").replace("{name}", actingAsLabel)}
            </span>
          </span>
          <span className="ml-auto flex flex-wrap items-center gap-3">
            <Link
              href="/my/delegations"
              className="font-medium hover:underline"
            >
              {t("delegation.banner.viewPermissions")}
            </Link>
            <button
              type="button"
              onClick={handleSwitchToOperator}
              className="font-medium hover:underline"
            >
              {t("delegation.banner.returnToMyAccount")}
            </button>
          </span>
        </div>
      )}
      <header
        className={`relative min-h-14 items-center justify-between border-b border-zinc-200 px-4 pt-[env(safe-area-inset-top)] ${
          shellRoute ? "flex lg:hidden" : "flex"
        }`}
      >
        <div className="flex items-center gap-6">
          <Link
            href="/feed?tab=all&sort=latest"
            aria-label="Theo"
            className="inline-flex items-center text-zinc-900 hover:opacity-80"
            onClick={closeMobile}
          >
            {/* Brand mark — official raster with session-once reveal + settle
                animation (see TheoLogo). Header appears on every route so `priority`. */}
            <TheoLogo className="h-9" size="sm" priority />
          </Link>
        </div>

        <div className="flex items-center gap-3">
          {ready && loggedIn && (
            <>
              {/* Desktop-only locale switcher on non-shell routes.
                  Below `lg` the hamburger already owns locale. */}
              <span className="hidden lg:flex gap-1 text-xs text-zinc-500">
                <button
                  type="button"
                  onClick={() => setLocale("en")}
                  className={locale === "en" ? "font-medium text-zinc-800" : "hover:text-zinc-700"}
                >
                  EN
                </button>
                <span>/</span>
                <button
                  type="button"
                  onClick={() => setLocale("ko")}
                  className={locale === "ko" ? "font-medium text-zinc-800" : "hover:text-zinc-700"}
                >
                  KO
                </button>
              </span>

              {/* Below-lg avatar: direct link to /u/{username}. The
                  hamburger owns the full menu surface. The avatar still
                  carries the unread badge as a visual cue. */}
              <Link
                href={mobileProfileHref}
                className={`lg:hidden relative flex ${hitTarget} items-center justify-center rounded-full hover:opacity-90`}
                aria-label={avatarAriaLabel}
              >
                <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-zinc-200 bg-zinc-100">
                  {avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={avatarUrl.startsWith("http") ? avatarUrl : getArtworkImageUrl(avatarUrl, "avatar")}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-sm font-medium text-zinc-600">
                      {isPlaceholderProfile || !profileUsername
                        ? "?"
                        : profileUsername.charAt(0).toUpperCase()}
                    </span>
                  )}
                </span>
                {unreadCount > 0 && (
                  <span className="pointer-events-none absolute -right-1 -top-1 z-10 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium leading-none text-white ring-2 ring-white">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </Link>

              {/* Desktop avatar dropdown (`lg+`, non-shell routes).
                  Shares the same AccountSwitcher + SECONDARY_NAV data
                  as the sidebar so labels/routes can't drift. */}
              <div className="hidden lg:block relative" ref={avatarRef}>
                <button
                  type="button"
                  onClick={() => setAvatarOpen((o) => !o)}
                  className={`relative flex ${hitTarget} items-center justify-center rounded-full hover:opacity-90`}
                  aria-expanded={avatarOpen}
                  aria-haspopup="true"
                  aria-label={avatarAriaLabel}
                >
                  {/* Inner wrapper clips the avatar into a circle. Keeping
                      overflow-hidden OFF the button lets the unread badge
                      overflow the avatar edge and stay fully visible. */}
                  <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-zinc-200 bg-zinc-100">
                    {avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={avatarUrl.startsWith("http") ? avatarUrl : getArtworkImageUrl(avatarUrl, "avatar")}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-sm font-medium text-zinc-600">
                        {isPlaceholderProfile || !profileUsername
                          ? "?"
                          : profileUsername.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </span>
                  {unreadCount > 0 && (
                    <span className="pointer-events-none absolute -right-1 -top-1 z-10 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium leading-none text-white ring-2 ring-white">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </button>
                {avatarOpen && (
                  <div
                    data-tour="account-switcher"
                    role="menu"
                    className="absolute right-0 top-full z-50 mt-1 min-w-[240px] rounded-lg border border-zinc-200 bg-white py-1 shadow-lg"
                  >
                    {SECONDARY_NAV.map((item) => {
                      const badgeCount = resolveBadge(item);
                      return (
                        <Link
                          key={item.key}
                          href={item.href}
                          className="flex items-center justify-between px-4 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
                          onClick={() => setAvatarOpen(false)}
                          role="menuitem"
                        >
                          <span>{t(item.labelKey)}</span>
                          {badgeCount > 0 && (
                            <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
                              {badgeCount > 99 ? "99+" : badgeCount}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                    <div className="my-1 border-t border-zinc-100" />
                    <AccountSwitcher
                      layout="dropdown"
                      username={profileUsername}
                      avatarUrl={avatarUrl}
                      accounts={activeAccountDelegations}
                      accountsLoaded={accountsLoaded}
                      onNavigate={() => setAvatarOpen(false)}
                    />
                  </div>
                )}
              </div>
            </>
          )}
          {ready && !loggedIn && (
            <>
              <span className="hidden lg:flex gap-1 text-xs text-zinc-500">
                <button
                  type="button"
                  onClick={() => setLocale("en")}
                  className={locale === "en" ? "font-medium text-zinc-800" : "hover:text-zinc-700"}
                >
                  EN
                </button>
                <span>/</span>
                <button
                  type="button"
                  onClick={() => setLocale("ko")}
                  className={locale === "ko" ? "font-medium text-zinc-800" : "hover:text-zinc-700"}
                >
                  KO
                </button>
              </span>
              <Link
                href="/login"
                className="hidden lg:inline-flex rounded px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
              >
                {t("nav.login")}
              </Link>
            </>
          )}

          {/* Hamburger — phone and tablet (`<lg`). Visible for both
              logged-in and anonymous visitors so anonymous users get
              sidebar parity (primary nav + locale + Get started / Login). */}
          <div className="lg:hidden flex items-center gap-2">
            {ready && (
              <button
                ref={hamburgerButtonRef}
                type="button"
                onClick={() => {
                  if (mobileOpen) closeMobile();
                  else openMobile();
                }}
                className={`${hitTarget} relative inline-flex items-center justify-center rounded p-2 text-zinc-600 hover:bg-zinc-100`}
                aria-expanded={mobileOpen}
                aria-controls={mobilePanelId}
                aria-label={
                  inviteCount > 0
                    ? `${t("nav.menu")} (${inviteCount})`
                    : t("nav.menu")
                }
              >
                {inviteCount > 0 && (
                  <span
                    aria-hidden
                    className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-zinc-900"
                  />
                )}
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {mobileOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Mobile hamburger panel. `role="dialog"` + `aria-modal="true"`
            + `aria-labelledby` + Escape close + focus trap live on this
            container. Content branches by loggedIn but the a11y wrapper
            stays the same. */}
        {mobileOpen && (
          <div
            ref={mobilePanelRef}
            id={mobilePanelId}
            role="dialog"
            aria-modal="true"
            aria-labelledby={mobilePanelHeadingId}
            className="lg:hidden absolute top-full left-0 right-0 z-50 border-b border-zinc-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-sm"
          >
            <h2 id={mobilePanelHeadingId} className="sr-only">
              {t("nav.menu")}
            </h2>
            <nav className="flex flex-col p-4 gap-1">
              {PRIMARY_NAV.map((item) => renderMobileRow(item))}

              <div className="my-2 border-t border-zinc-100" />
              <HamburgerContextPeek
                loggedIn={loggedIn}
                onNavigate={closeMobile}
              />

              {loggedIn &&
                hamburgerSecondary.map((item) => renderMobileRow(item))}

              {loggedIn && (
                <div data-tour="account-switcher">
                  <AccountSwitcher
                    layout="hamburger"
                    username={profileUsername}
                    avatarUrl={avatarUrl}
                    accounts={activeAccountDelegations}
                    accountsLoaded={accountsLoaded}
                    onNavigate={closeMobile}
                  />
                </div>
              )}

              {/* Locale switcher — sidebar parity for mobile. Placed
                  after the switcher (or after primary nav for anonymous)
                  so it's the last chrome before the auth CTA. */}
              <div className="mt-3 flex items-center gap-3 px-1 text-xs text-zinc-400">
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

              {!loggedIn && (
                <div className="mt-3 flex flex-col gap-2 px-1">
                  <Link
                    href={onboardingUrlWithNext({ nextPath: pathname || null })}
                    onClick={closeMobile}
                    className="inline-flex items-center justify-center rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
                  >
                    {t("nav.getStarted")}
                  </Link>
                  <Link
                    href="/login"
                    onClick={closeMobile}
                    className="inline-flex items-center justify-center rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
                  >
                    {t("nav.login")}
                  </Link>
                </div>
              )}
            </nav>
          </div>
        )}
      </header>
    </div>
    {pageBlocked && typeof document !== "undefined"
      ? createPortal(
          <div
            data-mobile-scrim
            aria-hidden
            className={`lg:hidden fixed inset-0 z-[45] ${
              mobileOpen ? "bg-black/25" : "bg-transparent"
            }`}
            style={{ touchAction: "none" }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (mobileOpen) closeMobile();
            }}
            onPointerUp={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          />,
          document.body,
        )
      : null}
    </>
  );
}
