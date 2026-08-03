import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";

/**
 * Wraps `/my/exhibitions/*` with the 3-column AppShell (Aug-2026 redesign).
 * Uses the default right rail so the workspace-adjacent surfaces render
 * consistently. `/my/exhibitions/[id]/edit` inherits automatically.
 */
export default function MyExhibitionsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
