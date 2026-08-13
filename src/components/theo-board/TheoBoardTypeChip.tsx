"use client";

import { useT } from "@/lib/i18n/useT";
import {
  type TheoBoardType,
  theoBoardTypeChipClass,
  theoBoardTypeLabelKey,
} from "@/lib/supabase/theoBoard";

export function TheoBoardTypeChip({ type }: { type: TheoBoardType }) {
  const { t } = useT();
  return (
    <span
      className={`mt-0.5 shrink-0 rounded px-2 py-0.5 text-[10px] font-medium ${theoBoardTypeChipClass(type)}`}
    >
      {t(theoBoardTypeLabelKey(type))}
    </span>
  );
}

export function TheoBoardPlaceholderRows() {
  const { t } = useT();
  return (
    <ul className="rounded-lg border border-zinc-200 bg-white">
      {Array.from({ length: 6 }, (_, idx) => (
        <li
          key={idx}
          className={`flex items-start gap-3 p-3 ${
            idx > 0 ? "border-t border-zinc-100" : ""
          }`}
        >
          <span className="mt-0.5 shrink-0 rounded bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
            {t("shell.newsType")}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <p className="truncate text-sm text-zinc-400">
                {t("shell.newsItemTitle")}
              </p>
              <span className="shrink-0 text-[11px] text-zinc-300">
                {t("shell.newsItemTime")}
              </span>
            </div>
            <p className="truncate text-xs text-zinc-300">
              {t("shell.newsItemDesc")}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
