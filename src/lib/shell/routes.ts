/**
 * Routes that use the new 3-column AppShell (left nav + center + right rail),
 * introduced with the Theo wireframe redesign.
 *
 * On these routes the global top `Header` nav is hidden on desktop (lg+) so the
 * left sidebar can take over, while mobile keeps the proven Header + hamburger.
 * Keep this list in sync with the pages that actually wrap their content in
 * `<AppShell>` so the two never drift.
 */
const SHELL_PREFIXES = [
  "/artwork/",
  "/e/",
  "/u/",
  // Social / discovery surfaces unified into the shell (2026-07-10). Subroutes
  // (e.g. `/people/invite`, `/my/library/import`, `/my/shortlists/[id]`) also
  // adopt the shell — v1 accepts this consistency over per-subpage carve-outs.
  "/people",
  "/my/network",
  "/my/library",
  "/my/shortlists",
] as const;
const SHELL_EXACT = ["/feed"] as const;

export function isShellRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  if (SHELL_EXACT.includes(pathname as (typeof SHELL_EXACT)[number])) return true;
  if (pathname.startsWith("/feed")) return true; // /feed?tab=... etc.
  return SHELL_PREFIXES.some((p) => pathname.startsWith(p));
}
