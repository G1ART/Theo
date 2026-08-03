import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";

/**
 * Wraps `/my/messages/*` with the 3-column AppShell (Aug-2026 redesign).
 * Uses the default right rail — the messages page itself remains owned
 * by Worker C, so this shell is a pure chrome wrapper.
 */
export default function MessagesLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
