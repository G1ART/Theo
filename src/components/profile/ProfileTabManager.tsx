"use client";

import { useState } from "react";
import { LaneChips, type LaneOption } from "@/components/ds";
import { ProfileTabCreateDialog } from "@/components/profile/ProfileTabCreateDialog";
import { TabReorderList } from "@/components/profile/TabReorderList";
import { StudioPortfolioManageModal } from "@/components/studio/StudioPortfolioManageModal";
import { useT } from "@/lib/i18n/useT";
import { persistStudioPortfolio } from "@/lib/studio/persistStudioPortfolio";
import type { PersonaTab } from "@/lib/provenance/personaTabs";
import type { ProfileContentKind } from "@/lib/studio/profileContentKind";
import {
  addCustomTab,
  type ActiveStudioTab,
  type StudioPortfolioV1,
  type StudioStripTab,
} from "@/lib/studio/studioPortfolioConfig";

type Props = {
  isOwner: boolean;
  stripPublic: StudioStripTab[];
  stripRows: StudioStripTab[];
  active: ActiveStudioTab;
  onActiveChange: (next: ActiveStudioTab) => void;
  portfolio: StudioPortfolioV1;
  defaultTabLabels: Record<PersonaTab, string>;
  works?: { id: string; title: string; artistId: string }[];
  profileId?: string;
  onPersisted: () => void;
  onToast: (msg: string) => void;
};

function isActiveTab(row: StudioStripTab, active: ActiveStudioTab): boolean {
  if (active.kind === "persona") {
    return row.kind === "persona" && row.personaTab === active.tab;
  }
  return row.kind === "custom" && row.customId === active.id;
}

/**
 * Public-profile tab strip + owner tab management.
 *
 * Reuses `StudioPortfolioManageModal` and `persistStudioPortfolio` so
 * rename / visibility / custom tabs / strip order stay on the same
 * `studio_portfolio` payload the old studio panel wrote.
 */
export function ProfileTabManager({
  isOwner,
  stripPublic,
  stripRows,
  active,
  onActiveChange,
  portfolio,
  defaultTabLabels,
  works = [],
  profileId = "",
  onPersisted,
  onToast,
}: Props) {
  const { t } = useT();
  const [manageOpen, setManageOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);
  const [stripDraft, setStripDraft] = useState<StudioStripTab[]>([]);
  const [saving, setSaving] = useState(false);

  const visiblePersonaTabs = stripRows
    .filter((r) => r.kind === "persona")
    .map((r) => r.personaTab!);

  async function persist(next: StudioPortfolioV1): Promise<boolean> {
    const { ok } = await persistStudioPortfolio(next);
    if (!ok) {
      onToast(t("common.tryAgain"));
      return false;
    }
    onPersisted();
    onToast(t("common.saved"));
    return true;
  }

  if (stripPublic.length === 0 && !isOwner) return null;

  const stripOptions: LaneOption<string>[] = stripPublic.map((row) => ({
    id: row.key,
    label: `${row.label} (${row.count})`,
  }));
  const activeStripKey = stripPublic.find((row) => isActiveTab(row, active))?.key ?? "";

  const list = stripDraft.length > 0 ? stripDraft : stripRows;

  return (
    <div className="mb-4 border-b border-zinc-200 pb-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {isOwner && reorderMode ? (
          <>
            <TabReorderList
              rows={list}
              onChange={(next) => setStripDraft(next)}
            />
            <div className="flex w-full justify-end gap-2 sm:ml-auto sm:w-auto">
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                void (async () => {
                  const draft = stripDraft.length > 0 ? stripDraft : stripRows;
                  const tab_strip_order = draft.map((r) =>
                    r.kind === "persona" ? r.personaTab! : `c:${r.customId!}`
                  );
                  setSaving(true);
                  const ok = await persist({ ...portfolio, tab_strip_order });
                  setSaving(false);
                  if (!ok) return;
                  setReorderMode(false);
                  setStripDraft([]);
                })();
              }}
              className="rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {saving ? t("common.loading") : t("common.save")}
            </button>
            <button
              type="button"
              onClick={() => {
                setReorderMode(false);
                setStripDraft([]);
              }}
              className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              {t("common.cancel")}
            </button>
            </div>
          </>
        ) : (
          <>
            {stripPublic.length > 0 && (
              <div className="min-w-0 overflow-x-auto">
              <LaneChips
                variant="lane"
                options={stripOptions}
                active={activeStripKey}
                onChange={(key) => {
                  const row = stripPublic.find((r) => r.key === key);
                  if (!row) return;
                  if (row.kind === "persona") {
                    onActiveChange({ kind: "persona", tab: row.personaTab! });
                  } else {
                    onActiveChange({ kind: "custom", id: row.customId! });
                  }
                }}
                className="min-w-0 flex-nowrap whitespace-nowrap border-0 pb-0 [flex-wrap:nowrap]"
                data-tour="public-profile-tab-strip"
              />
              </div>
            )}
            {isOwner && (
              <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:ml-auto sm:w-auto">
                {stripRows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setStripDraft(stripRows);
                      setReorderMode(true);
                    }}
                    className="inline-flex items-center justify-center rounded-full border border-zinc-300 bg-white px-4 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 hover:border-zinc-500"
                  >
                    {t("profile.tabs.reorder")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="inline-flex items-center justify-center rounded-full border border-zinc-300 bg-white px-4 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 hover:border-zinc-500"
                >
                  {t("studio.portfolio.addCustomTab")}
                </button>
                <button
                  type="button"
                  data-tour="public-profile-tab-settings"
                  onClick={() => setManageOpen(true)}
                  className="inline-flex items-center justify-center rounded-full border border-zinc-300 bg-white px-4 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 hover:border-zinc-500"
                >
                  {t("studio.portfolio.manageTabs")}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {isOwner && (
        <>
        <StudioPortfolioManageModal
          open={manageOpen}
          onClose={() => setManageOpen(false)}
          portfolio={portfolio}
          visiblePersonaTabs={visiblePersonaTabs}
          defaultTabLabels={defaultTabLabels}
          works={works}
          profileId={profileId}
          onSave={persist}
        />
        <ProfileTabCreateDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreate={(label, kind: ProfileContentKind) => {
            void persist(addCustomTab(portfolio, label, kind));
          }}
        />
        </>
      )}
    </div>
  );
}
