"use client";

import { useT } from "@/lib/i18n/useT";

/**
 * Right-rail widget — "Theo Board" (Aug-2026 wireframe redesign).
 *
 * Wireframe renders a scrollable list of announcement rows (Type +
 * Title + upload time + short description). We keep the visual
 * scaffolding in place with 6 placeholder rows because the backing
 * data store (`theo_board_posts` or equivalent) is not yet in the
 * schema. When it lands, swap the placeholder loop for a real fetch —
 * the row layout does not need to change.
 *
 * The "more >" affordance is intentionally rendered as a non-link
 * tooltip until the destination page exists.
 */
const PLACEHOLDER_ROWS = Array.from({ length: 6 }, (_, i) => ({ id: i }));

export function TheoBoardRail() {
  const { t } = useT();

  return (
    <section aria-label={t("rail.theoBoard.title")}>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-zinc-900">
          {t("rail.theoBoard.title")}
        </h2>
        <span
          className="text-xs text-zinc-300"
          title={t("rail.theoBoard.placeholder")}
          aria-disabled="true"
        >
          {t("rail.theoBoard.more")} ›
        </span>
      </div>
      <ul className="rounded-lg border border-zinc-200 bg-white">
        {PLACEHOLDER_ROWS.map((n, idx) => (
          <li
            key={n.id}
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
    </section>
  );
}
