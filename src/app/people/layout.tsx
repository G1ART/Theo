import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { PeopleRail } from "@/components/shell/context/PeopleRail";

/**
 * Wraps /people (and /people/invite) with the 3-column shell.
 * PeopleRail carries the persona-count summary on desktop; the sticky
 * mobile-first PersonaCountPanel inside PeopleClient stays visible
 * below the header on <lg screens.
 */
export default function PeopleLayout({ children }: { children: ReactNode }) {
  return <AppShell rightRail={<PeopleRail />}>{children}</AppShell>;
}
