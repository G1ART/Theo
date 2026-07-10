import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { ShortlistsRail } from "@/components/shell/context/ShortlistsRail";

/**
 * Wraps /my/shortlists (index + detail) with the 3-column shell.
 * Rail carries a room-count summary; the detail page keeps its rich
 * share / promote / pitch-pack surface in the main column.
 */
export default function ShortlistsLayout({ children }: { children: ReactNode }) {
  return <AppShell rightRail={<ShortlistsRail />}>{children}</AppShell>;
}
