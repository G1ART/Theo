"use client";

/**
 * QA 2026-07-28 — BilingualFieldPair (KO/EN progressive disclosure)
 *
 * A drop-in primitive that renders one primary input (or textarea) in the
 * current UI locale plus a `+ 다른 언어 추가` chip that reveals a secondary
 * slot for the other language. Mirrors the exhibition title / preface UX
 * from `NewExhibitionFormShell` so authors always see the same interaction
 * pattern across settings, upload, and exhibition create/edit.
 *
 * Principles
 * ----------
 * - Author owns the name — nothing here transliterates or auto-fills.
 * - Fully controlled: parent owns `valueKo` / `valueEn` state.
 * - When the secondary slot is visible and empty, "지우기" collapses it back
 *   to the chip (without clearing the value the user typed in the primary
 *   slot). We only hide the field — no destructive default clears.
 * - Non-empty secondary values auto-expand on mount so a returning user
 *   with two-language data sees both slots.
 * - Consumers can pass `renderAssist` to inject an AI-draft button or
 *   romanization chip (see Track C). The primitive stays i18n-agnostic
 *   otherwise.
 *
 * Deliberate omissions
 * --------------------
 * - No form context / no react-hook-form. Values are strings on both slots
 *   and read straight from `useState` in the parent surface. This keeps
 *   the primitive usable from Server Component-hydrated pages that build
 *   their own submission path.
 * - No `required` handling — the caller decides which slot is required.
 *   (Typical policy: at least one of KO/EN must be non-empty; the parent
 *   validates this before submit.)
 */

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import type { Locale } from "@/lib/i18n/locale";
import { useT } from "@/lib/i18n/useT";

type BilingualFieldPairProps = {
  /** Label shown above the primary input. */
  label: ReactNode;
  /** Optional hint rendered under the label. */
  hint?: ReactNode;
  /** i18n keys for the "+ 다른 언어 추가" chip per direction. */
  addKoKey: string;
  addEnKey: string;
  /** Placeholders per language. Falls back to `label` when omitted. */
  placeholderKo?: string;
  placeholderEn?: string;
  valueKo: string;
  valueEn: string;
  onChangeKo: (v: string) => void;
  onChangeEn: (v: string) => void;
  /** Render textarea instead of input. */
  as?: "input" | "textarea";
  /** Textarea rows when `as="textarea"`. */
  rows?: number;
  /** input `id` for the primary slot (aria/label association). */
  id?: string;
  /**
   * Optional assist slot rendered just below the primary field — used by
   * Track C to inject an AI-draft button or Romanization hint chip. The
   * primitive passes the *current primary locale* so the consumer can
   * decide direction (source → target).
   */
  renderPrimaryAssist?: (ctx: { primaryLang: "ko" | "en" }) => ReactNode;
  /**
   * Same idea, but for the secondary slot (only rendered when the
   * secondary slot is visible). Direction is inverted vs primary.
   */
  renderSecondaryAssist?: (ctx: { secondaryLang: "ko" | "en" }) => ReactNode;
  /** Force the secondary slot open (e.g. AI draft filled it). */
  forceExpanded?: boolean;
  /** Called when the user toggles the secondary slot. */
  onExpandedChange?: (expanded: boolean) => void;
  /** Additional className on the wrapper. */
  className?: string;
  /** Auto-focus the primary input on mount. */
  autoFocusPrimary?: boolean;
  /** Max input length; passed through to native `maxLength`. */
  maxLength?: number;
  /** Fires when either slot loses focus (parent may re-run validation). */
  onBlur?: () => void;
  /** Optional wrapper element around each slot, e.g. for pattern-matching
   *  the existing form column layout. Defaults to a plain `div`. */
  wrapper?: (children: ReactNode) => ReactNode;
};

function pickPrimaryLang(locale: Locale): "ko" | "en" {
  return locale === "ko" ? "ko" : "en";
}

