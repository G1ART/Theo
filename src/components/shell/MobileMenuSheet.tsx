"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ShellNavLink } from "@/components/shell/ShellNavLink";
import { useActingAs } from "@/context/ActingAsContext";
import { useRoleMode } from "@/context/RoleModeContext";
import { ownAccountProfileHref } from "@/lib/delegation/principalProfileHref";
import { useT } from "@/lib/i18n/useT";
import { pickLocalizedDisplayName } from "@/lib/i18n/pickLocalized";
import { isPlaceholderUsername } from "@/lib/identity/placeholder";
import { loginUrlWithNext, onboardingUrlWithNext } from "@/lib/identity/routing";
import {
  bulletinHasUnread,
  markBulletinSeen,
  readBulletinSeenAt,
} from "@/lib/shell/bulletinSeen";
import { leaveUploadOrAssign } from "@/lib/shell/leaveUploadNav";
import { shellRoleProfileLabel } from "@/lib/shell/roleMode";
import { getArtworkImageUrl } from "@/lib/supabase/artworks";
import { signOut } from "@/lib/supabase/auth";
import { getUnreadConnectionMessageCount } from "@/lib/supabase/connectionMessages";
import { getMyProfile } from "@/lib/supabase/profiles";
import { getLatestTheoBoardPublishedAt } from "@/lib/supabase/theoBoard";

/**
 * Phone and tablet menu. Same destinations as the desktop sidebar,
 * laid out as rows in the existing hamburger sheet. The account
 * block expands inside this sheet. It is not the desktop card.
 */

type RowKey =
  | "network"
  | "bulletin"
  | "messages"
  | "notifications"
  | "dashboard"
  | "selections";

const ROWS: { key: RowKey; href: string; labelKey: string; gated: boolean }[] = [
  { key: "network", href: "/my/network", labelKey: "nav.network", gated: true },
  { key: "bulletin", href: "/theo-board", labelKey: "shell.nav.bulletin", gated: false },
  { key: "messages", href: "/my/messages", labelKey: "nav.messages", gated: true },
  { key: "notifications", href: "/notifications", labelKey: "nav.notifications", gated: false },
  { key: "dashboard", href: "/my", labelKey: "shell.nav.dashboard", gated: true },
  { key: "selections", href: "/my/shortlists", labelKey: "shell.nav.selections", gated: true },
];

function rowActive(key: RowKey, pathname: string): boolean {
  if (key === "dashboard") return pathname === "/my";
  if (key === "network") return pathname.startsWith("/my/network");
  if (key === "bulletin") return pathname.startsWith("/theo-board");
  if (key === "messages") return pathname.startsWith("/my/messages");
  if (key === "notifications") return pathname.startsWith("/notifications");
  return pathname.startsWith("/my/shortlists");
}

