import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";

/**
 * Wraps `/notifications` with the 3-column AppShell so the full-history
 * page inherits the same left sidebar + default right rail as every
 * other primary surface (Aug-2026 redesign). The sidebar's own
 * "Notifications" click opens a compact drawer; users only land here
 * via the drawer's "See all →" link, deep-links, or mobile fallback.
 */
export default function NotificationsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
