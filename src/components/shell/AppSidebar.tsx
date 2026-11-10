"use client";

import { ShellNavLink } from "@/components/shell/ShellNavLink";
import { TheoLogo } from "@/components/brand/TheoLogo";
import { DesktopAccountMenu, MENU_ID } from "@/components/shell/DesktopAccountMenu";
import { useRoleMode } from "@/context/RoleModeContext";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { getMyProfile } from "@/lib/supabase/profiles";
import { getUnreadCount } from "@/lib/supabase/notifications";
import { getUnreadConnectionMessageCount } from "@/lib/supabase/connectionMessages";
import { getLatestTheoBoardPublishedAt } from "@/lib/supabase/theoBoard";
import { useT } from "@/lib/i18n/useT";
import { pickLocalizedDisplayName } from "@/lib/i18n/pickLocalized";
import {
  feedHomeHref,
  loginUrlWithNext,
  onboardingUrlWithNext,
} from "@/lib/identity/routing";
import { isPlaceholderUsername } from "@/lib/identity/placeholder";
import { getArtworkImageUrl } from "@/lib/supabase/artworks";
import {
  bulletinHasUnread,
  markBulletinSeen,
  readBulletinSeenAt,
} from "@/lib/shell/bulletinSeen";
import { shellRoleProfileLabel } from "@/lib/shell/roleMode";

/**
 * Desktop left navigation (`lg+` only). The hamburger below `lg`
 * keeps its own list and is not this menu.
 *
 *   Logo            → feed home
 *   + Upload        → /upload (no role menu)
 *   Network
 *   Theo Bulletin   → green dot only when a post is unread
 *   Messages        → unread count
 *   Notifications   → unread count, opens the drawer
 *   MY THEO
 *   Dashboard       → /my
 *   Selections      → /my/shortlists
 *   Account row     → secondary card (role view, public profile,
 *                     settings, language, log out)
 */

type SideKey =
  | "network"
  | "bulletin"
  | "messages"
  | "notifications"
  | "dashboard"
  | "selections";

const SIDE_ROWS: {
  key: SideKey;
  href: string;
  labelKey: string;
  gated: boolean;
}[] = [
  { key: "network", href: "/my/network", labelKey: "nav.network", gated: true },
  { key: "bulletin", href: "/theo-board", labelKey: "shell.nav.bulletin", gated: false },
  { key: "messages", href: "/my/messages", labelKey: "nav.messages", gated: true },
  { key: "notifications", href: "/notifications", labelKey: "nav.notifications", gated: false },
  { key: "dashboard", href: "/my", labelKey: "shell.nav.dashboard", gated: true },
  { key: "selections", href: "/my/shortlists", labelKey: "shell.nav.selections", gated: true },
];

function sideActive(key: SideKey, pathname: string): boolean {
  if (key === "dashboard") return pathname === "/my";
  if (key === "network") return pathname.startsWith("/my/network");
  if (key === "bulletin") return pathname.startsWith("/theo-board");
  if (key === "messages") return pathname.startsWith("/my/messages");
  if (key === "notifications") return pathname.startsWith("/notifications");
  if (key === "selections") return pathname.startsWith("/my/shortlists");
  return false;
}

