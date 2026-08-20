"use client";

/**
 * OvalSelect — Signup v2 primitive (Phase 1, 2026-08-19; wireframe
 * pixel-fidelity pass 2026-08-20).
 *
 * Round pill-shaped select with a custom dropdown menu. Matches
 * `OvalInput` visually so a stack of "이름 / 나이대 / 역할" reads as
 * one rhythm. No search / typeahead — the wireframes only use small
 * closed sets (age band, main / secondary role, gender).
 *
 * Keyboard support: Enter / Space toggles, ArrowUp/Down cycles
 * options, Escape closes.
 *
 * ## `labelStyle`
 *
 *   - `"float"` (default) — floating-material label that starts inside
 *     the pill and lifts to the top border when the select is open or
 *     a value is selected. Preserves the pre-2026-08-20 behavior.
 *   - `"outer"` — static gray label above the pill (matches the Signup
 *     v2 wireframe row). `required` auto-appends a red `*` to the
 *     label. This is the mode every Step 3 select uses.
 *
 * Example:
 *   <OvalSelect
 *     labelStyle="outer"
 *     label="Primary Role"
 *     required
 *     value={role}
 *     onChange={setRole}
 *     options={[{ value: "artist", label: "아티스트" }, ...]}
 *   />
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

export type OvalSelectOption = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};

export type OvalSelectLabelStyle = "float" | "outer";

export type OvalSelectProps = {
  label: ReactNode | null;
  value: string;
  onChange: (next: string) => void;
  options: readonly OvalSelectOption[];
  hint?: ReactNode;
  error?: ReactNode;
  placeholder?: ReactNode;
  disabled?: boolean;
  id?: string;
  wrapperClassName?: string;
  /** `"float"` (default) or `"outer"` (Signup v2 wireframe). See file
   *  header for details. */
  labelStyle?: OvalSelectLabelStyle;
  /** When `labelStyle === "outer"`, appends a red `*` to the label. */
  required?: boolean;
};

export function OvalSelect(props: OvalSelectProps) {
  const {
    label,
    value,
    onChange,
    options,
    hint,
    error,
    placeholder,
    disabled = false,
    id,
    wrapperClassName = "",
    labelStyle = "float",
    required = false,
  } = props;
  const autoId = useId();
  const inputId = id ?? autoId;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const currentIndex = useMemo(
    () => options.findIndex((o) => o.value === value),
    [options, value],
  );

  const selected = currentIndex >= 0 ? options[currentIndex] : null;
  const hasValue = !!selected;

  const hasError = !!error;

  const outlineTone = hasError
    ? "border-red-400 focus-within:border-red-500 focus-within:ring-red-100"
    : "border-zinc-300 focus-within:border-zinc-900 focus-within:ring-zinc-100";

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const openDropdown = useCallback(() => {
    if (disabled) return;
    setOpen(true);
    setActiveIndex(currentIndex >= 0 ? currentIndex : 0);
  }, [disabled, currentIndex]);

  const commitChoice = useCallback(
    (idx: number) => {
      const opt = options[idx];
      if (!opt || opt.disabled) return;
      onChange(opt.value);
      setOpen(false);
      buttonRef.current?.focus();
    },
    [options, onChange],
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        openDropdown();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((idx) => Math.min(options.length - 1, (idx < 0 ? -1 : idx) + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((idx) => Math.max(0, (idx < 0 ? options.length : idx) - 1));
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (activeIndex >= 0) commitChoice(activeIndex);
    }
  };

  const outerLabel =
    labelStyle === "outer" && label !== null ? (
      <label
        htmlFor={inputId}
        className={`mb-1.5 block px-1 text-xs font-medium ${
          hasError ? "text-red-500" : "text-zinc-600"
        }`}
      >
        {label}
        {required ? <span aria-hidden className="ml-0.5 text-red-500">*</span> : null}
      </label>
    ) : null;

  return (
    <div className={`w-full ${wrapperClassName}`} ref={wrapperRef}>
      {outerLabel}
      <div
        className={`relative rounded-full border bg-white transition-shadow duration-150 focus-within:ring-2 ${outlineTone} ${
          disabled ? "opacity-60" : ""
        }`}
      >
        {labelStyle === "float" && label !== null && (
          <label
            htmlFor={inputId}
            className={`pointer-events-none absolute left-5 origin-left select-none bg-white px-1 text-zinc-500 transition-all duration-150 ${
              open || hasValue
                ? "top-0 -translate-y-1/2 text-[11px] tracking-wide"
                : "top-1/2 -translate-y-1/2 text-sm"
            } ${hasError ? "text-red-500" : ""}`}
          >
            {label}
          </label>
        )}
        <button
          ref={buttonRef}
          id={inputId}
          type="button"
          disabled={disabled}
          onClick={() => (open ? setOpen(false) : openDropdown())}
          onKeyDown={handleKeyDown}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-describedby={error || hint ? `${inputId}-message` : undefined}
          className="flex w-full items-center justify-between rounded-full py-3.5 pl-5 pr-4 text-left text-sm text-zinc-900 disabled:cursor-not-allowed"
        >
          <span className={hasValue ? "text-zinc-900" : "text-zinc-400"}>
            {selected?.label ?? placeholder ?? " "}
          </span>
          <span
            aria-hidden
            className={`ml-3 text-xs text-zinc-500 transition-transform duration-150 ${
              open ? "rotate-180" : ""
            }`}
          >
            ▾
          </span>
        </button>
        {open && (
          <ul
            ref={listRef}
            role="listbox"
            aria-labelledby={inputId}
            className="absolute left-1/2 top-full z-30 mt-2 max-h-72 w-[min(24rem,calc(100%-1rem))] -translate-x-1/2 overflow-auto rounded-3xl border border-zinc-200 bg-white py-2 shadow-lg"
          >
            {options.map((opt, i) => {
              const isActive = i === activeIndex;
              const isSelected = opt.value === value;
              return (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={opt.disabled || undefined}
                  onMouseEnter={() => setActiveIndex(i)}
                  onMouseDown={(e) => {
                    // Prevent the button from losing focus before we can
                    // register the click (mousedown fires first).
                    e.preventDefault();
                    commitChoice(i);
                  }}
                  className={`flex cursor-pointer items-center justify-between px-5 py-2.5 text-sm ${
                    opt.disabled
                      ? "cursor-not-allowed text-zinc-400"
                      : isActive
                      ? "bg-zinc-100 text-zinc-900"
                      : "text-zinc-700 hover:bg-zinc-50"
                  }`}
                >
                  <span>{opt.label}</span>
                  {isSelected && (
                    <span aria-hidden className="text-xs text-zinc-500">
                      ✓
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
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
