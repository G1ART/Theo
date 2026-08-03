"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { AppSidebar } from "./AppSidebar";
import { RightRail } from "./RightRail";
import { NotificationsDrawer } from "@/components/notifications/NotificationsDrawer";

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
 * layer above the center column.
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
    <div className="mx-auto flex w-full max-w-[1440px]">
      <aside className="hidden w-52 shrink-0 pl-6 lg:block">
        <div className="sticky top-0 max-h-screen overflow-y-auto">
          <AppSidebar onOpenNotifications={() => setDrawerOpen(true)} />
        </div>
      </aside>

      {/* Center keeps each page's own <main>/container (padding, max-width,
          centering), so wrapping a page in <AppShell> needs no internal edits
          and avoids nested <main> landmarks. */}
      <div className="min-w-0 flex-1">{children}</div>

      {showRail && (
        <aside className="hidden w-[340px] shrink-0 pr-6 xl:block">
          <div className="sticky top-0 max-h-screen overflow-y-auto">
            {railNode}
          </div>
        </aside>
      )}

      <NotificationsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
