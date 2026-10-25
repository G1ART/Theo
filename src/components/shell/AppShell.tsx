"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AppSidebar } from "./AppSidebar";
import { RightRail } from "./RightRail";
import { NotificationsDrawer } from "@/components/notifications/NotificationsDrawer";
import { layer } from "@/lib/ui/layers";
import { useT } from "@/lib/i18n/useT";
import { disarmListScrollReturn } from "@/lib/list/scrollRestore";

/**
 * Wide-screen search. It grows left from the right-rail search slot and
 * stops at the viewport center, so the left menu stays put. It is fixed
 * to the same top inset as that slot (`top-8`, matching the rail and
 * sidebar padding) and does not add a bar above the shell.
 */
function SearchSpanBar() {
  const router = useRouter();
  const params = useSearchParams();
  const { t } = useT();
  const qFromUrl = params.get("q") ?? "";
  const [q, setQ] = useState(qFromUrl);

  useEffect(() => {
    setQ(qFromUrl);
  }, [qFromUrl]);

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const query = q.trim();
    disarmListScrollReturn();
    router.replace(query ? `/search?q=${encodeURIComponent(query)}` : "/search");
  }

  return (
    <form
      data-search-span
      role="search"
      onSubmit={onSubmit}
      className={`pointer-events-auto fixed top-8 z-30 hidden w-[calc(min(50vw,720px)-1.5rem)] lg:block ${layer.chrome}`}
      style={{ left: "50vw" }}
    >
      <input
        type="search"
        value={q}
        onChange={(event) => setQ(event.target.value)}
        placeholder={t("shell.searchPlaceholder")}
        aria-label={t("shell.searchPlaceholder")}
        className="w-full rounded-full border border-zinc-300 bg-white py-2 pl-4 pr-10 text-sm text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none"
      />
      <button
        type="submit"
        aria-label={t("shell.searchSubmit")}
        className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-zinc-500 hover:text-zinc-900"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </form>
  );
}

/**
 * Theo 3-column app shell (Aug-2026 redesign).
 *
 * Layout:
 *   - lg+  : [ left sidebar | center content | right rail (xl+) ]
 *   - < lg : center content only — the global top Header + hamburger
 *            (kept in the root layout, hidden on desktop for shell
 *            routes) handles mobile navigation, so we don't duplicate
 *            it here.
 *
 * `rightRail`:
 *   - `true`  (default) — render the shared "My Connection + Theo Board"
 *     RightRail introduced with this redesign.
 *   - `false` — drop the right column entirely.
 *   - ReactNode — render a page-specific *context* rail (e.g. LibraryRail).
 *     Kept in the same sticky slot so visual rhythm reads as one language
 *     across the platform. Rail components should stay side-effect free /
 *     self-fetching so they don't couple to the main column's state.
 *
 * The sidebar owns a "Notifications" click handler that opens a
 * left-anchored drawer (portal-free); we hoist that state here so the
 * drawer renders outside the sticky sidebar clipping context and can
 * layer above the center column. It stays on the menu layer, under
 * any full-viewport scrim.
 *
 * Sidebar and right rail share `layer.chrome`, above the center
 * column. A modal that must dim them portals to `document.body` on
 * `layer.scrim` — a fixed child of the center column cannot, because
 * this column clips overflow and owns a lower stacking context.
 */
export function AppShell({
  children,
  rightRail = true,
}: {
  children: ReactNode;
  rightRail?: ReactNode | boolean;
}) {
  const showRail = rightRail !== false;
  const railNode =
    rightRail === true || rightRail === false ? <RightRail /> : rightRail;

  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer whenever the underlying route changes — matches
  // the "clicking another nav item closes it" rule from the spec, and
  // avoids stale badge state after navigation. The eslint rule warns
  // about setState-in-effect but this IS the pattern React recommends
  // for resetting UI state in response to a URL change.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrawerOpen(false);
  }, [pathname]);

  return (
    <div className="relative mx-auto flex w-full max-w-[1440px]">
      <aside className={`relative ${layer.chrome} hidden w-52 shrink-0 pl-6 pointer-events-auto lg:block`}>
        <div className="sticky top-0 max-h-screen overflow-y-auto">
          <AppSidebar onOpenNotifications={() => setDrawerOpen(true)} />
        </div>
      </aside>

      {/* Center keeps each page's own <main>/container (padding, max-width,
          centering), so wrapping a page in <AppShell> needs no internal edits
          and avoids nested <main> landmarks. content layer + clip so a wide
          child cannot paint over the rails and steal nav clicks. */}
      <div className={`relative ${layer.content} min-w-0 flex-1 overflow-x-clip`}>{children}</div>

      {showRail && (
        <aside className={`relative ${layer.chrome} hidden w-[340px] shrink-0 pr-6 xl:block`}>
          <div className="sticky top-0 max-h-screen overflow-y-auto">
            {railNode}
          </div>
        </aside>
      )}

      {pathname === "/search" ? (
        <Suspense fallback={null}>
          <SearchSpanBar />
        </Suspense>
      ) : null}

      <NotificationsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
