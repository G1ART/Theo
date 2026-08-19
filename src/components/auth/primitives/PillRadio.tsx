"use client";

/**
 * PillRadio — Signup v2 primitive (Phase 1, 2026-08-19).
 *
 * Radio group rendered as a row of pill buttons. Matches the "Public
 * vs Private" and "Age band" wireframe patterns. Options wrap to
 * multiple lines on narrow viewports.
 *
 * Example:
 *   <PillRadio
 *     label="나이대"
 *     value={ageBand}
 *     onChange={setAgeBand}
 *     options={[{ value: "18_24", label: "18–24" }, ...]}
 *   />
 */

import { useId, type ReactNode } from "react";

export type PillRadioOption = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};

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
  } = props;
  const autoName = useId();
  const groupName = name ?? autoName;
  const hasError = !!error;
  return (
    <fieldset className={`w-full ${className}`}>
      {label && (
        <legend className="mb-2 block text-sm font-medium text-zinc-900">
          {label}
        </legend>
      )}
      <div
        role="radiogroup"
        aria-invalid={hasError || undefined}
        className="flex flex-wrap gap-2"
      >
        {options.map((opt) => {
          const selected = opt.value === value;
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
