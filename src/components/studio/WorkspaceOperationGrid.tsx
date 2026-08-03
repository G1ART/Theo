"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useT } from "@/lib/i18n/useT";

export type WorkspaceTileKey =
  | "drafts"
  | "inquiries"
  | "ownership"
  | "my_exhibitions"
  | "provenance";

export type WorkspaceTile = {
  key: WorkspaceTileKey;
  labelKey: string;
  subtitleKey: string;
  href: string;
  /** Count value; null renders an em-dash placeholder. */
  value: number | null;
  /** Optional urgency pill (e.g. "unread N"). */
  badge?: string | null;
  /** Icon glyph (SVG or emoji-like React node). */
  icon: ReactNode;
};

type Props = {
  tiles: WorkspaceTile[];
};

/**
 * Workspace hub grid (Aug-2026 redesign).
 *
 * Renders the 5 workspace domain tiles (Drafts, Inquiries, Ownership,
 * My Exhibitions, Provenance). Visually distinct from the old 2×4
 * StudioOperationGrid — each tile leads with an icon glyph and a big
 * count, with the label + subtitle stacked below. Keeps the same 2-3
 * column responsive rhythm so the workspace hub feels intentional at
 * every breakpoint.
 */
export function WorkspaceOperationGrid({ tiles }: Props) {
  const { t } = useT();
  if (tiles.length === 0) return null;
  return (
    <section
      aria-label={t("workspace.hub.title")}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      {tiles.map((tile) => (
        <Link
          key={tile.key}
          href={tile.href}
          className="group flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-5 transition-all hover:border-zinc-400 hover:shadow-sm"
        >
          <div className="flex items-center justify-between">
            <span
              aria-hidden
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700 group-hover:bg-zinc-900 group-hover:text-white"
            >
              {tile.icon}
            </span>
            {tile.badge && (
              <span className="inline-flex items-center rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-medium text-white">
                {tile.badge}
              </span>
            )}
          </div>
          <p className="text-3xl font-semibold tabular-nums text-zinc-900">
            {tile.value == null ? "—" : tile.value.toLocaleString()}
          </p>
          <div>
            <p className="text-sm font-semibold text-zinc-900">
              {t(tile.labelKey)}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              {t(tile.subtitleKey)}
            </p>
          </div>
        </Link>
      ))}
    </section>
  );
}