function RowIcon({ name }: { name: SideKey }) {
  // Traced from the sidebar wire, in that drawing's pixel proportions.
  // A square 14px slot matches the menu type; meet keeps each drawing's ratio.
  const frame = {
    width: 14,
    height: 14,
    fill: "none" as const,
    "aria-hidden": true as const,
    className: "shrink-0",
  };
  const stroke = {
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (name === "network") {
    return (
      <svg {...frame} viewBox="0 0 12 9.4">
        <g {...stroke} strokeWidth="1.05">
          <circle cx="2.35" cy="2.2" r="1.6" />
          <circle cx="9.45" cy="2.2" r="1.6" />
          <circle cx="5.9" cy="6.85" r="1.55" />
          <path d="M3.28 3.48 4.92 5.48M8.52 3.48 6.88 5.48" />
        </g>
      </svg>
    );
  }
  if (name === "bulletin") {
    return (
      <svg {...frame} viewBox="0 0 12 12">
        <g {...stroke} strokeWidth="1.05">
          <rect x="0.9" y="0.9" width="10.2" height="10.2" rx="0.75" />
          <path d="M3.75 3.75h4.5M3.75 6h4.5M3.75 8.25h4.5" />
        </g>
      </svg>
    );
  }
  if (name === "messages") {
    return (
      <svg {...frame} viewBox="0 0 12 9.4">
        <path
          d="M2.35.95H9.45Q10.85.95 10.85 2.35V6.55L10.45 8.15 9.05 7.35H2.35Q.95 7.35.95 5.95V2.35Q.95.95 2.35.95Z"
          {...stroke}
          strokeWidth="1.05"
        />
      </svg>
    );
  }
  if (name === "notifications") {
    return (
      <svg {...frame} viewBox="0 0 11 12">
        <g {...stroke} strokeWidth="1.05">
          <path d="M5.5.8C4.15 1.15 3.3 2.4 2.9 3.8L2.45 6.95C2.3 7.6 2.1 7.95 1.75 8.15h7.5c-.35-.2-.55-.55-.7-1.2L8.1 3.8C7.7 2.4 6.85 1.15 5.5.8Z" />
          <path d="M4.15 8.9q1.35 1.05 2.7 0" />
        </g>
      </svg>
    );
  }
  if (name === "dashboard") {
    return (
      <svg {...frame} viewBox="0 0 12 12">
        <g {...stroke} strokeWidth="1.05">
          <rect x="0.75" y="0.75" width="4.7" height="4.7" rx="0.65" />
          <rect x="6.4" y="0.75" width="4.7" height="4.7" rx="0.65" />
          <rect x="0.75" y="6.4" width="4.7" height="4.7" rx="0.65" />
          <rect x="6.4" y="6.4" width="4.7" height="4.7" rx="0.65" />
        </g>
      </svg>
    );
  }
  return (
    <svg {...frame} viewBox="0 0 10 10.4">
      <path
        d="M2.05 1.05h5.8q1 0 1 1v7.05L5.45 8.25 1.05 9.1V2.05q0-1 1-1Z"
        {...stroke}
        strokeWidth="1.05"
      />
    </svg>
  );
}

function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-medium leading-none text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

function AccountAvatar({
  imageUrl,
  fallback,
}: {
  imageUrl: string | null;
  fallback: string;
}) {
  const src = imageUrl
    ? imageUrl.startsWith("http")
      ? imageUrl
      : getArtworkImageUrl(imageUrl, "avatar")
    : null;
  return (
    <span className="relative inline-block h-8 w-8 shrink-0">
      <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-zinc-200 bg-zinc-100 text-[11px] font-medium text-zinc-500">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="h-full w-full object-cover" />
        ) : (
          <span>{fallback}</span>
        )}
      </span>
      <span
        aria-hidden
        className="absolute -right-0.5 -top-0.5 inline-block h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-white"
      />
    </span>
  );
}

