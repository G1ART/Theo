"use client";

import { LaneChips, type LaneOption } from "@/components/ds/LaneChips";
import type { VisibilityPresetKey } from "@/lib/visibility/types";
import { useT } from "@/lib/i18n/useT";
import type { MessageKey } from "@/lib/i18n/messages";

type Props = {
  active: VisibilityPresetKey;
  onChange: (key: VisibilityPresetKey) => void;
  disabled?: boolean;
};

const PRESETS: VisibilityPresetKey[] = [
  "open_studio",
  "follower_aware",
  "mutual_first",
  "private_studio",
];

export function VisibilityPresetSelector({ active, onChange, disabled }: Props) {
  const { t } = useT();
  const options: LaneOption<VisibilityPresetKey>[] = PRESETS.map((p) => ({
    id: p,
    label: t(`visibility.preset.${p}` as MessageKey),
  }));

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
        variant="lane"
        options={options}
        active={active}
        onChange={(id) => onChange(id)}
        ariaLabel={t("visibility.preset.section")}
      />
      <p className="text-sm leading-relaxed text-zinc-600">
        {t(`visibility.preset.${active}.desc` as MessageKey)}
      </p>
    </div>
  );
}
