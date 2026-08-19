"use client";

import { useSyncExternalStore } from "react";
import type { SizeUnitPref } from "./format";

/**
 * Viewer's artwork-size unit preference.
 *
 * This is a *display* preference (how dimensions are shown), independent
 * of the unit each work was entered in. It is cached in localStorage so
 * every artwork surface can read it synchronously on render (feed cards,
 * detail, etc.), and mirrored into `profiles.profile_details.size_unit_pref`
 * for logged-in users so it follows them across devices (see the settings
 * page + `hydrateSizeUnitPref`).
 *
 * Values: "cm" | "in" | "auto" (auto = follow page locale, KO→cm else in).
 */
const STORAGE_KEY = "theo_size_unit_pref";
const EVENT = "theo:size-unit-pref";

function isPref(v: unknown): v is SizeUnitPref {
  return v === "cm" || v === "in" || v === "auto";
}

export function getStoredSizeUnitPref(): SizeUnitPref {
  if (typeof window === "undefined") return "auto";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return isPref(v) ? v : "auto";
  } catch {
    return "auto";
  }
}

export function setStoredSizeUnitPref(pref: SizeUnitPref): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* ignore quota / privacy-mode errors */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: pref }));
}

/**
 * Sync the localStorage cache from a server value (profile_details) without
 * re-broadcasting a redundant change. Call on login / profile load.
 */
export function hydrateSizeUnitPref(serverPref: unknown): void {
  if (typeof window === "undefined") return;
  const next: SizeUnitPref = isPref(serverPref) ? serverPref : "auto";
  if (getStoredSizeUnitPref() === next) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
}

/**
 * Reactive read of the current viewer size-unit preference. Re-renders
 * when the preference changes in this tab (custom event) or another tab
 * (storage event).
 *
 * Implemented via `useSyncExternalStore` so the effect body doesn't have
 * to call `setState` to seed the initial client value — the store's
 * `getSnapshot` (which reads `localStorage` synchronously) provides it
 * on the first client render, and `getServerSnapshot` returns the same
 * neutral "auto" value the SSR path used to render. This avoids the
 * `react-hooks/set-state-in-effect` warning and any hydration flicker.
 */
function subscribeSizeUnitPref(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onCustom = () => callback();
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) callback();
  };
  window.addEventListener(EVENT, onCustom as EventListener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onCustom as EventListener);
    window.removeEventListener("storage", onStorage);
  };
}

function getServerSizeUnitPref(): SizeUnitPref {
  return "auto";
}

export function useSizeUnitPref(): SizeUnitPref {
  return useSyncExternalStore(
    subscribeSizeUnitPref,
    getStoredSizeUnitPref,
    getServerSizeUnitPref,
  );
}
