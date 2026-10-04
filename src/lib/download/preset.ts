"use client";

import { useSyncExternalStore } from "react";

/** One work saves as this image. Several works use it inside a zip. */
export type DownloadImageFormat = "png" | "jpeg";
/** Default for a multi-work download. The confirm step can still change it. */
export type DownloadSeveralDefault = "zip" | "pdf";

export type DownloadPreset = {
  image: DownloadImageFormat;
  several: DownloadSeveralDefault;
};

export const DEFAULT_DOWNLOAD_PRESET: DownloadPreset = {
  image: "png",
  several: "zip",
};

const STORAGE_KEY = "theo_download_preset";
const EVENT = "theo:download-preset";

export function parseDownloadPreset(raw: unknown): DownloadPreset {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_DOWNLOAD_PRESET };
  const record = raw as Record<string, unknown>;
  return {
    image: record.image === "jpeg" ? "jpeg" : "png",
    several: record.several === "pdf" ? "pdf" : "zip",
  };
}

export function presetEquals(a: DownloadPreset, b: DownloadPreset): boolean {
  return a.image === b.image && a.several === b.several;
}

function readStored(): DownloadPreset {
  if (typeof window === "undefined") return { ...DEFAULT_DOWNLOAD_PRESET };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_DOWNLOAD_PRESET };
    return parseDownloadPreset(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_DOWNLOAD_PRESET };
  }
}

export function getStoredDownloadPreset(): DownloadPreset {
  return readStored();
}

export function setStoredDownloadPreset(preset: DownloadPreset): void {
  if (typeof window === "undefined") return;
  const next = parseDownloadPreset(preset);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
}

export function hydrateDownloadPreset(serverPref: unknown): void {
  if (typeof window === "undefined") return;
  const next = parseDownloadPreset(serverPref);
  if (presetEquals(getStoredDownloadPreset(), next)) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
}

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onCustom = () => callback();
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) callback();
  };
  window.addEventListener(EVENT, onCustom);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onCustom);
    window.removeEventListener("storage", onStorage);
  };
}

let snapshot = readStored();

function getSnapshot(): DownloadPreset {
  const next = readStored();
  if (!presetEquals(snapshot, next)) snapshot = next;
  return snapshot;
}

export function useDownloadPreset(): DownloadPreset {
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_DOWNLOAD_PRESET);
}

export type BulkConfirmChoice = "png-zip" | "jpeg-zip" | "pdf";

export function presetToBulkChoice(preset: DownloadPreset): BulkConfirmChoice {
  if (preset.several === "pdf") return "pdf";
  return preset.image === "jpeg" ? "jpeg-zip" : "png-zip";
}