export function BilingualFieldPair(props: BilingualFieldPairProps) {
  const {
    label,
    hint,
    addKoKey,
    addEnKey,
    placeholderKo,
    placeholderEn,
    valueKo,
    valueEn,
    onChangeKo,
    onChangeEn,
    as = "input",
    rows = 3,
    id,
    renderPrimaryAssist,
    renderSecondaryAssist,
    forceExpanded,
    onExpandedChange,
    className,
    autoFocusPrimary,
    maxLength,
    onBlur,
    wrapper,
  } = props;

  const { t, locale } = useT();
  const primaryLang = pickPrimaryLang(locale);
  const secondaryLang: "ko" | "en" = primaryLang === "ko" ? "en" : "ko";

  const primaryValue = primaryLang === "ko" ? valueKo : valueEn;
  const secondaryValue = primaryLang === "ko" ? valueEn : valueKo;
  const setPrimary = primaryLang === "ko" ? onChangeKo : onChangeEn;
  const setSecondary = primaryLang === "ko" ? onChangeEn : onChangeKo;

  const hasSecondaryContent = secondaryValue.trim().length > 0;
  const [expanded, setExpanded] = useState<boolean>(
    Boolean(forceExpanded) || hasSecondaryContent,
  );

  useEffect(() => {
    if (forceExpanded) {
      setExpanded(true);
    }
  }, [forceExpanded]);

  useEffect(() => {
    if (hasSecondaryContent && !expanded) {
      setExpanded(true);
    }
  }, [hasSecondaryContent, expanded]);

  const applyExpanded = (next: boolean) => {
    setExpanded(next);
    onExpandedChange?.(next);
  };

  const primaryChipLabel = primaryLang.toUpperCase();
  const secondaryChipLabel = secondaryLang.toUpperCase();
  const primaryPlaceholder =
    primaryLang === "ko"
      ? placeholderKo ?? ""
      : placeholderEn ?? "";
  const secondaryPlaceholder =
    secondaryLang === "ko"
      ? placeholderKo ?? ""
      : placeholderEn ?? "";
  const addSecondaryLabel = t(
    secondaryLang === "ko" ? addKoKey : addEnKey,
  );

  const renderSlot = (
    slot: "primary" | "secondary",
    value: string,
    onChange: (v: string) => void,
    lang: "ko" | "en",
    chip: string,
    placeholder: string,
  ) => {
    const inputCls =
      "w-full rounded border border-zinc-300 px-3 py-2 pr-14 text-sm";
    return (
      <div className="relative">
        {as === "textarea" ? (
          <textarea
            id={slot === "primary" ? id : undefined}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            placeholder={placeholder}
            className={`${inputCls} min-h-[100px] resize-y leading-relaxed`}
            rows={rows}
            lang={lang}
            maxLength={maxLength}
            autoFocus={slot === "primary" ? autoFocusPrimary : undefined}
          />
        ) : (
          <input
            id={slot === "primary" ? id : undefined}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            placeholder={placeholder}
            className={inputCls}
            lang={lang}
            maxLength={maxLength}
            autoFocus={slot === "primary" ? autoFocusPrimary : undefined}
          />
        )}
        <span
          className={`pointer-events-none absolute right-2 ${
            as === "textarea" ? "top-2" : "top-1/2 -translate-y-1/2"
          } rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500`}
        >
          {chip}
        </span>
      </div>
    );
  };

  const slotWrap = (children: ReactNode) =>
    wrapper ? wrapper(children) : <div className="space-y-2">{children}</div>;

  return (
    <div className={className}>
      {label && (
        <label
          htmlFor={id}
          className="mb-1 block text-sm font-medium text-zinc-700"
        >
          {label}
        </label>
      )}
      {hint && (
        <p className="mb-2 text-xs text-zinc-500">{hint}</p>
      )}
      {slotWrap(
        <>
          {renderSlot(
            "primary",
            primaryValue,
            setPrimary,
            primaryLang,
            primaryChipLabel,
            primaryPlaceholder,
          )}
          {renderPrimaryAssist?.({ primaryLang })}
          {expanded ? (
            <div className="space-y-1">
              {renderSlot(
                "secondary",
                secondaryValue,
                setSecondary,
                secondaryLang,
                secondaryChipLabel,
                secondaryPlaceholder,
              )}
              {renderSecondaryAssist?.({ secondaryLang })}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => applyExpanded(false)}
                  className="text-[11px] text-zinc-500 underline hover:text-zinc-800"
                >
                  {t("bilingual.removeSecondary")}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => applyExpanded(true)}
              className="text-xs text-zinc-500 underline hover:text-zinc-800"
            >
              {addSecondaryLabel}
            </button>
          )}
        </>,
      )}
    </div>
  );
}

export default BilingualFieldPair;
