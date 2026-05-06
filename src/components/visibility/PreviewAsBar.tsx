"use client";

import { LaneChips, type LaneOption } from "@/components/ds/LaneChips";
import type { RelationshipAudience } from "@/lib/visibility/types";
import { useT } from "@/lib/i18n/useT";
import type { MessageKey } from "@/lib/i18n/messages";

// Audience tiers exposed in the preview-as picker. We deliberately
// hide `delegates` (operational) and `owner_only` (always self-true).
const PREVIEW_AUDIENCES: RelationshipAudience[] = [
  "public",
  "signed_in",
  "followers",
  "following",
  "mutuals",
  "approved",
];

type Props = {
  active: RelationshipAudience | null;
  onChange: (next: RelationshipAudience | null) => void;
  disabled?: boolean;
};

export function PreviewAsBar({ active, onChange, disabled }: Props) {
  const { t } = useT();
  const options: LaneOption<RelationshipAudience | "__exit__">[] = [
    ...PREVIEW_AUDIENCES.map((a) => ({
      id: a as RelationshipAudience | "__exit__",
      label: t(`visibility.previewAs.${a}` as MessageKey),
    })),
  ];

  return (
    <div
      className={[
        "flex flex-col gap-3",
        disabled ? "pointer-events-none opacity-60" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <LaneChips
        variant="sort"
        options={options}
        active={(active ?? "__exit__") as RelationshipAudience | "__exit__"}
        onChange={(id) => {
          if (id === "__exit__") onChange(null);
          else onChange(id);
        }}
        ariaLabel={t("visibility.previewAs.section")}
      />
      {active && (
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-zinc-900/95 px-4 py-2.5 text-xs text-white">
          <span>
            {t("visibility.previewAs.banner").replace(
              "{label}",
              t(`visibility.previewAs.${active}` as MessageKey)
            )}
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium text-white hover:bg-white/20"
          >
            {t("visibility.previewAs.exit")}
          </button>
        </div>
      )}
    </div>
  );
}
