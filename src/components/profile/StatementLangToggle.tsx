"use client";

import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n/useT";

export type StatementLang = "ko" | "en";

type Texts = {
  statementKo?: string | null;
  statementEn?: string | null;
  statementLegacy?: string | null;
};

function trimOrEmpty(v: string | null | undefined): string {
  return typeof v === "string" ? v.trim() : "";
}

export function resolveStatementPair(texts: Texts): {
  ko: string;
  en: string;
  hasBoth: boolean;
  hasAny: boolean;
} {
  const ko = trimOrEmpty(texts.statementKo);
  const en = trimOrEmpty(texts.statementEn);
  const legacy = trimOrEmpty(texts.statementLegacy);
  if (ko || en) {
    return { ko, en, hasBoth: !!(ko && en), hasAny: !!(ko || en) };
  }
  return { ko: legacy, en: "", hasBoth: false, hasAny: legacy.length > 0 };
}

/**
 * In-card 한국어 | English switch. Does not change the app locale.
 * Hidden when only one language has text.
 */
export function StatementLangToggle({
  hasKo,
  hasEn,
  value,
  onChange,
}: {
  hasKo: boolean;
  hasEn: boolean;
  value: StatementLang;
  onChange: (lang: StatementLang) => void;
}) {
  const { t } = useT();
  if (!hasKo || !hasEn) return null;
  return (
    <div
      role="group"
      aria-label={t("profile.section.statement")}
      className="mb-3 inline-flex rounded-full border border-zinc-200 bg-zinc-50 p-0.5"
    >
      <button
        type="button"
        onClick={() => onChange("ko")}
        aria-pressed={value === "ko"}
        className={`rounded-full px-3 py-1 text-[11px] font-medium ${
          value === "ko"
            ? "bg-white text-zinc-900 shadow-sm"
            : "text-zinc-500 hover:text-zinc-800"
        }`}
      >
        {t("profile.statement.langKo")}
      </button>
      <button
        type="button"
        onClick={() => onChange("en")}
        aria-pressed={value === "en"}
        className={`rounded-full px-3 py-1 text-[11px] font-medium ${
          value === "en"
            ? "bg-white text-zinc-900 shadow-sm"
            : "text-zinc-500 hover:text-zinc-800"
        }`}
      >
        {t("profile.statement.langEn")}
      </button>
    </div>
  );
}

export function useStatementDisplay(texts: Texts) {
  const { locale } = useT();
  const pair = useMemo(() => resolveStatementPair(texts), [
    texts.statementKo,
    texts.statementEn,
    texts.statementLegacy,
  ]);
  const defaultLang: StatementLang =
    locale === "en" && pair.en ? "en" : pair.ko ? "ko" : "en";
  const [lang, setLang] = useState<StatementLang>(defaultLang);
  const active =
    pair.hasBoth
      ? lang === "en"
        ? pair.en
        : pair.ko
      : pair.ko || pair.en;
  return { pair, lang, setLang, active };
}
