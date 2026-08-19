"use client";

/**
 * PillButton — Signup v2 primitive (Phase 1, 2026-08-19).
 *
 * Round pill-shaped CTA button. Three variants (primary / secondary /
 * ghost), plus `loading` and `fullWidth` flags. Matches the "Continue"
 * / "Skip" / "Log in without a password" pattern in the wireframes.
 *
 * Example:
 *   <PillButton variant="primary" fullWidth loading={saving} type="submit">
 *     계속
 *   </PillButton>
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";

export type PillButtonVariant = "primary" | "secondary" | "ghost";

export type PillButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className"
> & {
  variant?: PillButtonVariant;
  fullWidth?: boolean;
  loading?: boolean;
  /** Additional utility classes (spacing, alignment). */
  className?: string;
  /** Content — usually text, but can be an icon + text row. */
  children: ReactNode;
};

const VARIANT_CLASSES: Record<PillButtonVariant, string> = {
  primary:
    "border-zinc-900 bg-zinc-900 text-white hover:bg-zinc-800 disabled:border-zinc-400 disabled:bg-zinc-400",
  secondary:
    "border-zinc-300 bg-white text-zinc-900 hover:border-zinc-500 hover:bg-zinc-50 disabled:border-zinc-200 disabled:text-zinc-400",
  ghost:
    "border-transparent bg-transparent text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 disabled:text-zinc-400",
};

export function PillButton(props: PillButtonProps) {
  const {
    variant = "primary",
    fullWidth = false,
    loading = false,
    disabled,
    type = "button",
    className = "",
    children,
    ...rest
  } = props;

  const width = fullWidth ? "w-full" : "";
  const isDisabled = disabled || loading;

  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-full border px-6 py-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${width} ${className}`}
      {...rest}
    >
      {loading && (
        <span
          aria-hidden
          className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
        />
      )}
      <span>{children}</span>
    </button>
  );
}
