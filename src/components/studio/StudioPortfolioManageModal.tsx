"use client";

import { useEffect, useState } from "react";
import { chipButton, chipButtonPrimary } from "@/components/ds/buttonStyles";
import { useT } from "@/lib/i18n/useT";
import type { PersonaTab } from "@/lib/provenance/personaTabs";
import {
  addCustomTab,
  MAX_CUSTOM_TABS,
  MAX_TAB_LABEL_LEN,
  type StudioCustomTabV1,
  type StudioPortfolioV1,
  removeCustomTab,
} from "@/lib/studio/studioPortfolioConfig";

type Props = {
  open: boolean;
  onClose: () => void;
  portfolio: StudioPortfolioV1;
  /** Persona tabs currently shown (so we only edit labels/public for those) */
  visiblePersonaTabs: PersonaTab[];
  defaultTabLabels: Record<PersonaTab, string>;
  onSave: (next: StudioPortfolioV1) => Promise<boolean>;
};

export function StudioPortfolioManageModal({
  open,
  onClose,
  portfolio,
  visiblePersonaTabs,
  defaultTabLabels,
  onSave,
}: Props) {
  const { t } = useT();
  const [draft, setDraft] = useState<StudioPortfolioV1>(portfolio);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (open) setDraft(portfolio);
  }, [open, portfolio]);

  if (!open) return null;

  const custom = draft.custom_tabs ?? [];

  async function handleSave() {
    setSaving(true);
    try {
      const ok = await onSave(draft);
      if (ok) onClose();
    } finally {
      setSaving(false);
    }
  }

  function setPersonaLabel(tab: PersonaTab, value: string) {
    setDraft((d) => {
      const tab_labels = { ...(d.tab_labels ?? {}) };
      const t = value.trim().slice(0, MAX_TAB_LABEL_LEN);
      if (t.length === 0) delete tab_labels[tab];
      else tab_labels[tab] = t;
      return { ...d, tab_labels };
    });
  }

  function setPersonaPublic(tab: PersonaTab, value: boolean) {
    setDraft((d) => {
      const tab_public = { ...(d.tab_public ?? {}) };
      if (value) delete tab_public[tab];
      else tab_public[tab] = false;
      return { ...d, tab_public };
    });
  }

  function patchCustom(id: string, patch: Partial<StudioCustomTabV1>) {
    setDraft((d) => ({
      ...d,
      custom_tabs: (d.custom_tabs ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        role="dialog"
        aria-labelledby="studio-portfolio-manage-title"
      >
        <h2 id="studio-portfolio-manage-title" className="text-lg font-semibold text-zinc-900">
          {t("studio.portfolio.manageTitle")}
        </h2>
        <p className="mt-1 text-sm text-zinc-500">{t("studio.portfolio.manageDesc")}</p>

        <section className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            {t("studio.portfolio.defaultTabs")}
          </h3>
          <ul className="mt-2 space-y-3">
            {visiblePersonaTabs.map((tab) => (
              <li key={tab} className="rounded-xl border border-zinc-200 p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <label className="block flex-1 text-sm">
                    <span className="text-zinc-500">{t("studio.portfolio.tabName")}</span>
                    <input
                      type="text"
                      maxLength={MAX_TAB_LABEL_LEN}
                      value={draft.tab_labels?.[tab] ?? ""}
                      placeholder={defaultTabLabels[tab]}
                      onChange={(e) => setPersonaLabel(tab, e.target.value)}
                      className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm text-zinc-700 sm:shrink-0">
                    <input
                      type="checkbox"
                      checked={draft.tab_public?.[tab] !== false}
                      onChange={(e) => setPersonaPublic(tab, e.target.checked)}
                    />
                    {t("studio.portfolio.showOnPublicProfile")}
                  </label>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
              {t("studio.portfolio.customTabs")}
            </h3>
            <span className="text-xs text-zinc-400">
              {custom.length}/{MAX_CUSTOM_TABS}
            </span>
          </div>
          <ul className="mt-2 space-y-3">
            {custom.map((ct) => (
              <li key={ct.id} className="rounded-xl border border-zinc-200 p-3">
                <div className="flex flex-col gap-2">
                  <input
                    type="text"
                    maxLength={MAX_TAB_LABEL_LEN}
                    value={ct.label}
                    onChange={(e) => patchCustom(ct.id, { label: e.target.value.slice(0, MAX_TAB_LABEL_LEN) })}
                    className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm font-medium"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-sm text-zinc-700">
                      <input
                        type="checkbox"
                        checked={ct.public !== false}
                        onChange={(e) => patchCustom(ct.id, { public: e.target.checked })}
                      />
                      {t("studio.portfolio.showOnPublicProfile")}
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((d) => removeCustomTab(d, ct.id))
                      }
                      className="text-sm text-red-600 hover:underline"
                    >
                      {t("studio.portfolio.deleteCustomTab")}
                    </button>
                  </div>
                  <p className="text-xs text-zinc-400">
                    {t("studio.portfolio.customTabWorkCount").replace("{n}", String(ct.artwork_ids.length))}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              maxLength={MAX_TAB_LABEL_LEN}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("studio.portfolio.newTabPlaceholder")}
              className="flex-1 rounded-lg border border-zinc-200 px-2 py-1.5 text-sm"
            />
            <button
              type="button"
              disabled={custom.length >= MAX_CUSTOM_TABS}
              onClick={() => {
                const label = newName.trim() || t("studio.portfolio.newTabDefaultName");
                setDraft((d) => addCustomTab(d, label));
                setNewName("");
              }}
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-40"
            >
              {t("studio.portfolio.addCustomTab")}
            </button>
          </div>
        </section>

        <div className="mt-8 flex justify-end gap-2 border-t border-zinc-100 pt-4">
          <button
            type="button"
            onClick={onClose}
            className={chipButton}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className={`${chipButtonPrimary} disabled:opacity-50`}
          >
            {saving ? t("common.loading") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
