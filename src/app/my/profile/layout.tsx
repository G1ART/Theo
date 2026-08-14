import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";

/**
 * Wraps `/my/profile/*` (CV editor today) with the 3-column AppShell
 * so public-profile editing does not drop the artist out of the
 * workspace chrome.
 */
export default function MyProfileLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
