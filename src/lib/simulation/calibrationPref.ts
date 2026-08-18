"use client";

import { useSyncExternalStore } from "react";

/**
 * P1 (2026-08-19) — Viewer preference for AI scale detection in the
 * SpaceEditor after photo upload.
 *
 * Semantics
 * ---------
 * `true`  (default): after the room photo saves, we run the vision LLM
 *                    ONCE and — when it returns a candidate — surface
 *                    the "AI found this [window] as a scale reference"
 *                    card. Users always confirm before we write to DB.
 * `false`         : we skip the LLM call entirely. The manual
 *                   "직접 재기 / Measure manually" entrypoint still
 *                   works from both the AI card slot and the "정확한
 *                   스케일 (고급)" accordion.
 *
 * Persistence
 * -----------
 * MVP uses localStorage only. Cross-device sync would require touching
 * `profile_details` JSONB via `saveProfileUnified` — deferred until we
 * see actual user demand. The trade-off is that toggling on your phone
 * doesn't propagate to your laptop, which we consider acceptable for a
 * per-device "cost / privacy" preference.
 *
 * Value shape: literal string `"1"` (on) or `"0"` (off). Any other
 * value (missing key, corrupt storage) → default on. We avoid JSON so
 * SSR-safe reads inside `useSyncExternalStore` never have to parse.
 */
const STORAGE_KEY = "theo.simulation.aiCalibration";
const EVENT = "theo:simulation-ai-calibration";

/**
 * Read the current pref from localStorage. Returns the default (`true`)
 * on the server, in private mode, or when the value is missing/invalid.
 */
export function getStoredAiCalibrationPref(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "0") return false;
    if (v === "1") return true;
    return true; // default on
  } catch {
    return true;
  }
}

/**
 * Persist the pref + broadcast a change event so any live SpaceEditor
 * instance (or the Settings toggle) re-renders without a page reload.
 */
export function setStoredAiCalibrationPref(next: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    /* ignore quota / private-mode failures — pref is best-effort */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
}

/**
 * `useSyncExternalStore` subscribe function. Fires on same-tab
 * CustomEvent (settings toggle) and cross-tab StorageEvent (multiple
 * windows). Returns the unsubscribe cleanup.
 */
function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onCustom = () => onChange();
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) onChange();
  };
  window.addEventListener(EVENT, onCustom as EventListener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onCustom as EventListener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Server snapshot — always the default (matches SSR render). */
function getServerSnapshot(): boolean {
  return true;
}

/**
 * Reactive read of the pref via React 18's `useSyncExternalStore` —
 * avoids the "setState in useEffect body" lint fires when subscribing
 * with `useState`+`useEffect`, and gives us a hydration-safe snapshot
 * for the "default on" first paint.
 */
export function useAiCalibrationPref(): boolean {
  return useSyncExternalStore(
    subscribe,
    getStoredAiCalibrationPref,
    getServerSnapshot,
  );
}
