"use client";

/**
 * UnderlineField — Signup v2 Step 4 wireframe (2026-08-20).
 *
 * Step 4's designer frame uses hairline bottom-border inputs (not the
 * oval pills of Steps 1–3). Title / Year / Medium / Size / Status /
 * Description all share this quieter "catalog card" language so the
 * artwork form reads as a studio sheet sitting beside the uploader.
 */

import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

const LABEL_CLASS = "mb-1 block text-[11px] text-zinc-600";
const LINE_CLASS =
  "w-full border-0 border-b border-zinc-400 bg-transparent py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none";

function FieldLabel({
  htmlFor,
  label,
  required,
}: {
  htmlFor: string;
  label: ReactNode;
  required?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className={LABEL_CLASS}>
      {label}
      {required ? <span aria-hidden> *</span> : null}
    </label>
  );
}

export type UnderlineInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "onChange" | "value"
> & {
  label: ReactNode;
  value: string;
  onChange: (next: string) => void;
};

export function UnderlineInput(props: UnderlineInputProps) {
  const { label, value, onChange, required, id, className = "", ...rest } = props;
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div>
      <FieldLabel htmlFor={inputId} label={label} required={required} />
      <input
        id={inputId}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className={`${LINE_CLASS} ${className}`}
        {...rest}
      />
    </div>
  );
}

export type UnderlineSelectOption = { value: string; label: ReactNode };

export type UnderlineSelectProps = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "onChange" | "value"
> & {
  label: ReactNode;
  value: string;
  onChange: (next: string) => void;
  options: readonly UnderlineSelectOption[];
  placeholder?: string;
};

export function UnderlineSelect(props: UnderlineSelectProps) {
  const {
    label,
    value,
    onChange,
    options,
    placeholder,
    required,
    id,
    className = "",
    ...rest
  } = props;
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div>
      <FieldLabel htmlFor={inputId} label={label} required={required} />
      <select
        id={inputId}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className={`${LINE_CLASS} appearance-none bg-transparent ${className}`}
        {...rest}
      >
        {placeholder ? (
          <option value="" disabled={required}>
            {placeholder}
          </option>
        ) : null}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {typeof opt.label === "string" ? opt.label : opt.value}
          </option>
        ))}
      </select>
    </div>
  );
}

export type UnderlineTextareaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "onChange" | "value"
> & {
  label: ReactNode;
  value: string;
  onChange: (next: string) => void;
};

export function UnderlineTextarea(props: UnderlineTextareaProps) {
  const { label, value, onChange, required, id, className = "", rows = 2, ...rest } = props;
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div>
      <FieldLabel htmlFor={inputId} label={label} required={required} />
      <textarea
        id={inputId}
        value={value}
        required={required}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className={`${LINE_CLASS} resize-none ${className}`}
        {...rest}
      />
    </div>
  );
}
