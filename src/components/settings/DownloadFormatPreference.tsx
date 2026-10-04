"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/useT";
import {
  setStoredDownloadPreset,
  useDownloadPreset,
  type DownloadImageFormat,
  type DownloadSeveralDefault,
} from "@/lib/download/preset";
import { saveProfileUnified } from "@/lib/supabase/profileSaveUnified";

const IMAGES: DownloadImageFormat[] = ["png", "jpeg"];
const SEVERAL: DownloadSeveralDefault[] = ["zip", "pdf"];

/**
 * One saved preference: image type for a single work, and whether several
 * works start as an image zip or a caption PDF. The confirm step can
 * still pick the other.
 */
export function DownloadFormatPreference() {
  const { t } = useT();
  const preset = useDownloadPreset();
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function save(next: { image: DownloadImageFormat; several: DownloadSeveralDefault }) {
    if (next.image === preset.image && next.several === preset.several) return;
    setStoredDownloadPreset(next);
    setNotice(null);
    setSaving(true);
    const res = await saveProfileUnified({
      basePatch: {},
      detailsPatch: { download_preset: next },
      completeness: null,
    });
    setSaving(false);
    setNotice(res.ok ? t("download.format.saved") : t("download.format.saveFailed"));
  }

  return (
    <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4">
      <header>
        <h2 className="text-sm font-semibold text-zinc-900">{t("download.format.title")}</h2>
        <p className="mt-1 text-xs text-zinc-500">{t("download.format.hint")}</p>
      </header>
      <div className="space-y-2">
        <p className="text-xs font-medium text-zinc-600">{t("download.format.one")}</p>
        <div className="inline-flex rounded-lg border border-zinc-300 p-0.5">
          {IMAGES.map((opt) => {
            const active = preset.image === opt;
            return (
              <button
                key={opt}
                type="button"
                aria-pressed={active}
                disabled={saving}
                onClick={() => save({ image: opt, several: preset.several })}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-zinc-900 text-white"
                    : "text-zinc-600 hover:text-zinc-900 disabled:opacity-50"
                }`}
              >
                {t(opt === "png" ? "download.format.png" : "download.format.jpeg")}
              </button>
            );
          })}
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium text-zinc-600">{t("download.format.several")}</p>
        <div className="inline-flex rounded-lg border border-zinc-300 p-0.5">
          {SEVERAL.map((opt) => {
            const active = preset.several === opt;
            return (
              <button
                key={opt}
                type="button"
                aria-pressed={active}
                disabled={saving}
                onClick={() => save({ image: preset.image, several: opt })}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-zinc-900 text-white"
                    : "text-zinc-600 hover:text-zinc-900 disabled:opacity-50"
                }`}
              >
                {t(opt === "zip" ? "download.format.zip" : "download.format.pdf")}
              </button>
            );
          })}
        </div>
      </div>
      {notice && <p className="text-xs text-emerald-700">{notice}</p>}
    </section>
  );
}
