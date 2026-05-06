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
} from "@/lib/visibility/types";
import { defaultAudienceForField } from "@/lib/visibility/presets";
import { VisibilityAudiencePill } from "./VisibilityAudiencePill";
import { RequestModeSelect } from "./RequestModeSelect";
import { useT } from "@/lib/i18n/useT";
import { logBetaEventSync } from "@/lib/beta/logEvent";

type Props = {
  ownerProfileId: string;
  roomId: string;
};

export function RoomVisibilityPill({ ownerProfileId, roomId }: Props) {
  const { t } = useT();
  const [audience, setAudience] = useState<RelationshipAudience>("public");
  const [requestMode, setRequestMode] = useState<VisibilityRequestMode>(null);
  const [preset, setPreset] = useState<VisibilityPresetKey>("open_studio");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [settingsRes, policiesRes] = await Promise.all([
        getMyOwnerVisibilitySettings(ownerProfileId),
        listMyVisibilityPolicies(ownerProfileId),
      ]);
      if (cancelled) return;
      const presetKey =
        (settingsRes.data?.preset_key as VisibilityPresetKey) ?? "open_studio";
      setPreset(presetKey);
      const list: VisibilityPolicy[] = policiesRes.data ?? [];
      const matching = list.find(
        (p) =>
          p.subject_type === "room" &&
          p.subject_id === roomId &&
          p.field_key === "*"
      );
      setAudience(
        matching?.audience ?? defaultAudienceForField(presetKey, "*")
      );
      setRequestMode(matching?.request_mode ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [ownerProfileId, roomId]);

  const update = async (next: {
    audience?: RelationshipAudience;
    requestMode?: VisibilityRequestMode;
  }) => {
    setSaving(true);
    setError(false);
    const a = next.audience ?? audience;
    const r = next.requestMode === undefined ? requestMode : next.requestMode;
    const { data, error: e } = await upsertVisibilityPolicy({
      ownerProfileId,
      subjectType: "room",
      subjectId: roomId,
      fieldKey: "*",
      audience: a,
      requestMode: r,
    });
    setSaving(false);
    if (e || !data) {
      setError(true);
      return;
    }
    setAudience(a);
    setRequestMode(r);
    logBetaEventSync("visibility_policy_changed", {
      subject_type: "room",
      subject_id: roomId,
      field_key: "*",
      audience: a,
      surface: "room_edit",
    });
  };

  if (loading) {
    return (
      <p className="text-xs text-zinc-500">{t("visibility.advanced.loading")}</p>
    );
  }

  void preset; // intentionally referenced for default audience seeding above

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
        {t("visibility.field.room")}
      </span>
      <VisibilityAudiencePill
        value={audience}
        size="sm"
        onChange={(a) => update({ audience: a })}
        disabled={saving}
      />
      <RequestModeSelect
        value={requestMode}
        onChange={(r) => update({ requestMode: r })}
        disabled={saving}
      />
      {error && (
        <span className="text-[11px] text-red-600">
          {t("visibility.preset.saveFailed")}
        </span>
      )}
    </div>
  );
}
