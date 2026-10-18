"use client";

import type { FollowRelation } from "@/lib/follow/relation";
import { useT } from "@/lib/i18n/useT";

type Props = {
  relation: FollowRelation | null;
  className?: string;
};

/** The viewer's follow relation with the artist, shown next to the artist's name. */
export function FollowRelationChip({ relation, className = "" }: Props) {
  const { t } = useT();
  if (!relation) return null;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full bg-zinc-100 px-1.5 py-0.5 align-middle text-[10px] font-medium leading-none text-zinc-600 ${className}`}
    >
      {t(`follow.relation.${relation}`)}
    </span>
  );
}
