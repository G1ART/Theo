/**
 * Single source of truth for the primary/secondary shell navigation.
 *
 * Consumed by:
 *  - `AppSidebar` (desktop `lg+` fixed rail)
 *  - `Header` MAIN_NAV strip (tablet `md`–`lg-1` horizontal)
 *  - `Header` mobile hamburger panel (`<md`)
 *  - `Header` avatar dropdown secondary section (`md+`)
 *
 * The desktop `AppSidebar` is canonical — the labels, hrefs, and match
 * patterns here MUST mirror what the sidebar already renders on `lg+`
 * so mobile/tablet stay perfectly in sync. When a nav row changes, edit
 * this file and every surface picks it up.
 *
 * Match patterns are simple `startsWith`-style prefixes evaluated at
 * consumption time; the sidebar's older `p === "/my"` exact check for
 * Workspace is preserved by using a dedicated `matchExact` list.
 *
 * `gated: true` means the destination requires an authenticated session.
 * Anonymous visitors get the row routed through the sign-up gate with
 * the destination preserved as `next` (see `onboardingUrlWithNext`).
 *
 * `badge` is a symbolic slot the surface resolves against its own state:
 *   - `"unread"`          → notification unread count
 *   - `"delegationsPending"` → pending inbound delegations count
 */
export type NavBadge = "delegationsPending" | "unread" | null;

export type NavItem = {
  key: string;
  href: string;
  labelKey: string;
  /** URL prefixes for active-state highlighting. */
  matchPatterns?: string[];
  /** Exact path matches (used only for Workspace `/my`). */
  matchExact?: string[];
  /** Requires an authenticated session. */
  gated?: boolean;
  badge?: NavBadge;
};

export const PRIMARY_NAV: NavItem[] = [
  {
    key: "explore",
    href: "/feed?tab=all&sort=latest",
    labelKey: "nav.explore",
    matchPatterns: ["/feed"],
  },
  {
    key: "messages",
    href: "/my/messages",
    labelKey: "nav.messages",
    matchPatterns: ["/my/messages"],
    gated: true,
  },
  {
    key: "workspace",
    href: "/my",
    labelKey: "nav.workspace",
    // Workspace hub only — sub-pages have their own nav slots
    // (Saved → /my/shortlists, Messages → /my/messages, etc.) so
    // any /my/xxx should NOT light up this entry.
    matchExact: ["/my"],
    gated: true,
  },
  {
    key: "saved",
    href: "/my/shortlists",
    labelKey: "nav.saved",
    matchPatterns: ["/my/shortlists"],
    gated: true,
  },
  {
    key: "upload",
    href: "/upload",
    labelKey: "nav.upload",
    matchPatterns: ["/upload"],
    gated: true,
  },
];

export const SECONDARY_NAV: NavItem[] = [
  {
    key: "notifications",
    href: "/notifications",
    labelKey: "nav.notifications",
    matchPatterns: ["/notifications"],
    badge: "unread",
  },
  {
    key: "settings",
    href: "/settings",
    labelKey: "nav.setting",
    matchExact: ["/settings"],
  },
  {
    key: "delegations",
    href: "/my/delegations",
    labelKey: "nav.delegations",
    matchPatterns: ["/my/delegations"],
    badge: "delegationsPending",
    gated: true,
  },
];

/** Test a pathname against a nav item's active-state rules. */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.matchExact?.some((m) => pathname === m)) return true;
  if (item.matchPatterns?.some((m) => pathname.startsWith(m))) return true;
  return false;
}
