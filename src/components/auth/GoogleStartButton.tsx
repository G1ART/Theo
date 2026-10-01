"use client";

import { useT } from "@/lib/i18n/useT";

/** Outlined "Start with Google" pill. The word Google keeps the
 *  brand colors; the rest follows zinc tokens so dark mode stays
 *  readable. */
export function GoogleStartButton({
  onClick,
  disabled,
  loading,
}: {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const { t } = useT();
  const lead = t("auth.loginV2.quickStart.lead");
  const trail = t("auth.loginV2.quickStart.trail");
  const busy = disabled || loading;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={t("auth.loginV2.quickStart.googleAria")}
      className="inline-flex items-center justify-center rounded-full border border-zinc-300 bg-white px-5 py-2 text-sm text-zinc-800 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? (
        <span
          aria-hidden
          className="mr-2 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent"
        />
      ) : null}
      {lead ? <span>{lead} </span> : null}
      <span aria-hidden className="font-medium tracking-tight">
        <span className="text-[#4285F4]">G</span>
        <span className="text-[#EA4335]">o</span>
        <span className="text-[#FBBC05]">o</span>
        <span className="text-[#34A853]">g</span>
        <span className="text-[#4285F4]">l</span>
        <span className="text-[#EA4335]">e</span>
      </span>
      {trail ? <span>{trail}</span> : null}
    </button>
  );
}
