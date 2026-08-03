import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";

/**
 * Wraps `/my/claims` (Ownership) with the 3-column AppShell (Aug-2026
 * redesign). Uses the default right rail.
 */
export default function ClaimsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
