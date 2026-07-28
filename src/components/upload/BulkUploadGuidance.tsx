"use client";

import {
  BULK_MAX_FILES_PER_BATCH,
  BULK_MY_DRAFTS_QUERY_LIMIT,
  UPLOAD_MAX_COMPRESSIBLE_MB_LABEL,
} from "@/lib/upload/limits";

type T = (key: string) => string;

type Props = {
  t: T;
  pendingCount: number;
  draftCount: number;
};

/**
 * Prominent, scannable limits for bulk upload — file size, batch size, list cap, website match.
 */
export function BulkUploadGuidance({ t, pendingCount, draftCount }: Props) {
  const sizeNote = t("bulk.guidance.sizeNote").replace("{maxMb}", String(UPLOAD_MAX_COMPRESSIBLE_MB_LABEL));
  const batchNote = t("bulk.guidance.batchNote").replace("{n}", String(BULK_MAX_FILES_PER_BATCH));
  const listNote = t("bulk.guidance.listNote").replace("{n}", String(BULK_MY_DRAFTS_QUERY_LIMIT));
  const matchNote = t("bulk.guidance.matchNote");

  return (
    <aside className="mb-6 overflow-hidden rounded-2xl border border-zinc-200/90 bg-gradient-to-b from-zinc-50/90 to-white shadow-sm ring-1 ring-zinc-900/[0.04]">
      <div className="border-b border-zinc-100/80 bg-white/60 px-5 py-3">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-900">{t("bulk.guidance.title")}</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{t("bulk.guidance.lead")}</p>
      </div>
      <ul className="space-y-3 px-5 py-4 text-sm leading-relaxed text-zinc-700">
        <li className="flex gap-3">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-bold text-white">
            1
          </span>
          <span>{sizeNote}</span>
        </li>
        <li className="flex gap-3">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-bold text-white">
            2
          </span>
          <span>{batchNote}</span>
        </li>
        <li className="flex gap-3">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-bold text-white">
            3
          </span>
          <span>{listNote}</span>
        </li>
        <li className="flex gap-3">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-bold text-white">
            4
          </span>
          <span>{matchNote}</span>
        </li>
      </ul>
      {(pendingCount > 0 || draftCount >= BULK_MY_DRAFTS_QUERY_LIMIT) && (
        <div className="border-t border-zinc-100 bg-amber-50/50 px-5 py-3 text-xs leading-relaxed text-amber-950/90">
          {pendingCount > 0 && (
            <p>
              {t("bulk.guidance.pendingStatus")
                .replace("{pending}", String(pendingCount))
                .replace("{max}", String(BULK_MAX_FILES_PER_BATCH))}
            </p>
          )}
          {draftCount >= BULK_MY_DRAFTS_QUERY_LIMIT && (
            <p className={pendingCount > 0 ? "mt-1.5" : ""}>{t("bulk.guidance.draftListFull")}</p>
          )}
        </div>
      )}
    </aside>
  );
}
