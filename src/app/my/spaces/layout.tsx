import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";

/**
 * Wraps `/my/spaces` (list + editor) with the shared 3-column shell so
 * the sidebar, hamburger, and hangar of Chunk C surfaces read as one
 * space. `rightRail={false}` for both list and editor — the list uses
 * the center column entirely for the space grid, and the editor
 * hosts its own inspector rail on the right (see SpaceEditor).
 */
export default function SpacesLayout({ children }: { children: ReactNode }) {
  return <AppShell rightRail={false}>{children}</AppShell>;
}
