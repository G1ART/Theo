"use client";

/**
 * Shared "Switch Account" block used by the desktop sidebar, the mobile
 * hamburger panel, and the tablet+ avatar dropdown. Before this
 * extraction the same ~120 lines of switcher JSX lived in both
 * `AppSidebar.tsx` and `Header.tsx`, and the two copies had already
 * begun to drift (i18n keys, ordering, extra affordances). The wireframe
 * intent is that all three surfaces render the same data — visual
 * chrome differs by container, not by copy.
 *
 * The public API is a thin data prop bundle plus a `layout` discriminator
 * so callers stay honest about the surface they're rendering into. The
 * component itself owns the small conditional blocks that differ by
 * layout (avatar disc vs. dot indicator, own-row link vs. radio button,
 * etc.).
 *
 * "View my public profile →" secondary affordance under the self-row is
 * intentionally sidebar-only. On dropdown/hamburger the own row is a
 * pure "switch back to my persona" selector and takes the user back to
 * `/my`; the public profile is reached by tapping the mobile avatar
 * (which now navigates to `/u/{username}` directly) or the sidebar
 * self-row.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/supabase/auth";
import { useT } from "@/lib/i18n/useT";
import { useActingAs } from "@/context/ActingAsContext";
import { isPlaceholderUsername } from "@/lib/identity/placeholder";
import {
  formatDisplayName,
  formatUsername,
  type IdentityInput,
} from "@/lib/identity/format";
import { getArtworkImageUrl } from "@/lib/supabase/artworks";
import type { DelegationWithDetails } from "@/lib/supabase/delegations";

type Layout = "sidebar" | "hamburger" | "dropdown";

type Props = {
  layout: Layout;
  username: string | null;
  displayName?: string | null;
  avatarUrl: string | null;
  accounts: DelegationWithDetails[];
  /** True once the caller has finished loading the principals list.
   *  Used together with `accounts.length` and `actingAsProfileId` to
   *  decide whether to render at all — solo users see no switcher. */
  accountsLoaded: boolean;
  /** Optional: hamburger closes itself after any nav click. */
  onNavigate?: () => void;
};

/**
 * Small circular avatar disc with an optional dot indicator, used by
 * the sidebar layout. The outer wrapper is `relative` (without
 * `overflow-hidden`) so the status dot can sit outside the circular
 * clip; the crop is applied only to the inner image wrapper.
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

export function AccountSwitcher({
  layout,
  username,
  displayName,
  avatarUrl,
  accounts,
  accountsLoaded,
  onNavigate,
}: Props) {
  const { t, locale } = useT();
  const router = useRouter();
  const {
    actingAsProfileId,
    actingAsLabel,
    setActingAs,
    clearActingAs,
  } = useActingAs();

  const isPlaceholder = isPlaceholderUsername(username);
  const profileHref =
    !username || isPlaceholder ? "/onboarding/identity" : `/u/${username}`;
  const ownName =
    displayName || (username ? `@${username}` : t("acting.switcher.myAccount"));

  const hasSwitchableAccounts =
    (accountsLoaded && accounts.length > 0) || !!actingAsProfileId;

  function switchToOwn() {
    clearActingAs();
    onNavigate?.();
    router.push("/my");
    router.refresh();
  }

  function switchToPrincipal(d: DelegationWithDetails) {
    const p = d.delegator_profile;
    if (!p?.id) return;
    setActingAs(
      p.id,
      formatDisplayName(p as IdentityInput, t, locale) || formatUsername(p),
    );
    onNavigate?.();
    router.push("/my");
    router.refresh();
  }

  async function handleLogout() {
    onNavigate?.();
    await signOut();
    router.replace("/login");
  }

  // ── Sidebar layout ────────────────────────────────────────────────
  // Bordered "card" in the fixed-width rail. The own row navigates to
  // the public profile when the user is not currently acting-as; the
  // secondary "View my public profile →" affordance surfaces the
  // destination so users actually click it (QA 2026-08-04). When
  // acting-as is active the same tap gesture switches back to their
  // own persona first (safer than jumping straight into another
  // identity's public profile).
  if (layout === "sidebar") {
    return (
      <div className="mt-3 flex flex-col gap-2 pl-3">
        <p className="text-sm text-zinc-500">{t("nav.switchAccount")}</p>
        <ul className="flex flex-col gap-1.5">
          <li>
            <button
              type="button"
              onClick={() => {
                if (actingAsProfileId) {
                  switchToOwn();
                } else {
                  onNavigate?.();
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
              ? formatDisplayName(p as IdentityInput, t, locale) ||
                formatUsername(p)
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
                      p?.username ? p.username.charAt(0).toUpperCase() : "?"
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
    );
  }

  // ── Hamburger layout ─────────────────────────────────────────────
  // Full-width rows inside the mobile drawer. Own row is a "switch back
  // to my persona" radio selector — the public profile is reachable by
  // tapping the avatar in the header, not through this switcher.
  if (layout === "hamburger") {
    return (
      <div className="flex flex-col">
        {hasSwitchableAccounts && (
          <>
            <div className="my-2 border-t border-zinc-100" />
            <div className="px-1 pt-1 pb-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
              {t("nav.switchAccount")}
            </div>
            <button
              type="button"
              onClick={switchToOwn}
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
                  {username ? `@${username}` : t("acting.switcher.myAccount")}
                </span>
                {!actingAsProfileId && (
                  <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">
                    {t("acting.switcher.activeChip")}
                  </span>
                )}
              </span>
            </button>
            {accounts.map((d) => {
              const p = d.delegator_profile;
              if (!p?.id) return null;
              const name =
                formatDisplayName(p as IdentityInput, t, locale) ||
                formatUsername(p) ||
                p.username ||
                p.id;
              const isActive = actingAsProfileId === p.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => switchToPrincipal(d)}
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
        <button
          type="button"
          onClick={handleLogout}
          className="text-left py-2 px-1 text-sm text-red-600 hover:text-red-700"
        >
          {t("nav.logout")}
        </button>
      </div>
    );
  }

  // ── Dropdown layout ──────────────────────────────────────────────
  // Constrained menu width in the tablet+ avatar popover. Same
  // radio-selector own-row semantics as the hamburger. Solo users see
  // no switcher block at all (would be visual debt).
  return (
    <>
      {hasSwitchableAccounts && (
        <>
          <div className="px-4 pt-1 pb-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
            {t("nav.switchAccount")}
          </div>
          <button
            type="button"
            onClick={switchToOwn}
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
                {username ? `@${username}` : t("acting.switcher.myAccount")}
              </span>
              {!actingAsProfileId && (
                <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">
                  {t("acting.switcher.activeChip")}
                </span>
              )}
            </span>
          </button>
          {accounts.map((d) => {
            const p = d.delegator_profile;
            if (!p?.id) return null;
            const name =
              formatDisplayName(p as IdentityInput, t, locale) ||
              formatUsername(p) ||
              p.username ||
              p.id;
            const isActive = actingAsProfileId === p.id;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => switchToPrincipal(d)}
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
      )}
      <button
        type="button"
        onClick={handleLogout}
        className="block w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
        role="menuitem"
      >
        {t("nav.logout")}
      </button>
    </>
  );
}
