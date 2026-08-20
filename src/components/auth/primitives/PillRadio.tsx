"use client";

/**
 * PillRadio — Signup v2 primitive (Phase 1, 2026-08-19; wireframe
 * pixel-fidelity pass 2026-08-20).
 *
 * Radio group rendered as pill buttons.
 *
 * ## `variant`
 *
 *   - `"chip"` (default) — compact chips that wrap onto multiple lines
 *     (e.g. age bands). Preserves the pre-2026-08-20 behavior.
 *   - `"wide"` — two equally-sized large pill buttons in a 2-column
 *     grid, each with a small circular radio dot on the left and its
 *     label. Matches the wireframe's Public / Private visibility
 *     picker. Options should be exactly two entries; extras will
 *     simply overflow into extra grid cells.
 *
 * ## `labelStyle`
 *
 *   - `"legend"` (default) — the group label is a bold `<legend>`
 *     above the row (legacy behavior).
 *   - `"outer"` — smaller, gray, matches `OvalInput labelStyle="outer"`
 *     so a Step 3 column of mixed selects and radios reads as one
 *     rhythm.
 *
 * Example (chip, legacy):
 *   <PillRadio label="Age" value={age} onChange={setAge} options={AGE_OPTS} />
 *
 * Example (wide, Signup v2):
 *   <PillRadio
 *     variant="wide"
 *     labelStyle="outer"
 *     label="Visibility – who can see your profile?"
 *     value={vis}
 *     onChange={setVis}
 *     options={[
 *       { value: "public", label: "Public" },
 *       { value: "private", label: "Private" },
 *     ]}
 *   />
 */

import { useId, type ReactNode } from "react";

export type PillRadioOption = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};

export type PillRadioVariant = "chip" | "wide";
export type PillRadioLabelStyle = "legend" | "outer";

export type PillRadioProps = {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  value: string | null;
  onChange: (next: string) => void;
  options: readonly PillRadioOption[];
  /** Radio group name — deduped per instance if omitted. */
  name?: string;
  /** Optional wrapper className. */
  className?: string;
  /** `"chip"` (default) or `"wide"` — see file header. */
  variant?: PillRadioVariant;
  /** `"legend"` (default) or `"outer"` — see file header. */
  labelStyle?: PillRadioLabelStyle;
  /** When `labelStyle === "outer"`, appends a red `*` to the label. */
  required?: boolean;
};

export function PillRadio(props: PillRadioProps) {
  const {
    label,
    hint,
    error,
    value,
    onChange,
    options,
    name,
    className = "",
    variant = "chip",
    labelStyle = "legend",
    required = false,
  } = props;
  const autoName = useId();
  const groupName = name ?? autoName;
  const hasError = !!error;

  const groupClass =
    variant === "wide"
      ? "grid grid-cols-2 gap-3"
      : "flex flex-wrap gap-2";

  return (
    <fieldset className={`w-full ${className}`}>
      {label &&
        (labelStyle === "outer" ? (
          <legend
            className={`mb-1.5 block px-1 text-xs font-medium ${
              hasError ? "text-red-500" : "text-zinc-600"
            }`}
          >
            {label}
            {required ? (
              <span aria-hidden className="ml-0.5 text-red-500">*</span>
            ) : null}
          </legend>
        ) : (
          <legend className="mb-2 block text-sm font-medium text-zinc-900">
            {label}
          </legend>
        ))}
      <div
        role="radiogroup"
        aria-invalid={hasError || undefined}
        className={groupClass}
      >
        {options.map((opt) => {
          const selected = opt.value === value;
          if (variant === "wide") {
            // Larger pill with a visible radio dot on the left,
            // centered label. Matches the wireframe.
            return (
              <label
                key={opt.value}
                className={`flex cursor-pointer select-none items-center justify-between gap-3 rounded-full border bg-white px-5 py-3 text-sm transition-colors ${
                  opt.disabled
                    ? "cursor-not-allowed border-zinc-200 text-zinc-400"
                    : selected
                    ? "border-zinc-400 text-zinc-800"
                    : "border-zinc-300 text-zinc-700 hover:border-zinc-500"
                }`}
              >
                <input
                  type="radio"
                  name={groupName}
                  value={opt.value}
                  checked={selected}
                  disabled={opt.disabled}
                  onChange={() => onChange(opt.value)}
                  className="sr-only"
                />
                <span>{opt.label}</span>
                <span
                  aria-hidden
                  className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
                    selected ? "border-zinc-500" : "border-zinc-400"
                  }`}
                >
                  {selected && (
                    <span className="h-2 w-2 rounded-full bg-blue-500" />
                  )}
                </span>
              </label>
            );
          }
          return (
            <label
              key={opt.value}
              className={`inline-flex select-none items-center rounded-full border px-4 py-2 text-sm transition-colors ${
                opt.disabled
                  ? "cursor-not-allowed border-zinc-200 bg-zinc-50 text-zinc-400"
                  : selected
                  ? "cursor-pointer border-zinc-900 bg-zinc-900 text-white"
                  : "cursor-pointer border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400"
              }`}
            >
              <input
                type="radio"
                name={groupName}
                value={opt.value}
                checked={selected}
                disabled={opt.disabled}
                onChange={() => onChange(opt.value)}
                className="sr-only"
              />
              {opt.label}
            </label>
          );
        })}
      </div>
      {(error || hint) && (
        <p
          className={`mt-2 text-xs ${
            hasError ? "text-red-500" : "text-zinc-500"
          }`}
        >
          {error ?? hint}
        </p>
      )}
    </fieldset>
  );
}
