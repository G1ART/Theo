import type { ReactNode } from "react";
import { AppSidebar } from "./AppSidebar";
import { RightRail } from "./RightRail";

/**
 * Theo 3-column app shell (wireframe redesign).
 *
 * Layout:
 *   - lg+  : [ left sidebar | center content | right rail (xl+) ]
 *   - < lg : center content only — the global top Header + hamburger (kept
 *            in the root layout, hidden on desktop for shell routes) handles
 *            mobile navigation, so we don't duplicate it here.
 *
 * `rightRail`:
 *   - `true`  (default) — render the shared "Theo News + search" RightRail.
 *   - `false` — drop the right column entirely.
 *   - ReactNode — render a page-specific *context* rail (e.g. PeopleRail).
 *     Kept in the same sticky slot so visual rhythm reads as one language
 *     across the platform. Rail components should stay side-effect free /
 *     self-fetching so they don't couple to the main column's state.
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

  return (
    <div className="mx-auto flex w-full max-w-[1440px]">
      <aside className="hidden w-52 shrink-0 pl-6 lg:block">
        <div className="sticky top-0 max-h-screen overflow-y-auto">
          <AppSidebar />
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
    </div>
  );
}
