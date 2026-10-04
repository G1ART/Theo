"use client";

import { useState } from "react";
import Image from "next/image";
import { useT } from "@/lib/i18n/useT";
import { BodyPortal } from "@/components/ui/BodyPortal";
import { layer } from "@/lib/ui/layers";

export type GroupCard = {
  id: string;
  title: string;
  thumb: string | null;
  imageCount: number;
};

/**
 * Stack drafts the way phone icons stack into a folder.
 * Dropping one card onto another keeps the target row (its caption)
 * and treats the dropped cards as extra photos.
 */
export function BulkGroupDialog({
  cards,
  busy,
  onClose,
  onConfirm,
}: {
  cards: GroupCard[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (groups: string[][]) => void;
}) {
  const { t } = useT();
  const [stacks, setStacks] = useState<string[][]>(() => cards.map((c) => [c.id]));
  const [over, setOver] = useState<string | null>(null);
  const byId = new Map(cards.map((c) => [c.id, c]));

  function mergeOnto(targetId: string, sourceId: string) {
    if (!targetId || targetId === sourceId) return;
    setStacks((prev) => {
      const target = prev.find((s) => s[0] === targetId);
      const source = prev.find((s) => s[0] === sourceId);
      if (!target || !source) return prev;
      return prev
        .filter((s) => s[0] !== sourceId)
        .map((s) => (s[0] === targetId ? [...s, ...source] : s));
    });
  }

  const canSave = stacks.some((s) => s.length > 1);

  return (
    <BodyPortal>
    <div
      className={`fixed inset-0 ${layer.scrim} flex items-end justify-center bg-black/40 px-3 py-6 sm:items-center`}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-3xl rounded-2xl bg-white p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-zinc-900">{t("bulk.group.title")}</h2>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">{t("bulk.group.hint")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-700"
          >
            {t("bulk.group.close")}
          </button>
        </div>
        <div className="flex flex-wrap gap-3">
          {stacks.map((ids) => {
            const cover = byId.get(ids[0]!);
            if (!cover) return null;
            const count = ids.reduce((n, id) => n + (byId.get(id)?.imageCount ?? 1), 0);
            return (
              <div
                key={cover.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", cover.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(cover.id);
                }}
                onDragLeave={() => setOver((id) => (id === cover.id ? null : id))}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(null);
                  mergeOnto(cover.id, e.dataTransfer.getData("text/plain"));
                }}
                className={`flex w-28 cursor-grab flex-col items-center gap-1 rounded-xl border p-2 ${
                  over === cover.id ? "border-zinc-900 bg-zinc-50" : "border-zinc-200"
                }`}
              >
                <div className="relative h-16 w-16 overflow-hidden rounded-lg bg-zinc-200">
                  {cover.thumb ? (
                    <Image src={cover.thumb} alt="" width={64} height={64} className="h-full w-full object-cover" />
                  ) : null}
                  {count > 1 && (
                    <span className="absolute bottom-1 right-1 rounded-full bg-zinc-900 px-1.5 text-[10px] text-white">
                      {count}
                    </span>
                  )}
                </div>
                <span className="w-full truncate text-center text-[11px] text-zinc-700">{cover.title}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            disabled={!canSave || busy}
            onClick={() => onConfirm(stacks.filter((s) => s.length > 1))}
            className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {busy ? t("bulk.group.saving") : t("bulk.group.save")}
          </button>
        </div>
      </div>
    </div>
    </BodyPortal>
  );
}
