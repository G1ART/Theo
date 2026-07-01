"use client";

import Link from "next/link";
import { BuildStamp } from "./BuildStamp";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { signOut } from "@/lib/supabase/auth";
import { supabase } from "@/lib/supabase/client";
import { getMyProfile } from "@/lib/supabase/profiles";
import { hydrateSizeUnitPref } from "@/lib/size/preference";
import { getArtworkImageUrl } from "@/lib/supabase/artworks";
import { getUnreadCount } from "@/lib/supabase/notifications";
import { useT } from "@/lib/i18n/useT";
import { useActingAs } from "@/context/ActingAsContext";
import { isPlaceholderUsername } from "@/lib/identity/placeholder";
import { listMyDelegations, type DelegationWithDetails } from "@/lib/supabase/delegations";
import { formatDisplayName, formatUsername } from "@/lib/identity/format";

const MAIN_NAV = [
  { href: "/feed?tab=all&sort=latest", key: "nav.feed" },
  { href: "/people", key: "nav.people" },
  { href: "/upload", key: "nav.upload" },
] as const;

const linkClass = "text-sm text-zinc-600 hover:text-zinc-900";

export function Header() {
  const router = useRouter();
  const { t, locale, setLocale } = useT();
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profileUsername, setProfileUsername] = useState<string | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const isPlaceholderProfile = isPlaceholderUsername(profileUsername);
  const myHref = !profileUsername || isPlaceholderProfile ? "/onboarding/identity" : "/my";
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const avatarRef = useRef<HTMLDivElement>(null);

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
      setProfileLoaded(false);
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
        setProfileLoaded(true);
        // Mirror the server-side size-unit display preference into the
        // localStorage cache so every artwork surface renders in the unit
        // the viewer picked, on any device (see @/lib/size/preference).
        hydrateSizeUnitPref(p?.profile_details?.size_unit_pref);
      });
    };
    setProfileLoaded(false);
    loadProfile();
    // After onboarding/profile saves the username changes (placeholder →
    // chosen handle). The root layout doesn't remount on client navigation,
    // so without this the "내 스튜디오" link stays pinned to /onboarding/identity
    // and the user can never reach their studio (QA loop 2026-06-29).
    window.addEventListener("profile-updated", loadProfile);
    return () => {
      cancelled = true;
      window.removeEventListener("profile-updated", loadProfile);
    };
  }, [session?.user?.id]);

  function fetchUnread() {
    if (!session?.user?.id) return;
    getUnreadCount().then(({ data }) => setUnreadCount(data ?? 0));
  }

  useEffect(() => {
    fetchUnread();
  }, [session?.user?.id]);

  useEffect(() => {
    function onRead() {
      setUnreadCount(0);
    }
    window.addEventListener("notifications-read", onRead);
    return () => window.removeEventListener("notifications-read", onRead);
  }, []);

  useEffect(() => {
    if (avatarOpen) {
      fetchUnread();
      if (session) loadActiveAccountDelegations();
    }
  }, [avatarOpen, session]);

  // Mobile parity: when the hamburger menu opens, also lazy-load the
  // active account delegations so the mobile switcher reflects the same
  // state as the desktop dropdown without requiring a separate fetch.
  useEffect(() => {
    if (mobileOpen && session) {
      loadActiveAccountDelegations();
    }
  }, [mobileOpen, session]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) {
        setAvatarOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function closeMobile() {
    setMobileOpen(false);
  }

  async function handleLogout() {
    setAvatarOpen(false);
    await signOut();
    router.replace("/login");
  }

  const loggedIn = !!session;
  const {
    actingAsProfileId,
    actingAsLabel,
    setActingAs,
    clearActingAs,
    staleCleared,
    acknowledgeStaleCleared,
  } = useActingAs();

  // Account-scope active delegations the operator received. The avatar
  // dropdown surfaces these as the "Switch account" section so the user
  // can toggle into a principal persona without leaving the current
  // page. We lazy-load on first dropdown open and refresh whenever the
  // operator re-opens it, so freshly-accepted invites surface promptly.
  const [activeAccountDelegations, setActiveAccountDelegations] = useState<
    DelegationWithDetails[]
  >([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const switcherFetchInflightRef = useRef(false);

  useEffect(() => {
    if (!loggedIn) {
      setActiveAccountDelegations([]);
      setAccountsLoaded(false);
    }
  }, [loggedIn]);

  function loadActiveAccountDelegations() {
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
      })
      .finally(() => {
        switcherFetchInflightRef.current = false;
      });
  }

  function handleSwitchToPrincipal(d: DelegationWithDetails) {
    const profile = d.delegator_profile;
    if (!profile?.id) return;
    const name = formatDisplayName(profile) || formatUsername(profile);
    setActingAs(profile.id, name);
    setAvatarOpen(false);
    setMobileOpen(false);
    // router.refresh() lets layout-level caches recompute against the
    // new acting-as state without a full reload. We avoid the previous
    // `window.location.href` jump because the ActingAsContext provider
    // already re-fetches on visibility/focus changes.
    router.push("/my");
    router.refresh();
  }

  /**
   * Safe operator return.
   *
   * `clearActingAs()` alone leaves the user on whatever page they were on,
   * which may be a *principal-only* surface (e.g. the principal's
   * exhibition edit page). After clearing, that route either renders empty
   * or denies access — confusing. So we always route to `/my` (a safe
   * operator workspace) before refreshing layout caches. The same handler
   * is wired to both the avatar dropdown's "my account" row AND the
   * global acting-as banner's "return to my account" link so the two
   * paths cannot drift.
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

  return (
    // QA 2026-06-26 (#1) — sticky top so the header stays in view from
    // the very first paint, even on pages where the user lands with
    // scrollY > 0 (deep-link / SSR-scrolled-to-section). The whole
    // banner+header stack sticks together so the staleCleared and
    // acting-as banners never become detached "floating" notices above
    // the bar. `z-40` keeps us below modals/drawers (z-50+), so an
    // open dialog still covers the bar without the user needing to
    // dismiss us first. The opaque `bg-white` prevents page content
    // from bleeding through the bar while it scrolls underneath.
    <div className="sticky top-0 z-40 bg-white">
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
          className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-900 sm:text-sm"
        >
          <span className="inline-flex items-center gap-1.5 truncate">
            <span
              aria-hidden="true"
              className="hidden h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500 sm:inline-block"
            />
            <span className="truncate">
              {t("delegation.banner.label").replace("{name}", actingAsLabel)}
            </span>
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-3">
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
      <header className="relative flex h-14 items-center justify-between border-b border-zinc-200 px-4">
      <div className="flex items-center gap-6">
        <Link
          href="/feed?tab=all&sort=latest"
          className="text-lg font-semibold text-zinc-900 hover:text-zinc-700"
          onClick={closeMobile}
        >
          <span translate="no">Theo</span>
        </Link>

        {/* Main tabs: Feed, People, Upload (no Settings) */}
        {ready && loggedIn && (
          <nav className="hidden md:flex items-center gap-4">
            {MAIN_NAV.map(({ href, key }) => (
              <Link key={key} href={href} className={linkClass}>
                {t(key)}
              </Link>
            ))}
          </nav>
        )}
      </div>

      <div className="flex items-center gap-3">
        {/* My Studio | EN/KR | Avatar */}
        {ready && loggedIn && (
          <>
            <Link href={myHref} className={linkClass}>
              {t("nav.myProfile")}
            </Link>
            <span className="flex gap-1 text-xs text-zinc-500">
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
            <div className="relative" ref={avatarRef}>
              <button
                type="button"
                onClick={() => setAvatarOpen((o) => !o)}
                className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-zinc-200 bg-zinc-100 hover:bg-zinc-200"
                aria-expanded={avatarOpen}
                aria-haspopup="true"
                aria-label={unreadCount > 0 ? t("notifications.link") + ` (${unreadCount})` : undefined}
              >
                {avatarUrl ? (
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
                {unreadCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </button>
              {avatarOpen && (
                <div
                  data-tour="account-switcher"
                  role="menu"
                  className="absolute right-0 top-full z-50 mt-1 min-w-[220px] rounded-lg border border-zinc-200 bg-white py-1 shadow-lg"
                >
                  <Link
                    href="/notifications"
                    className="flex items-center justify-between px-4 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
                    onClick={() => setAvatarOpen(false)}
                    role="menuitem"
                  >
                    {t("notifications.link")}
                    {unreadCount > 0 && (
                      <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </span>
                    )}
                  </Link>
                  <div className="my-1 border-t border-zinc-100" />

                  {/* Account switcher (only rendered when there is at
                      least one active account delegation, otherwise
                      this strip would be visual debt for solo users). */}
                  {(accountsLoaded && activeAccountDelegations.length > 0) ||
                  actingAsProfileId ? (
                    <>
                      <div className="px-4 pt-1 pb-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
                        {t("acting.switcher.heading")}
                      </div>
                      <button
                        type="button"
                        onClick={handleSwitchToOperator}
                        className="flex w-full items-center justify-between px-4 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
                        role="menuitemradio"
                        aria-checked={!actingAsProfileId}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className={`h-2 w-2 rounded-full ${
                              !actingAsProfileId ? "bg-zinc-900" : "bg-transparent"
                            }`}
                          />
                          <span className="font-medium">
                            {profileUsername
                              ? `@${profileUsername}`
                              : t("acting.switcher.myAccount")}
                          </span>
                          {!actingAsProfileId && (
                            <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">
                              {t("acting.switcher.activeChip")}
                            </span>
                          )}
                        </span>
                      </button>
                      {activeAccountDelegations.map((d) => {
                        const p = d.delegator_profile;
                        if (!p?.id) return null;
                        const name = formatDisplayName(p) || formatUsername(p) || p.username || p.id;
                        const isActive = actingAsProfileId === p.id;
                        return (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => handleSwitchToPrincipal(d)}
                            className="flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
                            role="menuitemradio"
                            aria-checked={isActive}
                          >
                            <span className="flex items-center gap-2 truncate">
                              <span
                                aria-hidden="true"
                                className={`h-2 w-2 shrink-0 rounded-full ${
                                  isActive ? "bg-zinc-900" : "bg-transparent"
                                }`}
                              />
                              <span className="truncate">
                                {name}
                                {p.username && (
                                  <span className="ml-1 text-xs text-zinc-500">
                                    @{p.username}
                                  </span>
                                )}
                              </span>
                            </span>
                            {isActive && (
                              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">
                                {t("acting.switcher.actingChip")}
                              </span>
                            )}
                          </button>
                        );
                      })}
                      <div className="my-1 border-t border-zinc-100" />
                    </>
                  ) : null}

                  <div className="px-4 py-2 text-[10px] text-zinc-400">
                    <BuildStamp />
                  </div>
                  <div className="my-1 border-t border-zinc-100" />
                  <Link
                    href="/settings"
                    className="block px-4 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
                    onClick={() => setAvatarOpen(false)}
                    role="menuitem"
                  >
                    {t("account.settings")}
                  </Link>
                  <Link
                    href="/my/delegations"
                    className="block px-4 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
                    onClick={() => setAvatarOpen(false)}
                    role="menuitem"
                  >
                    {t("delegation.myDelegations")}
                  </Link>
                  <div className="my-1 border-t border-zinc-100" />
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="block w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                    role="menuitem"
                  >
                    {t("account.logout")}
                  </button>
                </div>
              )}
            </div>
          </>
        )}
        {ready && !loggedIn && (
          <>
            <span className="flex gap-1 text-xs text-zinc-500">
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
              className="rounded px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
            >
              {t("nav.login")}
            </Link>
          </>
        )}

        {/* Mobile: hamburger */}
        <div className="md:hidden flex items-center gap-2">
          {ready && loggedIn && (
            <button
              type="button"
              onClick={() => setMobileOpen((o) => !o)}
              className="rounded p-2 text-zinc-600 hover:bg-zinc-100"
              aria-expanded={mobileOpen}
              aria-label={t("nav.menu")}
            >
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

      {/* Mobile menu: Feed, People, Upload, My Profile, Avatar (Settings/Logout inside avatar) */}
      {mobileOpen && loggedIn && (
        <div className="md:hidden absolute top-full left-0 right-0 z-50 border-b border-zinc-200 bg-white shadow-sm">
          <nav className="flex flex-col p-4 gap-1">
            {MAIN_NAV.map(({ href, key }) => (
              <Link key={key} href={href} className={`${linkClass} py-2 px-1`} onClick={closeMobile}>
                {t(key)}
              </Link>
            ))}
            <Link
              href={myHref}
              className={`${linkClass} py-2 px-1`}
              onClick={closeMobile}
            >
              {t("nav.myProfile")}
            </Link>
            <Link
              href="/notifications"
              className={`${linkClass} py-2 px-1`}
              onClick={closeMobile}
            >
              {t("notifications.link")}
              {unreadCount > 0 && ` (${unreadCount > 99 ? "99+" : unreadCount})`}
            </Link>

            {/* Mobile Account Switcher (parity with desktop avatar dropdown).
                Only renders when there is at least one active account
                delegation, otherwise this strip would be visual debt for
                solo users. The handlers are shared with the desktop
                dropdown so toggle/return semantics cannot drift. */}
            {((accountsLoaded && activeAccountDelegations.length > 0) ||
              actingAsProfileId) && (
              <>
                <div className="my-2 border-t border-zinc-100" />
                <div className="px-1 pt-1 pb-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
                  {t("acting.switcher.heading")}
                </div>
                <button
                  type="button"
                  onClick={handleSwitchToOperator}
                  className="flex w-full items-center justify-between px-1 py-2 text-left text-sm text-zinc-700"
                  role="menuitemradio"
                  aria-checked={!actingAsProfileId}
                >
                  <span className="flex items-center gap-2 truncate">
                    <span
                      aria-hidden="true"
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        !actingAsProfileId ? "bg-zinc-900" : "bg-transparent"
                      }`}
                    />
                    <span className="truncate font-medium">
                      {profileUsername
                        ? `@${profileUsername}`
                        : t("acting.switcher.myAccount")}
                    </span>
                    {!actingAsProfileId && (
                      <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">
                        {t("acting.switcher.activeChip")}
                      </span>
                    )}
                  </span>
                </button>
                {activeAccountDelegations.map((d) => {
                  const p = d.delegator_profile;
                  if (!p?.id) return null;
                  const name =
                    formatDisplayName(p) ||
                    formatUsername(p) ||
                    p.username ||
                    p.id;
                  const isActive = actingAsProfileId === p.id;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => handleSwitchToPrincipal(d)}
                      className="flex w-full items-center justify-between gap-2 px-1 py-2 text-left text-sm text-zinc-700"
                      role="menuitemradio"
                      aria-checked={isActive}
                    >
                      <span className="flex items-center gap-2 truncate">
                        <span
                          aria-hidden="true"
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            isActive ? "bg-zinc-900" : "bg-transparent"
                          }`}
                        />
                        <span className="truncate">
                          {name}
                          {p.username && (
                            <span className="ml-1 text-xs text-zinc-500">
                              @{p.username}
                            </span>
                          )}
                        </span>
                      </span>
                      {isActive && (
                        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">
                          {t("acting.switcher.actingChip")}
                        </span>
                      )}
                    </button>
                  );
                })}
              </>
            )}

            <div className="my-2 border-t border-zinc-100" />
            <Link
              href="/settings"
              className={`${linkClass} py-2 px-1`}
              onClick={closeMobile}
            >
              {t("account.settings")}
            </Link>
            <button
              type="button"
              onClick={() => { closeMobile(); handleLogout(); }}
              className="text-left py-2 px-1 text-sm text-red-600 hover:text-red-700"
            >
              {t("account.logout")}
            </button>
          </nav>
        </div>
      )}
    </header>
    </div>
  );
}
