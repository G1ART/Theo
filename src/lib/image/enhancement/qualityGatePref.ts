"use client";

import { useSyncExternalStore } from "react";

/**
 * 2026-08-19 — Viewer preference for the pre-flight artwork quality
 * gate (AI vision LLM check before the DSP enhancement pipeline
 * fires). Mirrors the shape of the sibling
 * `src/lib/simulation/calibrationPref.ts` so the two per-device AI
 * opt-outs behave consistently.
 *
 * Semantics
 * ---------
 * `true`  (default): every uploaded photo runs through the vision
 *                    LLM once. Motion blur / moiré / extreme clipping
 *                    surface as a warn or block banner; DSP pipeline
 *                    still runs its own quality checks separately.
 * `false`         : the vision call is skipped entirely and the DSP
 *                    pipeline behaves exactly like it did before the
 *                    gate landed. Existing `analyzeImageFile`
 *                    heuristics are unaffected.
 *
 * Persistence
 * -----------
 * localStorage only, per-device. Matches SizeUnitPreference and
 * SimulationCalibrationPreference. Cross-device sync via
 * `profile_details` is deferred until we see actual demand.
 *
 * Value shape: literal string `"1"` (on) or `"0"` (off). Any other
 * value (missing key, corrupt storage) → default on. Avoids JSON so
 * SSR-safe reads inside `useSyncExternalStore` never have to parse.
 */
const STORAGE_KEY = "theo.enhancement.qualityGate";
const EVENT = "theo:enhancement-quality-gate";

/**
 * Read the current pref from localStorage. Returns the default
 * (`true`) on the server, in private mode, or when the value is
 * missing / invalid.
 */
export function getStoredQualityGatePref(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "0") return false;
    if (v === "1") return true;
    return true;
  } catch {
    return true;
  }
}

/**
 * Persist the pref + broadcast a change event so any live upload
 * surface (single editor, bulk page) re-renders without a full page
 * reload.
 */
export function setStoredQualityGatePref(next: boolean): void {
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
export function useQualityGatePref(): boolean {
  return useSyncExternalStore(
    subscribe,
    getStoredQualityGatePref,
    getServerSnapshot,
  );
}
