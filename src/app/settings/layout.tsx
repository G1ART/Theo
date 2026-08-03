import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";

/**
 * Wraps `/settings/*` with the 3-column AppShell so the settings page
 * inherits the same left sidebar + default right rail as every other
 * primary surface (Aug-2026 redesign). Sub-routes (e.g. `/settings/bilingual`)
 * bubble up through this layout automatically.
 */
export default function SettingsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