export function AppSidebar({
  onOpenNotifications,
}: {
  onOpenNotifications: () => void;
}) {
  const { t, locale, setLocale } = useT();
  const pathname = usePathname() ?? "";
  const { ready: roleReady, activeRole } = useRoleMode();

  const [session, setSession] = useState<Session | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [displayNameKo, setDisplayNameKo] = useState<string | null>(null);
  const [displayNameEn, setDisplayNameEn] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [messageUnread, setMessageUnread] = useState(0);
  const [bulletinUnread, setBulletinUnread] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const accountRef = useRef<HTMLButtonElement>(null);

  const loggedIn = !!session;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user?.id) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setUsername(null);
      setDisplayName(null);
      setDisplayNameKo(null);
      setDisplayNameEn(null);
      setAvatarUrl(null);
      setUnread(0);
      setMessageUnread(0);
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
          display_name_ko?: string | null;
          display_name_en?: string | null;
          avatar_url?: string | null;
        } | null;
        setUsername(p?.username ?? null);
        setDisplayName(p?.display_name ?? null);
        setDisplayNameKo(p?.display_name_ko ?? null);
        setDisplayNameEn(p?.display_name_en ?? null);
        setAvatarUrl(p?.avatar_url ?? null);
      });
      getUnreadCount().then(({ data }) => !cancelled && setUnread(data ?? 0));
      getUnreadConnectionMessageCount().then((count) => {
        if (!cancelled) setMessageUnread(count);
      });
    };
    load();
    window.addEventListener("profile-updated", load);
    const onRead = () => setUnread(0);
    window.addEventListener("notifications-read", onRead);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("profile-updated", load);
      window.removeEventListener("notifications-read", onRead);
      window.removeEventListener("focus", onFocus);
    };
  }, [session?.user?.id, pathname]);

  useEffect(() => {
    let cancelled = false;
    getLatestTheoBoardPublishedAt().then((latest) => {
      if (cancelled) return;
      if (pathname.startsWith("/theo-board")) {
        markBulletinSeen(latest);
        setBulletinUnread(false);
        return;
      }
      setBulletinUnread(bulletinHasUnread(latest, readBulletinSeenAt()));
    });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMenuOpen(false);
  }, [pathname]);

  const activeAccent =
    "bg-zinc-100 before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[2px] before:-translate-y-1/2 before:bg-zinc-900 before:content-['']";

  function hrefFor(path: string, gated: boolean): string {
    if (!gated || loggedIn) return path;
    return onboardingUrlWithNext({ nextPath: path });
  }

  const rowCls = (active: boolean) =>
    `relative flex h-[30px] items-center justify-between gap-2 rounded-md pl-3 pr-2.5 text-[12px] font-medium leading-none transition-colors ${
      active ? `text-zinc-900 ${activeAccent}` : "text-zinc-600 hover:text-zinc-900"
    }`;

  function renderRow(key: SideKey) {
    const item = SIDE_ROWS.find((row) => row.key === key);
    if (!item) return null;
    const active = sideActive(key, pathname);
    const label = (
      <span className="flex min-w-0 items-center gap-2.5">
        <RowIcon name={key} />
        <span className="truncate">{t(item.labelKey)}</span>
      </span>
    );
    if (key === "notifications" && loggedIn) {
      return (
        <button
          key={key}
          type="button"
          data-side-item={key}
          onClick={onOpenNotifications}
          className={`${rowCls(false)} w-full text-left`}
          aria-haspopup="dialog"
        >
          {label}
          <CountBadge count={unread} />
        </button>
      );
    }
    return (
      <ShellNavLink
        key={key}
        data-side-item={key}
        href={hrefFor(item.href, item.gated)}
        className={rowCls(active)}
      >
        {label}
        {key === "messages" ? <CountBadge count={messageUnread} /> : null}
        {key === "bulletin" && bulletinUnread ? (
          <span aria-hidden className="ml-auto size-[7px] shrink-0 rounded-full bg-emerald-600" />
        ) : null}
      </ShellNavLink>
    );
  }

  const name =
    pickLocalizedDisplayName(
      {
        display_name: displayName,
        display_name_ko: displayNameKo,
        display_name_en: displayNameEn,
      },
      locale,
    ) ||
    displayName ||
    (username ? `@${username}` : "");
  const roleLine = roleReady && activeRole ? shellRoleProfileLabel(activeRole, t) : null;
  const initial =
    username && !isPlaceholderUsername(username) ? username.charAt(0).toUpperCase() : "?";

  const localePill = (active: boolean) =>
    `rounded-full px-2.5 py-0.5 text-xs ${
      active ? "bg-zinc-900 font-medium text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
    }`;

  return (
    <nav
      aria-label="Primary"
      data-desktop-side-nav
      className="flex h-full min-h-screen flex-col py-8 pr-3 text-[15px]"
    >
      <ShellNavLink
        href={feedHomeHref(loggedIn)}
        data-side-item="logo"
        aria-label="Theo"
        className="inline-block leading-none text-zinc-900 transition-opacity hover:opacity-80"
      >
        <TheoLogo className="h-[31px]" size="md" priority />
      </ShellNavLink>

      <ShellNavLink
        data-side-item="upload"
        href={hrefFor("/upload", true)}
        className="mt-5 inline-flex h-[38px] w-full items-center justify-start gap-3 rounded-lg bg-zinc-900 pl-3 pr-4 text-[16px] font-bold leading-none text-white transition-colors hover:bg-zinc-800"
      >
        <span aria-hidden>+</span>
        {t("nav.upload")}
      </ShellNavLink>

      <div className="mt-2.5 flex flex-col">
        {renderRow("network")}
        {renderRow("bulletin")}
        {renderRow("messages")}
        {renderRow("notifications")}
      </div>

      <div className="mt-7 border-t border-zinc-300 pt-5">
        <p className="px-2.5 pb-2 text-[10px] font-medium tracking-[0.04em] text-zinc-400">
          MY THEO
        </p>
        <div className="flex flex-col">
          {renderRow("dashboard")}
          {renderRow("selections")}
        </div>
      </div>

      {loggedIn ? (
        <div className="mt-auto pt-4">
          <button
            ref={accountRef}
            type="button"
            data-side-account
            aria-expanded={menuOpen}
            aria-haspopup="dialog"
            aria-controls={MENU_ID}
            onClick={() => setMenuOpen((open) => !open)}
            className="relative z-10 flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md py-1.5 pl-1 pr-1 text-left hover:bg-zinc-50"
          >
            <AccountAvatar imageUrl={avatarUrl} fallback={initial} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-zinc-900">{name}</span>
              {roleLine ? (
                <span className="block truncate text-xs text-zinc-500">{roleLine}</span>
              ) : null}
            </span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0 text-zinc-400">
              <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <DesktopAccountMenu
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            anchorRef={accountRef}
            username={username}
          />
        </div>
      ) : (
        <div className="mt-auto flex flex-col gap-3 pt-6">
          <div className="flex items-center justify-between pl-3 pr-1 text-xs text-zinc-500">
            <span>{t("shell.language")}</span>
            <span className="flex items-center gap-1">
              <button type="button" onClick={() => setLocale("en")} className={localePill(locale === "en")}>
                EN
              </button>
              <button
                type="button"
                onClick={() => setLocale("ko")}
                className={localePill(locale.startsWith("ko"))}
              >
                한국어
              </button>
            </span>
          </div>
          <ShellNavLink
            href={onboardingUrlWithNext({ nextPath: pathname || null })}
            className="inline-flex items-center justify-center rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
          >
            {t("nav.getStarted")}
          </ShellNavLink>
          <ShellNavLink
            href={loginUrlWithNext({ nextPath: pathname || null })}
            className="inline-flex items-center justify-center rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            {t("nav.login")}
          </ShellNavLink>
        </div>
      )}
    </nav>
  );
}
