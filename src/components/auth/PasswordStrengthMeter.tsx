"use client";

/**
 * PasswordStrengthMeter — Signup v2 Phase 5 (2026-08-19).
 *
 * A small stateless visualiser for zxcvbn 0–4 scores. Renders a 5-segment
 * bar, a localized bucket label, and (optionally) zxcvbn's own warning /
 * suggestions strings. Score comes from `computePasswordStrength` in
 * `src/lib/auth/passwordPolicy.ts`.
 *
 * Extracted from `SignupStep2Password.tsx` so the same meter can be
 * reused from other password surfaces later (e.g. `/set-password`,
 * `/auth/reset`) without copy-pasting the bar CSS + colour ramp.
 *
 * Notes:
 *   - zxcvbn 4's `feedback.warning` / `feedback.suggestions` are English
 *     phrases baked into the library. We surface them verbatim per spec
 *     §11.2 — the KO copy will polish them in a follow-up when the
 *     design team ships bilingual scoring hints.
 *   - Component is purely presentational — no HIBP call, no debounce.
 *     The parent still owns the HIBP round-trip so the meter can be
 *     inlined into Step 2 (and any future callers) without dragging
 *     network state along.
 */

import { useMemo } from "react";
import { useT } from "@/lib/i18n/useT";
import {
  computePasswordStrength,
  type PasswordStrengthLabel,
} from "@/lib/auth/passwordPolicy";

export type PasswordStrengthMeterProps = {
  password: string;
  /** Additional strings zxcvbn should penalize (e.g. the user's email). */
  userInputs?: readonly string[];
  /** Optional min length so we can surface a "too short" secondary hint
   *  without duplicating the shape check in the parent. Purely visual —
   *  the parent still owns the submit gate. */
  minLength?: number;
  /** Suppress the localized bucket label + zxcvbn feedback. */
  hideLabel?: boolean;
  /** Suppress zxcvbn's warning/suggestions strings even when a label is
   *  shown (used when the parent wants only the coloured bar). */
  hideFeedback?: boolean;
  className?: string;
};

const STRENGTH_KEY: Record<PasswordStrengthLabel, string> = {
  veryWeak: "auth.password.strength.veryWeak",
  weak: "auth.password.strength.weak",
  fair: "auth.password.strength.fair",
  strong: "auth.password.strength.strong",
  veryStrong: "auth.password.strength.veryStrong",
};

// Tailwind classes for the coloured fill of each bar segment. Kept as a
// static map so Tailwind's JIT sees the class literals and includes them
// in the bundle (dynamic string interpolation would tree-shake them
// away in production builds).
const STRENGTH_COLOR: Record<PasswordStrengthLabel, string> = {
  veryWeak: "bg-zinc-400",
  weak: "bg-red-500",
  fair: "bg-orange-400",
  strong: "bg-emerald-500",
  veryStrong: "bg-emerald-700",
};

const SEGMENTS = 5;

export function PasswordStrengthMeter(props: PasswordStrengthMeterProps) {
  const {
    password,
    userInputs,
    minLength,
    hideLabel = false,
    hideFeedback = false,
    className = "",
  } = props;
  const { t } = useT();
  const inputs = userInputs ?? [];

  const strength = useMemo(
    () => computePasswordStrength(password, inputs),
    // `inputs` is stable across renders when caller memoizes; we
    // stringify for the dep array so an inline array literal (which is
    // a fresh identity every render) doesn't force zxcvbn to re-run
    // needlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [password, inputs.join("\u0000")],
  );

  const filledBars = password
    ? Math.min(SEGMENTS, Math.max(1, strength.score + 1))
    : 0;
  const barColor = STRENGTH_COLOR[strength.label];
  const belowMin =
    typeof minLength === "number" && password.length > 0 && password.length < minLength;

  return (
    <div className={className}>
      <div
        className="flex items-center gap-1.5"
        role="progressbar"
        aria-label={t(STRENGTH_KEY[strength.label])}
        aria-valuenow={strength.score}
        aria-valuemin={0}
        aria-valuemax={4}
      >
        {Array.from({ length: SEGMENTS }).map((_, i) => (
          <span
            key={i}
            aria-hidden
            className={`h-1.5 flex-1 rounded-full transition-colors duration-150 ${
              i < filledBars ? barColor : "bg-zinc-200"
            }`}
          />
        ))}
      </div>
      {!hideLabel && (
        <p
          role="status"
          aria-live="polite"
          className="mt-2 text-xs text-zinc-500"
        >
          {t(STRENGTH_KEY[strength.label])}
          {!hideFeedback && strength.warning ? ` · ${strength.warning}` : ""}
          {belowMin ? ` · ${t("auth.password.strength.belowMin").replace(
            "{min}",
            String(minLength),
          )}` : ""}
        </p>
      )}
      {!hideLabel && !hideFeedback && strength.suggestions.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-[11px] leading-relaxed text-zinc-500">
          {strength.suggestions.slice(0, 2).map((s, i) => (
            <li key={i}>· {s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
