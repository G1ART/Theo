import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { NetworkRail } from "@/components/shell/context/NetworkRail";

/**
 * Wraps /my/network with the 3-column shell. The rail carries a
 * followers/following/pending-requests summary; the page itself keeps
 * its four-tab hub so nothing about the primary workflow changes.
 */
export default function NetworkLayout({ children }: { children: ReactNode }) {
  return <AppShell rightRail={<NetworkRail />}>{children}</AppShell>;
}
