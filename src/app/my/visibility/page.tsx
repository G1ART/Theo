"use client";

import { useCallback, useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { PageShell } from "@/components/ds/PageShell";
import { PageHeader } from "@/components/ds/PageHeader";
import { FloorPanel } from "@/components/ds/FloorPanel";
import { SectionLabel } from "@/components/ds/SectionLabel";
import { useT } from "@/lib/i18n/useT";
import { requireSessionUid } from "@/lib/supabase/requireSessionUid";
import { supabase } from "@/lib/supabase/client";
import {
  getMyOwnerVisibilitySettings,
  setVisibilityPreset,
  canViewByRelationshipDryRun,
} from "@/lib/supabase/relationshipAccess";
import {
  type RelationshipAudience,
  type VisibilityPresetKey,
  FIRST_CLASS_ARTWORK_FIELDS,
} from "@/lib/visibility/types";
import { defaultAudienceForField } from "@/lib/visibility/presets";
import { VisibilityPresetSelector } from "@/components/visibility/VisibilityPresetSelector";
import { PreviewAsBar } from "@/components/visibility/PreviewAsBar";
import { AdvancedVisibilityPanel } from "@/components/visibility/AdvancedVisibilityPanel";
import { logBetaEventSync } from "@/lib/beta/logEvent";
import type { MessageKey } from "@/lib/i18n/messages";

const FAKE_STATE_BY_AUDIENCE: Record<
  RelationshipAudience,
  Record<string, boolean>
> = {
  public: { signed_in: false },
  signed_in: { signed_in: true },
  followers: { signed_in: true, viewer_follows_target: true },
  following: { signed_in: true, target_follows_viewer: true },
  mutuals: {
    signed_in: true,
    viewer_follows_target: true,
    target_follows_viewer: true,
  },
  approved: { signed_in: true, has_grant: true },
  delegates: { signed_in: true, is_delegate: true },
  owner_only: {},
};

type PreviewState = {
  audience: RelationshipAudience;
  loading: boolean;
  // For each first-class field, whether the simulated viewer can see it.
  fields: Record<string, boolean>;
};

function VisibilityPageInner() {
  const { t } = useT();
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [presetKey, setPresetKey] = useState<VisibilityPresetKey>("open_studio");
  const [draftPreset, setDraftPreset] = useState<VisibilityPresetKey>("open_studio");
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetMessage, setPresetMessage] = useState<string | null>(null);
  const [previewAudience, setPreviewAudience] = useState<RelationshipAudience | null>(
    null
  );
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let uid: string | null = null;
      try {
        uid = await requireSessionUid(supabase);
      } catch {
        uid = null;
      }
      if (cancelled || !uid) return;
      setOwnerId(uid);
      const { data } = await getMyOwnerVisibilitySettings(uid);
      if (cancelled) return;
      const initial = (data?.preset_key ?? "open_studio") as VisibilityPresetKey;
      setPresetKey(initial);
      setDraftPreset(initial);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSavePreset = useCallback(async () => {
    if (!ownerId) return;
    setSavingPreset(true);
    setPresetMessage(null);
    const { data, error } = await setVisibilityPreset({
      ownerProfileId: ownerId,
      presetKey: draftPreset,
    });
    setSavingPreset(false);
    if (error || !data) {
      setPresetMessage(t("visibility.preset.saveFailed"));
      return;
    }
    setPresetKey(data.preset_key);
    setPresetMessage(t("visibility.preset.saved"));
    logBetaEventSync("visibility_preset_changed", {
      preset_key: data.preset_key,
      surface: "visibility_hub",
    });
  }, [ownerId, draftPreset, t]);

  // Recompute the dry-run grid whenever previewAudience changes. We defer
  // the synchronous setStates to the next frame to dodge
  // react-hooks/set-state-in-effect — same pattern as /my/messages.
  useEffect(() => {
    let cancelled = false;
    if (!ownerId || !previewAudience) {
      const handle = requestAnimationFrame(() => {
        if (!cancelled) setPreviewState(null);
      });
      return () => {
        cancelled = true;
        cancelAnimationFrame(handle);
      };
    }
    (async () => {
      setPreviewState({ audience: previewAudience, loading: true, fields: {} });
      logBetaEventSync("preview_as_used", {
        audience: previewAudience,
        surface: "visibility_hub",
      });
      const fakeState = FAKE_STATE_BY_AUDIENCE[previewAudience];
      const fields: Record<string, boolean> = {};
      // Use the owner-wide default audience for each first-class field
      // as the "what would the viewer be tested against" query — this is
      // the calmest signal for the v1 page-level preview-as without
      // requiring the user to pick a specific artwork.
      for (const field of FIRST_CLASS_ARTWORK_FIELDS) {
        const audience = defaultAudienceForField(presetKey, field);
        const { canView } = await canViewByRelationshipDryRun({
          ownerProfileId: ownerId,
          subjectType: "artwork",
          subjectId: null,
          fieldKey: field,
          requiredAudience: audience,
          fakeState,
        });
        if (cancelled) return;
        fields[field] = canView;
      }
      if (cancelled) return;
      setPreviewState({ audience: previewAudience, loading: false, fields });
    })();
    return () => {
      cancelled = true;
    };
  }, [ownerId, previewAudience, presetKey]);

  if (!ownerId) {
    return (
      <PageShell variant="studio">
        <p className="text-sm text-zinc-500">{t("common.loading")}</p>
      </PageShell>
    );
  }

  const dirty = draftPreset !== presetKey;

  return (
    <PageShell variant="studio">
      <PageHeader
        variant="editorial"
        kicker={t("visibility.page.kicker")}
        title={t("visibility.page.title")}
        lead={t("visibility.page.subtitle")}
      />

      <div className="flex flex-col gap-6">
        <FloorPanel padding="md" aria-labelledby="visibility-preset-label">
          <SectionLabel id="visibility-preset-label" as="h2" className="mb-4">
            {t("visibility.preset.section")}
          </SectionLabel>
          <VisibilityPresetSelector
            active={draftPreset}
            onChange={setDraftPreset}
            disabled={savingPreset}
          />
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSavePreset}
              disabled={!dirty || savingPreset}
              className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              {t("visibility.preset.save")}
            </button>
            {presetMessage && (
              <span className="text-xs text-zinc-500">{presetMessage}</span>
            )}
          </div>
        </FloorPanel>

        <FloorPanel padding="md" aria-labelledby="visibility-preview-label">
          <SectionLabel id="visibility-preview-label" as="h2" className="mb-4">
            {t("visibility.previewAs.section")}
          </SectionLabel>
          <PreviewAsBar active={previewAudience} onChange={setPreviewAudience} />
          {previewState && (
            <div className="mt-5 rounded-xl bg-white p-4 ring-1 ring-zinc-200">
              {previewState.loading ? (
                <p className="text-xs text-zinc-500">
                  {t("visibility.previewAs.simulating")}
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {FIRST_CLASS_ARTWORK_FIELDS.map((field) => {
                    const can = previewState.fields[field];
                    return (
                      <li
                        key={field}
                        className="flex items-center justify-between gap-3 text-xs"
                      >
                        <span className="font-medium text-zinc-700">
                          {t(`visibility.field.${field}` as MessageKey)}
                        </span>
                        <span
                          className={
                            can
                              ? "rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-medium text-emerald-800"
                              : "rounded-full bg-zinc-100 px-2.5 py-0.5 text-[11px] font-medium text-zinc-500"
                          }
                        >
                          {can
                            ? t("visibility.previewAs.canSee")
                            : t("visibility.previewAs.cannotSee")}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </FloorPanel>

        <FloorPanel padding="md" aria-labelledby="visibility-advanced-label">
          <div className="mb-4 flex items-center justify-between gap-3">
            <SectionLabel id="visibility-advanced-label" as="h2">
              {t("visibility.advanced.section")}
            </SectionLabel>
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50"
            >
              {advancedOpen
                ? t("visibility.advanced.expanded")
                : t("visibility.advanced.collapsed")}
            </button>
          </div>
          {advancedOpen ? (
            <AdvancedVisibilityPanel
              ownerProfileId={ownerId}
              presetKey={presetKey}
            />
          ) : (
            <p className="text-xs text-zinc-500">
              {t("visibility.advanced.collapsed")}
            </p>
          )}
        </FloorPanel>
      </div>
    </PageShell>
  );
}

export default function VisibilityPage() {
  return (
    <AuthGate>
      <VisibilityPageInner />
    </AuthGate>
  );
}
