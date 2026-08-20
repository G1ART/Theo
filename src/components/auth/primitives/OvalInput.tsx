"use client";

/**
 * OvalInput — Signup v2 primitive (Phase 1, 2026-08-19; wireframe
 * pixel-fidelity pass 2026-08-20).
 *
 * Round pill-shaped text input with either a floating material-style
 * label or a static outer label above the pill, plus optional leading
 * / trailing adornments (icon buttons, `@` prefix, show/hide toggle),
 * and error / hint slots.
 *
 * The visual language is deliberately "delicate" (thin 1px stroke,
 * generous padding, small label) so it matches the front-door wire-
 * frames without conflicting with the authed-app DS.
 *
 * ## `labelStyle`
 *
 *   - `"float"` (default) — the label starts centered inside the pill
 *     and floats up to the top border on focus / when the input has a
 *     value. This is what the /onboarding legacy screens still expect,
 *     so it stays the default to avoid a fan-out refactor.
 *   - `"outer"` — the label renders as a plain static `<label>` ABOVE
 *     the pill (`mb-1.5 block text-xs font-medium text-zinc-600`). This
 *     matches the designer's updated Signup v2 wireframes (2026-08-20)
 *     where every field has a small gray label sitting above the pill.
 *     Pass `required` and we auto-append a red `*` to the label.
 *
 * ## Escape hatch: `label={null}` + `labelStyle="outer"`
 *
 * When the caller wants full control of the row above the pill (e.g.
 * `/login` v2 renders "Password" on the left and "Forgot password →"
 * on the right in the same baseline), pass `label={null}` alongside
 * `labelStyle="outer"`. The label element is skipped entirely and the
 * pill renders alone — the caller is responsible for its own outer
 * markup.
 *
 * Example (float, default — legacy /onboarding surfaces):
 *   <OvalInput label="Email" type="email" value={email} onChange={setEmail} hint="…" />
 *
 * Example (outer — Signup v2 wireframes):
 *   <OvalInput labelStyle="outer" label="Name" required value={name} onChange={setName} />
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

export type OvalInputLabelStyle = "float" | "outer";

export type OvalInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "onChange" | "value"
> & {
  /** Label above the input. Pass `null` (with `labelStyle="outer"`) to
   *  skip rendering the label — useful when the caller renders its own
   *  label row (e.g. `/login` password field w/ inline Forgot link). */
  label: ReactNode | null;
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
  /** `"float"` (default) keeps the pre-2026-08-20 floating-label
   *  behavior for /onboarding. `"outer"` renders the label statically
   *  above the pill per the Signup v2 wireframes. */
  labelStyle?: OvalInputLabelStyle;
  /** Widen the right padding so a text link (e.g. "Forgot Password?")
   *  can sit inside the oval without colliding with typed text. */
  trailingWide?: boolean;
  /** `"compact"` is the login wireframe oval (thinner padding, no
   *  focus ring). Default keeps the signup-step rhythm. */
  density?: "default" | "compact";
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
    labelStyle = "float",
    required,
    trailingWide = false,
    density = "default",
    ...rest
  } = props;
  const autoId = useId();
  const inputId = id ?? autoId;
  const [focused, setFocused] = useState(false);

  const hasError = !!error;
  const hasValue = value != null && value.length > 0;
  const isFloating = focused || hasValue;

  const compact = density === "compact";
  const outlineTone = hasError
    ? "border-red-400 focus-within:border-red-500 focus-within:ring-red-100"
    : compact
    ? "border-zinc-400 focus-within:border-zinc-900"
    : "border-zinc-300 focus-within:border-zinc-900 focus-within:ring-zinc-100";

  const paddingLeft = leadingAdornment ? "pl-11" : "pl-5";
  const paddingRight =
    trailingAdornment || loading
      ? trailingWide
        ? "pr-32 sm:pr-36"
        : "pr-11"
      : "pr-5";

  // Outer-mode: static label above the pill. `label === null` is the
  // escape hatch — caller owns the label row.
  const outerLabel =
    labelStyle === "outer" && label !== null ? (
      <label
        htmlFor={inputId}
        className={`mb-1.5 block px-1 text-xs ${
          hasError ? "text-red-500" : "text-zinc-600"
        }`}
      >
        {label}
        {required ? <span aria-hidden className="ml-0.5 text-red-500">*</span> : null}
      </label>
    ) : null;

  return (
    <div className={`w-full ${wrapperClassName}`}>
      {outerLabel}
      <div
        className={`relative flex items-stretch rounded-full border bg-white transition-colors duration-150 ${
          compact ? "" : "focus-within:ring-2"
        } ${outlineTone} ${
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
        {labelStyle === "float" && label !== null && (
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
        )}
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
          required={required}
          aria-invalid={hasError || undefined}
          aria-describedby={
            error || hint ? `${inputId}-message` : undefined
          }
          className={`w-full appearance-none rounded-full bg-transparent text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none disabled:cursor-not-allowed ${
            compact ? "py-2.5" : "py-3.5"
          } ${paddingLeft} ${paddingRight} ${className}`}
          {...rest}
        />
        {(trailingAdornment || loading) && (
          <span className="absolute inset-y-0 right-0 flex items-center pr-5 text-sm text-zinc-500">
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
