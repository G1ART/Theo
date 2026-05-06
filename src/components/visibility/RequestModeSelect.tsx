"use client";

import type { VisibilityRequestMode } from "@/lib/visibility/types";
import { useT } from "@/lib/i18n/useT";

type Props = {
  value: VisibilityRequestMode;
  onChange: (next: VisibilityRequestMode) => void;
  disabled?: boolean;
  ariaLabel?: string;
};

const SERIALIZED_NULL = "__default__";

export function RequestModeSelect({ value, onChange, disabled, ariaLabel }: Props) {
  const { t } = useT();
  const serialized = value ?? SERIALIZED_NULL;
  return (
    <select
      value={serialized}
      disabled={disabled}
      aria-label={ariaLabel ?? t("visibility.requestMode.label")}
      onChange={(e) => {
        const v = e.target.value;
        const next: VisibilityRequestMode =
          v === SERIALIZED_NULL ? null : (v as VisibilityRequestMode);
        onChange(next);
      }}
      className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-100"
    >
      <option value={SERIALIZED_NULL}>{t("visibility.requestMode.default")}</option>
      <option value="inquiry">{t("visibility.requestMode.inquiry")}</option>
      <option value="access_request">
        {t("visibility.requestMode.access_request")}
      </option>
      <option value="none">{t("visibility.requestMode.none")}</option>
    </select>
  );
}
