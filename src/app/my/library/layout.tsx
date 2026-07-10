import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { LibraryRail } from "@/components/shell/context/LibraryRail";

/**
 * Wraps /my/library (and /my/library/import) with the 3-column shell.
 * Rail summarizes total/public/draft counts and offers quick-import
 * shortcuts; the filter panel in the main column is untouched.
 */
export default function LibraryLayout({ children }: { children: ReactNode }) {
  return <AppShell rightRail={<LibraryRail />}>{children}</AppShell>;
}