function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-2 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function MobileMenuSheet({
  loggedIn,
  username,
  avatarUrl,
  notificationUnread,
  onNavigate,
}: {
  loggedIn: boolean;
  username: string | null;
  avatarUrl: string | null;
  notificationUnread: number;
  onNavigate: () => void;
}) {
  const { t, locale, setLocale } = useT();
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const { clearActingAs } = useActingAs();
  const { ready: roleReady, activeRole, heldRoles, setRole } = useRoleMode();
  const [accountOpen, setAccountOpen] = useState(false);
  const [messageUnread, setMessageUnread] = useState(0);
  const [bulletinUnread, setBulletinUnread] = useState(false);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [displayNameKo, setDisplayNameKo] = useState<string | null>(null);
  const [displayNameEn, setDisplayNameEn] = useState<string | null>(null);

  useEffect(() => {
    if (!loggedIn) return;
    let cancelled = false;
    getUnreadConnectionMessageCount().then((count) => {
      if (!cancelled) setMessageUnread(count);
    });
    getMyProfile().then(({ data }) => {
      if (cancelled || !data) return;
      setDisplayName(data.display_name ?? null);
      setDisplayNameKo(data.display_name_ko ?? null);
      setDisplayNameEn(data.display_name_en ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [loggedIn]);

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

  function hrefFor(path: string, gated: boolean): string {
    if (!gated || loggedIn) return path;
    return onboardingUrlWithNext({ nextPath: path });
  }

  function renderRow(key: RowKey) {
    const item = ROWS.find((row) => row.key === key);
    if (!item) return null;
    const active = rowActive(key, pathname);
    return (
      <ShellNavLink
        key={key}
        data-mobile-item={key}
        href={hrefFor(item.href, item.gated)}
        onClick={onNavigate}
        className={`flex items-center justify-between px-1 py-2 text-sm transition-colors ${
          active ? "font-semibold text-zinc-900" : "text-zinc-600 hover:text-zinc-900"
        }`}
      >
        <span>{t(item.labelKey)}</span>
        {key === "messages" ? <CountBadge count={messageUnread} /> : null}
        {key === "notifications" ? <CountBadge count={notificationUnread} /> : null}
        {key === "bulletin" && bulletinUnread ? (
          <span aria-hidden className="ml-2 h-2 w-2 shrink-0 rounded-full bg-emerald-600" />
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
  const avatarSrc = avatarUrl
    ? avatarUrl.startsWith("http")
      ? avatarUrl
      : getArtworkImageUrl(avatarUrl, "avatar")
    : null;

  async function handleLogout() {
    onNavigate();
    clearActingAs();
    await signOut();
    if (leaveUploadOrAssign(pathname, "/login")) return;
    router.replace("/login");
  }

  const localePill = (active: boolean) =>
    `rounded-full px-2.5 py-0.5 text-xs ${
      active ? "bg-zinc-900 font-medium text-white" : "text-zinc-500 hover:text-zinc-800"
    }`;

  return (
    <nav data-mobile-sheet className="flex flex-col gap-1 p-4">
      <ShellNavLink
        data-mobile-item="upload"
        href={hrefFor("/upload", true)}
        onClick={onNavigate}
        className="mb-2 inline-flex w-full items-center justify-center gap-1 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
      >
        <span aria-hidden>+</span>
        {t("nav.upload")}
      </ShellNavLink>

      {renderRow("network")}
      {renderRow("bulletin")}
      {renderRow("messages")}
      {renderRow("notifications")}

      <div className="mt-2 border-t border-zinc-100 pt-2">
        <p className="px-1 pb-1 text-[11px] font-medium tracking-[0.16em] text-zinc-400">
          MY THEO
        </p>
        {renderRow("dashboard")}
        {renderRow("selections")}
      </div>

      {loggedIn ? (
        <div className="mt-2 border-t border-zinc-100 pt-2">
          <button
            type="button"
            data-mobile-account
            aria-expanded={accountOpen}
            onClick={() => setAccountOpen((open) => !open)}
            className="flex w-full items-center gap-2 px-1 py-2 text-left"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-200 bg-zinc-100 text-[11px] font-medium text-zinc-500">
              {avatarSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarSrc} alt="" className="h-full w-full object-cover" />
              ) : (
                <span>{initial}</span>
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-zinc-900">{name}</span>
              {roleLine ? (
                <span className="block truncate text-xs text-zinc-500">{roleLine}</span>
              ) : null}
            </span>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
              className={`shrink-0 text-zinc-400 transition-transform ${accountOpen ? "rotate-90" : ""}`}
            >
              <path
                d="m9 6 6 6-6 6"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {accountOpen ? (
            <div data-mobile-account-panel className="flex flex-col gap-1 px-1 pb-2">
              {heldRoles.length > 0 ? (
                <div className="py-1">
                  <p className="text-[11px] font-medium tracking-wide text-zinc-500">
                    {t("shell.switchProfile")}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {heldRoles.map((role) => {
                      const selected = activeRole === role;
                      return (
                        <button
                          key={role}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setRole(role)}
                          className={`rounded-full px-3 py-1 text-xs ${
                            selected
                              ? "bg-zinc-900 font-medium text-white"
                              : "border border-zinc-200 bg-white text-zinc-700"
                          }`}
                        >
                          {t(`shell.role.${role}`)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              <ShellNavLink
                href={ownAccountProfileHref(username)}
                onClick={onNavigate}
                className="py-2 text-sm text-zinc-800"
              >
                {t("shell.viewPublicProfile")}
              </ShellNavLink>
              <ShellNavLink
                href="/settings"
                onClick={onNavigate}
                className="py-2 text-sm text-zinc-800"
              >
                {t("shell.settings")}
              </ShellNavLink>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-zinc-800">{t("shell.language")}</span>
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
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="py-2 text-left text-sm text-zinc-800"
              >
                {t("nav.logout")}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2 px-1">
          <div className="flex items-center justify-between text-xs text-zinc-500">
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
            onClick={onNavigate}
            className="inline-flex items-center justify-center rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
          >
            {t("nav.getStarted")}
          </ShellNavLink>
          <ShellNavLink
            href={loginUrlWithNext({ nextPath: pathname || null })}
            onClick={onNavigate}
            className="inline-flex items-center justify-center rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            {t("nav.login")}
          </ShellNavLink>
        </div>
      )}
    </nav>
  );
}
