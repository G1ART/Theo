"use client";

import { useT } from "@/lib/i18n/useT";
import {
  setStoredQualityGatePref,
  useQualityGatePref,
} from "@/lib/image/enhancement/qualityGatePref";

/**
 * 2026-08-19 — Settings row for the pre-flight artwork quality gate
 * opt-out. Toggling this immediately writes to localStorage and
 * broadcasts a CustomEvent so any open upload surface (single editor,
 * bulk page) picks up the new preference before the next photo lands
 * without a page reload.
 *
 * The parallel `SimulationCalibrationPreference` row (AI scale
 * detection) sits under a "Simulation" section header. This row
 * lives under a NEW "AI assist" (`enhancement.quality.settingsSection*`)
 * section header so both AI opt-outs can co-locate on rebase — the
 * space calibration worker's row can migrate into this same section
 * later if we want a single "AI assist" surface.
 */
export function EnhancementQualityGatePreference() {
  const { t } = useT();
  const enabled = useQualityGatePref();

  return (
    <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4">
      <header>
        <h2 className="text-sm font-semibold text-zinc-900">
          {t("enhancement.quality.settingsSectionTitle")}
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          {t("enhancement.quality.settingsSectionHint")}
        </p>
      </header>
      <label
        htmlFor="enhancement-quality-gate-toggle"
        className="flex items-start justify-between gap-4 rounded-md border border-zinc-200 px-3 py-3 text-sm"
      >
        <span className="flex flex-col">
          <span className="font-medium text-zinc-900">
            {t("enhancement.quality.settingsTitle")}
          </span>
          <span className="mt-1 text-xs text-zinc-500">
            {t("enhancement.quality.settingsDesc")}
          </span>
        </span>
        <input
          id="enhancement-quality-gate-toggle"
          type="checkbox"
          checked={enabled}
          onChange={(e) => setStoredQualityGatePref(e.target.checked)}
          className="mt-1 h-4 w-4 rounded"
        />
      </label>
    </section>
  );
}
