"use client";

import Link from "next/link";
import { useEntryBack } from "@/hooks/useEntryBack";
import { backToLabel } from "@/lib/i18n/back";
import { useT } from "@/lib/i18n/useT";

/** "← {screen}" back to where this screen was opened from, else `fallback`. */
export function EntryBackLink({
  fallback,
  skip,
  className,
}: {
  fallback: string;
  skip?: (path: string) => boolean;
  className?: string;
}) {
  const { t, locale } = useT();
  const back = useEntryBack({ fallback, skip });
  return (
    <Link href={back.path} {...back.linkProps} className={className}>
      ← {backToLabel(t(back.labelKey), locale)}
    </Link>
  );
}
