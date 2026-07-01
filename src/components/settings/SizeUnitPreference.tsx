"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/useT";
import type { SizeUnitPref } from "@/lib/size/format";
import { setStoredSizeUnitPref, useSizeUnitPref } from "@/lib/size/preference";
import { saveProfileUnified } from "@/lib/supabase/profileSaveUnified";

const OPTIONS: SizeUnitPref[] = ["auto", "cm", "in"];

/**
 * Viewer size-unit display preference (cm / inch / auto). Persists to
 * `profile_details.size_unit_pref` via the unified RPC (merged, so it
 * doesn't touch other profile fields) and mirrors to localStorage so the
 * change applies instantly across every artwork surface.
 */
export function SizeUnitPreference() {
  const { t } = useT();
  const pref = useSizeUnitPref();
  const [saving, setSaving] = useState<SizeUnitPref | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function choose(next: SizeUnitPref) {
    if (next === pref) return;
    setStoredSizeUnitPref(next); // instant local apply
    setNotice(null);
    setSaving(next);
    const res = await saveProfileUnified({
      basePatch: {},
      detailsPatch: { size_unit_pref: next },
      completeness: null,
    });
    setSaving(null);
    setNotice(res.ok ? t("settings.sizeUnit.saved") : t("settings.sizeUnit.saveFailed"));
  }

  return (
    <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4">
      <header>
        <h2 className="text-sm font-semibold text-zinc-900">{t("settings.sizeUnit.title")}</h2>
        <p className="mt-1 text-xs text-zinc-500">{t("settings.sizeUnit.hint")}</p>
      </header>
      <div className="inline-flex rounded-lg border border-zinc-300 p-0.5">
        {OPTIONS.map((opt) => {
          const active = pref === opt;
          return (
            <button
              key={opt}
              type="button"
              aria-pressed={active}
              disabled={saving !== null}
              onClick={() => choose(opt)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-600 hover:text-zinc-900 disabled:opacity-50"
              }`}
            >
              {t(`settings.sizeUnit.${opt === "in" ? "inch" : opt}`)}
            </button>
          );
        })}
      </div>
      {notice && <p className="text-xs text-emerald-700">{notice}</p>}
    </section>
  );
}
