import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";

/**
 * Wraps `/my/delegations` with the 3-column AppShell (Aug-2026 redesign).
 * Delegations is promoted to a top-level nav item in this cycle; the
 * page UI itself is unchanged.
 */
export default function DelegationsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
