"use client";

import Link from "next/link";
import { backToLabel } from "@/lib/i18n/back";
import { useT } from "@/lib/i18n/useT";

/** Subpages of `/my/ops` always return to the ops hub, not `/my`. */
export function OpsBackLink() {
  const { t, locale } = useT();
  return (
    <Link
      href="/my/ops"
      className="mb-6 inline-block text-sm text-zinc-600 hover:text-zinc-900"
    >
      ← {backToLabel(t("workspace.ops.title"), locale)}
    </Link>
  );
}
