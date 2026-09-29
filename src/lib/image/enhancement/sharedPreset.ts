export type EnhanceSessionPreset = {
  inputType: "auto" | "studio" | "scanner";
  intensity: "light" | "normal" | "strong";
  b: number;
  c: number;
  s: number;
};

const KEY = "theo.enhance.sharedRecipe";

function tone(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1.3, Math.max(0.7, value))
    : 1;
}

export function parseEnhanceSessionPreset(raw: unknown): EnhanceSessionPreset | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const inputType = row.inputType;
  const intensity = row.intensity;
  if (inputType !== "auto" && inputType !== "studio" && inputType !== "scanner") return null;
  if (intensity !== "light" && intensity !== "normal" && intensity !== "strong") return null;
  return {
    inputType,
    intensity,
    b: tone(row.b),
    c: tone(row.c),
    s: tone(row.s),
  };
}

export function readEnhanceSessionPreset(): EnhanceSessionPreset | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    return parseEnhanceSessionPreset(JSON.parse(sessionStorage.getItem(KEY) || "null"));
  } catch {
    return null;
  }
}

export function writeEnhanceSessionPreset(preset: EnhanceSessionPreset): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(preset));
  } catch {
    // Private mode can reject the write. The current image still saves.
  }
}
