"use client";

import { REGISTRATION_VIEW_ROLES, extraViewType } from "@/lib/upload/extraViewRoles";
import type { ArtworkImageViewType } from "@/lib/supabase/artworks";
import { useT } from "@/lib/i18n/useT";

/** 전체 / 설치 / 디테일, with the older angle and other tags still available. */
export function ExtraViewRolePicker({
  value,
  onChange,
}: {
  value: string | null | undefined;
  onChange: (next: ArtworkImageViewType) => void;
}) {
  const { t } = useT();
  const current = extraViewType(value);
  const extra = current === "angle" || current === "other";

  return (
    <div className="mt-1 space-y-1">
      <div className="flex flex-wrap gap-1" role="group" aria-label={t("bulk.extraImages")}>
        {REGISTRATION_VIEW_ROLES.map((role) => {
          const on = current === role.value;
          return (
            <button
              key={role.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(role.value)}
              className={`rounded-full border px-2 py-0.5 text-[10px] ${
                on
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
              }`}
            >
              {t(role.labelKey)}
            </button>
          );
        })}
      </div>
      <select
        value={extra ? current : ""}
        onChange={(e) => {
          const next = e.target.value;
          if (next === "angle" || next === "other") onChange(next);
        }}
        aria-label={t("bulk.view.moreRoles")}
        className="w-full rounded-full border border-zinc-200 bg-white px-1 py-0.5 text-[10px] text-zinc-600"
      >
        <option value="">{t("bulk.view.moreRoles")}</option>
        <option value="angle">{t("bulk.view.angle")}</option>
        <option value="other">{t("bulk.view.other")}</option>
      </select>
    </div>
  );
}
