"use client";

import { useState } from "react";
import { BodyPortal } from "@/components/ui/BodyPortal";
import { useT } from "@/lib/i18n/useT";
import type { TabDeleteMode } from "@/lib/studio/profileContentKind";
import { layer } from "@/lib/ui/layers";

export type TabDeleteWork = { id: string; title: string };
export type TabDeleteDestination = { id: string; label: string };

type Props = {
  open: boolean;
  tabLabel: string;
  works: TabDeleteWork[];
  destinations: TabDeleteDestination[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (choice: {
    mode: TabDeleteMode;
    destinationId: string | null;
    selectedIds: string[];
  }) => void;
};

/** Three choices, one dialog. System tabs never open this. */
export function ProfileTabDeleteDialog({
  open,
  tabLabel,
  works,
  destinations,
  busy,
  onClose,
  onConfirm,
}: Props) {
  const { t } = useT();
  const [mode, setMode] = useState<TabDeleteMode>("move_all");
  const [destinationId, setDestinationId] = useState<string>(destinations[0]?.id ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  if (!open) return null;

  const needsDestination = mode !== "delete_all" && (mode === "move_all" ? works.length > 0 : works.some((work) => !selected.has(work.id)));
  const destinationOk = !needsDestination || destinationId.length > 0;
  const selectionOk = mode !== "delete_selected_move_rest" || selected.size > 0;

  return (
    <BodyPortal>
      <div className={`fixed inset-0 ${layer.scrim} flex items-center justify-center bg-black/50 p-4`}>
        <div
          role="dialog"
          aria-labelledby="profile-tab-delete-title"
          className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        >
          <h2 id="profile-tab-delete-title" className="text-lg font-semibold text-zinc-900">
            {t("profile.tabs.deleteTitle").replace("{name}", tabLabel)}
          </h2>
          <div className="mt-4 space-y-3 text-sm text-zinc-800">
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="tab-delete-mode"
                checked={mode === "move_all"}
                onChange={() => setMode("move_all")}
              />
              <span>{t("profile.tabs.deleteMoveAll")}</span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="tab-delete-mode"
                checked={mode === "delete_all"}
                onChange={() => setMode("delete_all")}
              />
              <span>{t("profile.tabs.deleteAllWorks")}</span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="tab-delete-mode"
                checked={mode === "delete_selected_move_rest"}
                onChange={() => setMode("delete_selected_move_rest")}
              />
              <span>{t("profile.tabs.deleteSelectedMoveRest")}</span>
            </label>
          </div>
          {mode === "delete_selected_move_rest" && (
            <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-zinc-200 p-2">
              {works.length === 0 ? (
                <li className="text-xs text-zinc-500">{t("profile.tabs.deleteNone")}</li>
              ) : (
                works.map((work) => (
                  <li key={work.id}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selected.has(work.id)}
                        onChange={() => {
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(work.id)) next.delete(work.id);
                            else next.add(work.id);
                            return next;
                          });
                        }}
                      />
                      <span className="truncate">{work.title}</span>
                    </label>
                  </li>
                ))
              )}
            </ul>
          )}
          {needsDestination && (
            <label className="mt-4 block text-sm text-zinc-700">
              {t("profile.tabs.deleteDestination")}
              <select
                value={destinationId}
                onChange={(e) => setDestinationId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-2 text-sm"
              >
                {destinations.length === 0 ? (
                  <option value="">{t("profile.tabs.deleteNoDestination")}</option>
                ) : (
                  destinations.map((tab) => (
                    <option key={tab.id} value={tab.id}>
                      {tab.label}
                    </option>
                  ))
                )}
              </select>
            </label>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-zinc-300 px-4 py-2 text-sm text-zinc-700"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={busy || !destinationOk || !selectionOk}
              onClick={() =>
                onConfirm({
                  mode,
                  destinationId: needsDestination ? destinationId || null : null,
                  selectedIds: [...selected],
                })
              }
              className="rounded-full bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-40"
            >
              {busy ? t("common.loading") : t("profile.tabs.deleteConfirm")}
            </button>
          </div>
        </div>
      </div>
    </BodyPortal>
  );
}
