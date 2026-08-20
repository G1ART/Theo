/**
 * Routes that use the 3-column AppShell (left nav + center + right rail),
 * introduced with the Theo wireframe redesign.
 *
 * On these routes the global top `Header` nav is hidden on desktop (lg+) so
 * the left sidebar can take over, while mobile keeps the proven Header +
 * hamburger. Keep this list in sync with the pages that actually wrap
 * their content in `<AppShell>` so the two never drift.
 *
 * 2026-08-03 (Phase A redesign): extended the prefix set so the whole
 * primary surface — Workspace hub, Notifications page, Settings, Upload,
 * and every `/my/*` sub-route — participates in the same shell. The
 * previous list carved out only a few discovery routes and left the
 * center-column pages inconsistent between plain and shell layouts.
 */
const SHELL_PREFIXES = [
  "/artwork/",
  "/e/",
  "/u/",
  "/people",
  // The entire `/my/*` surface now uses the shell (workspace hub +
  // library/shortlists/network/messages/inquiries/claims/exhibitions/
  // delegations/orphan-invites). Individual page routes still opt-in
  // by adding a `layout.tsx` — this predicate is only used to hide
  // the mobile Header on desktop.
  "/my",
  "/notifications",
  "/settings",
  "/upload",
  "/theo-board",
] as const;
const SHELL_EXACT = ["/feed"] as const;

export function isShellRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  if (SHELL_EXACT.includes(pathname as (typeof SHELL_EXACT)[number])) return true;
  if (pathname.startsWith("/feed")) return true;
  return SHELL_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * Front-door auth surfaces whose wireframes have no global chrome
 * (no top logo, no EN/KO + Login strip). The global `Header` returns
 * null on these routes so `/login` and `/signup` can own the full
 * canvas — matching the 2026-08 designer login/signup frames.
 *
 * `/onboarding/identity` is intentionally excluded: that's an
 * in-app finish step for signed-in users and still uses the shell.
 */
export function isAuthFrontDoorRoute(
  pathname: string | null | undefined,
): boolean {
  if (!pathname) return false;
  if (pathname === "/login" || pathname.startsWith("/login/")) return true;
  if (pathname === "/signup" || pathname.startsWith("/signup")) return true;
  if (pathname === "/onboarding") return true;
  return false;
}
