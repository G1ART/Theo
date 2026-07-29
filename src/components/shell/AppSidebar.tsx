"use client";

import Link from "next/link";
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

type NavItem = { key: string; href: string; match: (p: string) => boolean };

/**
 * Desktop-only left navigation for the Theo AppShell (wireframe redesign).
 * Mirrors the existing Header's account/session logic but as a vertical rail.
 * On mobile the proven top Header + hamburger stays in charge, so this is
 * rendered `hidden lg:flex` by AppShell.
 */
export function AppSidebar() {
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
  const [unread, setUnread] = useState(0);
  const [accounts, setAccounts] = useState<DelegationWithDetails[]>([]);
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
      setUsername(null);
      setDisplayName(null);
      setUnread(0);
      setAccounts([]);
      return;
    }
    let cancelled = false;
    const load = () => {
      getMyProfile().then(({ data }) => {
        if (cancelled) return;
        const p = data as { username?: string | null; display_name?: string | null } | null;
        setUsername(p?.username ?? null);
        setDisplayName(p?.display_name ?? null);
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
        const received = (data?.received ?? []).filter(
          (d) => d.scope_type === "account" && d.status === "active"
        );
        setAccounts(received);
      })
      .finally(() => {
        inflight.current = false;
      });
  }, [loggedIn]);

  const NAV: NavItem[] = [
    { key: "nav.upload", href: "/upload", match: (p) => p.startsWith("/upload") },
    { key: "nav.profile", href: profileHref, match: (p) => p.startsWith("/u/") || p === "/onboarding/identity" },
    { key: "nav.notifications", href: "/notifications", match: (p) => p.startsWith("/notifications") },
    { key: "nav.messages", href: "/my/messages", match: (p) => p.startsWith("/my/messages") },
    { key: "nav.insights", href: "/my", match: (p) => p === "/my" },
    { key: "nav.explore", href: "/feed?tab=all&sort=latest", match: (p) => p.startsWith("/feed") },
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

  const ownName = displayName || (username ? `@${username}` : t("acting.switcher.myAccount"));

  return (
    <nav
      aria-label="Primary"
      className="flex h-full min-h-screen flex-col gap-8 py-8 pr-6 text-[15px]"
    >
      <Link href="/feed?tab=all&sort=latest" className="text-3xl font-extrabold tracking-tight text-zinc-900">
        Theo
      </Link>

      <div className="flex flex-col gap-1">
        {NAV.map((item) => {
          const active = item.match(pathname);
          const showBadge = item.key === "nav.notifications" && unread > 0;
          return (
            <Link
              key={item.key}
              href={item.href}
              className={`group flex items-center justify-between rounded-md py-1.5 pr-2 transition-colors ${
                active ? "font-bold text-zinc-900" : "text-zinc-600 hover:text-zinc-900"
              }`}
            >
              <span>{t(item.key)}</span>
              {showBadge && (
                <span className="ml-2 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <div className="mt-auto flex flex-col gap-4">
        <div className="flex items-center gap-3 text-xs text-zinc-400">
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

        <Link
          href="/settings"
          className={`${pathname === "/settings" ? "font-bold text-zinc-900" : "text-zinc-600 hover:text-zinc-900"}`}
        >
          {t("nav.setting")}
        </Link>
        {/*
          QA 2026-07-29 (Track δ) — 이중언어 정리 대시보드로의 진입점.
          "설정" 하위의 얕은 링크로 붙이며, /settings/bilingual 로 이동.
          로그인 여부와 무관하게 링크는 표시되지만 페이지 자체는 `AuthGate`
          로 보호된다.
        */}
        <Link
          href="/settings/bilingual"
          className={`text-xs ${pathname === "/settings/bilingual" ? "font-semibold text-zinc-900" : "text-zinc-500 hover:text-zinc-800"}`}
        >
          {t("bilingual.dashboard.settingsNavLabel")}
        </Link>

        {loggedIn ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-zinc-500">{t("nav.switchAccount")}</p>
            <ul className="flex flex-col gap-1.5">
              <li>
                <button
                  type="button"
                  onClick={switchToOwn}
                  className="flex w-full items-center gap-2 text-left"
                >
                  <span
                    aria-hidden
                    className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
                      !actingAsProfileId ? "bg-amber-400" : "bg-zinc-200"
                    }`}
                  />
                  <span className={`truncate text-sm ${!actingAsProfileId ? "font-semibold text-zinc-900" : "text-zinc-500"}`}>
                    {ownName}
                  </span>
                </button>
              </li>
              {accounts.map((d) => {
                const p = d.delegator_profile;
                const label = p ? formatDisplayName(p) || formatUsername(p) : "—";
                const active = actingAsProfileId === p?.id;
                return (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => switchToPrincipal(d)}
                      className="flex w-full items-center gap-2 text-left"
                    >
                      <span
                        aria-hidden
                        className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
                          active ? "bg-amber-400" : "bg-zinc-200"
                        }`}
                      />
                      <span className={`truncate text-sm ${active ? "font-semibold text-zinc-900" : "text-zinc-500"}`}>
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
          <Link href="/login" className="text-zinc-600 hover:text-zinc-900">
            {t("nav.login")}
          </Link>
        )}
      </div>
    </nav>
  );
}
