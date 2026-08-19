"use client";

/**
 * Display Simulation Phase 3 (2026-08-19) — subtle "저장 중 · 저장됨"
 * pill for the space editor's top-right toolbar.
 *
 * Replaces the full-page pessimistic re-hydrate feel (Phase 2 fired
 * `void load()` after every debounced upsert, freezing the canvas for
 * ~600 ms). Now that flushPlacements is fully optimistic, the only
 * cue the user still needs is "yes, your changes were saved" — an
 * iCloud / Notion-style micro-indicator, not a full-screen spinner.
 *
 * States:
 *   • `idle`   — hidden (no visual noise when nothing is happening).
 *   • `saving` — grey filled dot + "저장 중" label, subtle pulse.
 *   • `saved`  — emerald check + "저장됨" label; auto-fades to `idle`
 *                after `SAVED_LINGER_MS`.
 *   • `error`  — amber warning + "저장 실패" label; sticks until the
 *                next `saving` cycle (or a user dismiss — not wired
 *                here since the editor already surfaces a toast).
 *
 * ARIA — `role="status"` + `aria-live="polite"` so screen readers
 * announce transitions without interrupting the current action. The
 * pill itself never steals focus.
 */

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/useT";

const SAVED_LINGER_MS = 2000;

export type SavePillStatus = "idle" | "saving" | "saved" | "error";

export function SavePill({ status }: { status: SavePillStatus }) {
  const { t } = useT();
  // "Ephemeral" flag flips true briefly when the parent transitions
  // to `saved`, so the pill can show the ✓ for ~2 s and then hide
  // itself without the parent needing to schedule a timer. The
  // effect only runs when `status` transitions — no cascading state
  // sync inside the render.
  const [savedLinger, setSavedLinger] = useState(false);

  useEffect(() => {
    if (status !== "saved") {
      // Non-`saved` transitions immediately clear the linger so the
      // next status change renders truthfully.
      setSavedLinger(false);
      return;
    }
    setSavedLinger(true);
    const h = setTimeout(() => setSavedLinger(false), SAVED_LINGER_MS);
    return () => clearTimeout(h);
  }, [status]);

  const display: SavePillStatus =
    status === "saved" && !savedLinger ? "idle" : status;

  if (display === "idle") {
    // Reserve a tiny sr-only announcer so consecutive saves still
    // trigger polite AT re-reads even after we fade out visually.
    return (
      <span
        role="status"
        aria-live="polite"
        className="sr-only"
      >
        {""}
      </span>
    );
  }

  const isSaving = display === "saving";
  const isSaved = display === "saved";
  const isError = display === "error";

  return (
    <span
      role="status"
      aria-live="polite"
      className={[
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-opacity duration-200",
        isSaving && "bg-zinc-100 text-zinc-600",
        isSaved && "bg-emerald-50 text-emerald-700",
        isError && "bg-amber-50 text-amber-800",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span
        aria-hidden
        className={[
          "inline-block h-1.5 w-1.5 rounded-full",
          isSaving && "animate-pulse bg-zinc-400",
          isSaved && "bg-emerald-500",
          isError && "bg-amber-500",
        ]
          .filter(Boolean)
          .join(" ")}
      />
      <span>
        {isSaving && t("simulation.save.saving")}
        {isSaved && t("simulation.save.saved")}
        {isError && t("simulation.save.error")}
      </span>
    </span>
  );
}
