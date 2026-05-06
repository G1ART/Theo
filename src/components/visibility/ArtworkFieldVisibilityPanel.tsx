"use client";

import { useEffect, useState } from "react";
import {
  getMyOwnerVisibilitySettings,
  listMyVisibilityPolicies,
  upsertVisibilityPolicy,
} from "@/lib/supabase/relationshipAccess";
import {
  type RelationshipAudience,
  type VisibilityPolicy,
  type VisibilityPresetKey,
  type VisibilityRequestMode,
  FIRST_CLASS_ARTWORK_FIELDS,
} from "@/lib/visibility/types";
import { defaultAudienceForField } from "@/lib/visibility/presets";
import { VisibilityAudiencePill } from "./VisibilityAudiencePill";
import { RequestModeSelect } from "./RequestModeSelect";
import { useT } from "@/lib/i18n/useT";
import type { MessageKey } from "@/lib/i18n/messages";
import { logBetaEventSync } from "@/lib/beta/logEvent";

type Props = {
  ownerProfileId: string;
  artworkId: string;
};

type FieldState = {
  audience: RelationshipAudience;
  requestMode: VisibilityRequestMode;
  saving: boolean;
  error: boolean;
};

function blankState(): Record<string, FieldState> {
  const out: Record<string, FieldState> = {};
  for (const f of FIRST_CLASS_ARTWORK_FIELDS) {
    out[f] = { audience: "public", requestMode: null, saving: false, error: false };
  }
  return out;
}

export function ArtworkFieldVisibilityPanel({
  ownerProfileId,
  artworkId,
}: Props) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [presetKey, setPresetKey] = useState<VisibilityPresetKey>("open_studio");
  const [policies, setPolicies] = useState<VisibilityPolicy[]>([]);
  const [state, setState] = useState<Record<string, FieldState>>(blankState);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [settingsRes, policiesRes] = await Promise.all([
        getMyOwnerVisibilitySettings(ownerProfileId),
        listMyVisibilityPolicies(ownerProfileId),
      ]);
      if (cancelled) return;
      const preset =
        (settingsRes.data?.preset_key as VisibilityPresetKey) ?? "open_studio";
      setPresetKey(preset);
      const list = policiesRes.data ?? [];
      setPolicies(list);
      const next = blankState();
      for (const f of FIRST_CLASS_ARTWORK_FIELDS) {
        const matching = list.find(
          (p) =>
            p.subject_type === "artwork" &&
            p.subject_id === artworkId &&
            p.field_key === f
        );
        next[f] = {
          audience: matching?.audience ?? defaultAudienceForField(preset, f),
          requestMode: matching?.request_mode ?? null,
          saving: false,
          error: false,
        };
      }
      setState(next);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [ownerProfileId, artworkId]);

  const update = async (
    field: string,
    next: { audience?: RelationshipAudience; requestMode?: VisibilityRequestMode }
  ) => {
    const current = state[field];
    setState((s) => ({
      ...s,
      [field]: { ...current, saving: true, error: false },
    }));
    const audience = next.audience ?? current.audience;
    const requestMode =
      next.requestMode === undefined ? current.requestMode : next.requestMode;
    const { data, error } = await upsertVisibilityPolicy({
      ownerProfileId,
      subjectType: "artwork",
      subjectId: artworkId,
      fieldKey: field,
      audience,
      requestMode,
    });
    if (error || !data) {
      setState((s) => ({
        ...s,
        [field]: { ...s[field], saving: false, error: true },
      }));
      return;
    }
    setState((s) => ({
      ...s,
      [field]: { audience, requestMode, saving: false, error: false },
    }));
    setPolicies((prev) => {
      const others = prev.filter(
        (p) =>
          !(
            p.subject_type === "artwork" &&
            p.subject_id === artworkId &&
            p.field_key === field
          )
      );
      return [data, ...others];
    });
    logBetaEventSync("visibility_policy_changed", {
      subject_type: "artwork",
      subject_id: artworkId,
      field_key: field,
      audience,
      surface: "artwork_edit",
    });
  };

  return (
    <section className="mt-8 rounded-2xl bg-zinc-50/70 px-5 py-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            {t("visibility.advanced.section")}
          </p>
          <h2 className="mt-1 text-sm font-semibold text-zinc-900">
            {t("visibility.page.title")}
          </h2>
        </div>
        <span aria-hidden className="text-zinc-400">
          {open ? "−" : "+"}
        </span>
      </button>

      {open && (
        <div className="mt-4 flex flex-col gap-3">
          {loading ? (
            <p className="text-xs text-zinc-500">
              {t("visibility.advanced.loading")}
            </p>
          ) : (
            FIRST_CLASS_ARTWORK_FIELDS.map((field) => {
              const s = state[field];
              return (
                <div
                  key={field}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white p-3 ring-1 ring-zinc-200"
                >
                  <div className="min-w-[120px]">
                    <p className="text-xs font-medium text-zinc-700">
                      {t(`visibility.field.${field}` as MessageKey)}
                    </p>
                    {s.error && (
                      <p className="mt-1 text-[11px] text-red-600">
                        {t("visibility.preset.saveFailed")}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <VisibilityAudiencePill
                      value={s.audience}
                      size="sm"
                      onChange={(audience) => update(field, { audience })}
                      disabled={s.saving}
                    />
                    <RequestModeSelect
                      value={s.requestMode}
                      onChange={(requestMode) => update(field, { requestMode })}
                      disabled={s.saving}
                    />
                  </div>
                </div>
              );
            })
          )}
          <p className="text-[11px] text-zinc-400">
            {t("visibility.preset.section")}: {t(
              `visibility.preset.${presetKey}` as MessageKey
            )}
            {policies.length > 0 ? "" : ""}
          </p>
        </div>
      )}
    </section>
  );
}
