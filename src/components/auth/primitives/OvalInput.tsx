"use client";

/**
 * OvalInput — Signup v2 primitive (Phase 1, 2026-08-19).
 *
 * Round pill-shaped text input with a floating label, optional
 * leading / trailing adornments (icon buttons, `@` prefix, show/hide
 * toggle), and error / hint slots.
 *
 * The visual language is deliberately "delicate" (thin 1px stroke,
 * generous padding, small floating label) so it matches the front-
 * door wireframes without conflicting with the authed-app DS.
 *
 * Example:
 *   <OvalInput
 *     label="Email"
 *     type="email"
 *     value={email}
 *     onChange={setEmail}
 *     hint="곧 확인 이메일을 보낼게요."
 *   />
 */

import {
  forwardRef,
  useId,
  useState,
  type FocusEvent,
  type ForwardedRef,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

export type OvalInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "onChange" | "value"
> & {
  /** Floating label above the input. */
  label: ReactNode;
  value: string;
  onChange: (next: string) => void;
  /** Hint text below the field (grey). Ignored when `error` is set. */
  hint?: ReactNode;
  /** Error text below the field (red). Overrides hint when set. */
  error?: ReactNode;
  /** Node shown inside the field on the left (e.g. `@` prefix). */
  leadingAdornment?: ReactNode;
  /** Node shown inside the field on the right (e.g. show/hide toggle). */
  trailingAdornment?: ReactNode;
  /** Optional wrapper className (mostly for width overrides). */
  wrapperClassName?: string;
  /** Show a subtle "checking…" spinner state. */
  loading?: boolean;
};

function OvalInputInner(
  props: OvalInputProps,
  ref: ForwardedRef<HTMLInputElement>,
) {
  const {
    label,
    value,
    onChange,
    hint,
    error,
    leadingAdornment,
    trailingAdornment,
    wrapperClassName = "",
    loading = false,
    id,
    onBlur,
    onFocus,
    className = "",
    disabled,
    ...rest
  } = props;
  const autoId = useId();
  const inputId = id ?? autoId;
  const [focused, setFocused] = useState(false);

  const hasError = !!error;
  const hasValue = value != null && value.length > 0;
  const isFloating = focused || hasValue;

  const outlineTone = hasError
    ? "border-red-400 focus-within:border-red-500 focus-within:ring-red-100"
    : "border-zinc-300 focus-within:border-zinc-900 focus-within:ring-zinc-100";

  const paddingLeft = leadingAdornment ? "pl-11" : "pl-5";
  const paddingRight = trailingAdornment || loading ? "pr-11" : "pr-5";

  return (
    <div className={`w-full ${wrapperClassName}`}>
      <div
        className={`relative flex items-stretch rounded-full border bg-white transition-shadow duration-150 focus-within:ring-2 ${outlineTone} ${
          disabled ? "opacity-60" : ""
        }`}
      >
        {leadingAdornment && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-5 text-sm text-zinc-400"
          >
            {leadingAdornment}
          </span>
        )}
        <label
          htmlFor={inputId}
          className={`pointer-events-none absolute left-5 origin-left select-none bg-white px-1 text-zinc-500 transition-all duration-150 ${
            isFloating
              ? "top-0 -translate-y-1/2 text-[11px] tracking-wide"
              : "top-1/2 -translate-y-1/2 text-sm"
          } ${hasError ? "text-red-500" : ""}`}
        >
          {label}
        </label>
        <input
          ref={ref}
          id={inputId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={(e: FocusEvent<HTMLInputElement>) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e: FocusEvent<HTMLInputElement>) => {
            setFocused(false);
            onBlur?.(e);
          }}
          disabled={disabled}
          aria-invalid={hasError || undefined}
          aria-describedby={
            error || hint ? `${inputId}-message` : undefined
          }
          className={`w-full appearance-none rounded-full bg-transparent py-3.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none disabled:cursor-not-allowed ${paddingLeft} ${paddingRight} ${className}`}
          {...rest}
        />
        {(trailingAdornment || loading) && (
          <span className="absolute inset-y-0 right-0 flex items-center pr-4 text-sm text-zinc-500">
            {loading ? (
              <span
                aria-hidden
                className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700"
              />
            ) : (
              trailingAdornment
            )}
          </span>
        )}
      </div>
      {(error || hint) && (
        <p
          id={`${inputId}-message`}
          className={`mt-2 px-5 text-xs ${
            hasError ? "text-red-500" : "text-zinc-500"
          }`}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export const OvalInput = forwardRef<HTMLInputElement, OvalInputProps>(
  OvalInputInner,
);
OvalInput.displayName = "OvalInput";
