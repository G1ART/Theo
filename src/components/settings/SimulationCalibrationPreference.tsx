"use client";

import { useT } from "@/lib/i18n/useT";
import {
  setStoredAiCalibrationPref,
  useAiCalibrationPref,
} from "@/lib/simulation/calibrationPref";

/**
 * P1 (2026-08-19) — Simulation settings row for the AI scale-detection
 * opt-out. Toggling this immediately writes to localStorage and
 * broadcasts a custom event so any open SpaceEditor picks up the
 * new preference on the next photo upload without a page reload.
 *
 * Persistence rationale — MVP uses localStorage only (per-device). The
 * intent is "cost / privacy" (skip the vision API call), which we treat
 * as a per-device decision. Cross-device sync would require mirroring
 * to `profile_details` JSONB; deferred until we see user demand.
 */
export function SimulationCalibrationPreference() {
  const { t } = useT();
  const enabled = useAiCalibrationPref();

  return (
    <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4">
      <header>
        <h2 className="text-sm font-semibold text-zinc-900">
          {t("simulation.calibrate.settingsSectionTitle")}
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          {t("simulation.calibrate.settingsSectionHint")}
        </p>
      </header>
      <label
        htmlFor="simulation-ai-calibration-toggle"
        className="flex items-start justify-between gap-4 rounded-md border border-zinc-200 px-3 py-3 text-sm"
      >
        <span className="flex flex-col">
          <span className="font-medium text-zinc-900">
            {t("simulation.calibrate.settingsTitle")}
          </span>
          <span className="mt-1 text-xs text-zinc-500">
            {t("simulation.calibrate.settingsDesc")}
          </span>
        </span>
        <input
          id="simulation-ai-calibration-toggle"
          type="checkbox"
          checked={enabled}
          onChange={(e) => setStoredAiCalibrationPref(e.target.checked)}
          className="mt-1 h-4 w-4 rounded"
        />
      </label>
    </section>
  );
}
