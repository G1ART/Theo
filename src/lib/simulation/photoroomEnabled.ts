/**
 * Display Simulation Phase 2 (2026-08-19) — client-side gate for the
 * Track 2 "Photoroom" cutout CTA in the Space Editor inspector.
 *
 * Background
 * ----------
 * The Photoroom pipeline requires two things:
 *   1. `PHOTOROOM_API_KEY` set server-side (see `/api/ai/artwork-cutout-alpha`).
 *   2. A separate build-time boolean opt-in so we can hide the button in
 *      environments where the key isn't configured yet.
 *
 * Prior behaviour: the "고급 배경 분리 (Pro)" button was always visible,
 * and every click round-tripped to the server just to get a 501
 * "not_configured" toast back. That's noise the user reads as a broken
 * feature. This helper lets the client hide the button entirely so it
 * only shows up in environments where the server is actually configured.
 *
 * Semantics
 * ---------
 * Reads the public build-time flag `NEXT_PUBLIC_PHOTOROOM_ENABLED`.
 * Values: `"true"` → enabled; anything else (including missing, `"false"`,
 * empty string) → disabled. Kept as a string / boolean toggle rather than
 * a runtime API call so the button never flickers into view before the
 * feature is available.
 *
 * IMPORTANT: setting this flag to `true` when `PHOTOROOM_API_KEY` is not
 * configured on the server will re-introduce the 501 toast — the two
 * knobs must be flipped together (server key first, then flag).
 */

export function isPhotoroomEnabled(): boolean {
  const raw = process.env.NEXT_PUBLIC_PHOTOROOM_ENABLED;
  return typeof raw === "string" && raw.toLowerCase() === "true";
}
