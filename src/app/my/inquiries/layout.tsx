import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";

/**
 * Wraps `/my/inquiries/*` with the 3-column AppShell (Aug-2026 redesign).
 * Uses the default right rail (My Connection + Theo Board) — the
 * inquiries surface has no dedicated context rail today.
 */
export default function InquiriesLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
