"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listMyArtworks, type ArtworkWithLikes } from "@/lib/supabase/artworks";
import {
  listMyVisibilityPolicies,
  upsertVisibilityPolicy,
} from "@/lib/supabase/relationshipAccess";
import {
  type RelationshipAudience,
  type VisibilityPolicy,
  type VisibilityRequestMode,
  FIRST_CLASS_ARTWORK_FIELDS,
} from "@/lib/visibility/types";
import { defaultAudienceForField } from "@/lib/visibility/presets";
import type { VisibilityPresetKey } from "@/lib/visibility/types";
import { VisibilityAudiencePill } from "./VisibilityAudiencePill";
import { RequestModeSelect } from "./RequestModeSelect";
import { useT } from "@/lib/i18n/useT";
import type { MessageKey } from "@/lib/i18n/messages";
import { logBetaEventSync } from "@/lib/beta/logEvent";

type Props = {
  ownerProfileId: string;
  presetKey: VisibilityPresetKey;
};

type RowKey = string;

function policyKey(
  subjectType: "artwork",
  subjectId: string,
  fieldKey: string
): RowKey {
  return `${subjectType}:${subjectId}:${fieldKey}`;
}

function findPolicy(
  policies: VisibilityPolicy[],
  subjectId: string,
  fieldKey: string
): VisibilityPolicy | null {
  return (
    policies.find(
      (p) =>
        p.subject_type === "artwork" &&
        p.subject_id === subjectId &&
        p.field_key === fieldKey
    ) ?? null
  );
}

export function AdvancedVisibilityPanel({ ownerProfileId, presetKey }: Props) {
  const { t } = useT();
  const [artworks, setArtworks] = useState<ArtworkWithLikes[]>([]);
  const [policies, setPolicies] = useState<VisibilityPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<RowKey | null>(null);
  const [errorKey, setErrorKey] = useState<RowKey | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [artRes, polRes] = await Promise.all([
        listMyArtworks({ limit: 25, forProfileId: ownerProfileId }),
        listMyVisibilityPolicies(ownerProfileId),
      ]);
      if (cancelled) return;
      if (!artRes.error) setArtworks(artRes.data);
      if (!polRes.error) setPolicies(polRes.data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [ownerProfileId]);

  const handleAudienceChange = async (
    artworkId: string,
    fieldKey: string,
    next: RelationshipAudience
  ) => {
    const k = policyKey("artwork", artworkId, fieldKey);
    setSavingKey(k);
    setErrorKey(null);
    const existing = findPolicy(policies, artworkId, fieldKey);
    const requestMode = existing?.request_mode ?? null;
    const { data, error } = await upsertVisibilityPolicy({
      ownerProfileId,
      subjectType: "artwork",
      subjectId: artworkId,
      fieldKey,
      audience: next,
      requestMode,
    });
    setSavingKey(null);
    if (error || !data) {
      setErrorKey(k);
      return;
    }
    setPolicies((prev) => {
      const others = prev.filter(
        (p) =>
          !(
            p.subject_type === "artwork" &&
            p.subject_id === artworkId &&
            p.field_key === fieldKey
          )
      );
      return [data, ...others];
    });
    logBetaEventSync("visibility_policy_changed", {
      subject_type: "artwork",
      subject_id: artworkId,
      field_key: fieldKey,
      audience: next,
      surface: "advanced_panel",
    });
  };

  const handleRequestModeChange = async (
    artworkId: string,
    fieldKey: string,
    next: VisibilityRequestMode
  ) => {
    const k = policyKey("artwork", artworkId, fieldKey);
    setSavingKey(k);
    setErrorKey(null);
    const existing = findPolicy(policies, artworkId, fieldKey);
    const audience: RelationshipAudience =
      existing?.audience ?? defaultAudienceForField(presetKey, fieldKey);
    const { data, error } = await upsertVisibilityPolicy({
      ownerProfileId,
      subjectType: "artwork",
      subjectId: artworkId,
      fieldKey,
      audience,
      requestMode: next,
    });
    setSavingKey(null);
    if (error || !data) {
      setErrorKey(k);
      return;
    }
    setPolicies((prev) => {
      const others = prev.filter(
        (p) =>
          !(
            p.subject_type === "artwork" &&
            p.subject_id === artworkId &&
            p.field_key === fieldKey
          )
      );
      return [data, ...others];
    });
    logBetaEventSync("visibility_policy_changed", {
      subject_type: "artwork",
      subject_id: artworkId,
      field_key: fieldKey,
      audience,
      surface: "advanced_panel",
    });
  };

  if (loading) {
    return <p className="text-xs text-zinc-500">{t("visibility.advanced.loading")}</p>;
  }

  if (artworks.length === 0) {
    return (
      <p className="text-xs text-zinc-500">{t("visibility.advanced.empty")}</p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {artworks.map((art) => (
        <ArtworkRow
          key={art.id}
          artwork={art}
          policies={policies}
          presetKey={presetKey}
          onAudienceChange={handleAudienceChange}
          onRequestModeChange={handleRequestModeChange}
          savingKey={savingKey}
          errorKey={errorKey}
        />
      ))}
    </div>
  );
}

function ArtworkRow({
  artwork,
  policies,
  presetKey,
  onAudienceChange,
  onRequestModeChange,
  savingKey,
  errorKey,
}: {
  artwork: ArtworkWithLikes;
  policies: VisibilityPolicy[];
  presetKey: VisibilityPresetKey;
  onAudienceChange: (
    artworkId: string,
    fieldKey: string,
    next: RelationshipAudience
  ) => void;
  onRequestModeChange: (
    artworkId: string,
    fieldKey: string,
    next: VisibilityRequestMode
  ) => void;
  savingKey: RowKey | null;
  errorKey: RowKey | null;
}) {
  const { t } = useT();
  const title = artwork.title?.trim() || t("room.untitledArtwork");
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/artwork/${artwork.id}/edit`}
          className="text-sm font-semibold text-zinc-900 hover:underline"
        >
          {title}
        </Link>
        <span className="text-[11px] text-zinc-400">
          {artwork.year ?? ""}
        </span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {FIRST_CLASS_ARTWORK_FIELDS.map((field) => {
          const policy = findPolicy(policies, artwork.id, field);
          const audience: RelationshipAudience =
            policy?.audience ?? defaultAudienceForField(presetKey, field);
          const requestMode: VisibilityRequestMode = policy?.request_mode ?? null;
          const k = `artwork:${artwork.id}:${field}`;
          return (
            <div
              key={field}
              className="flex flex-col gap-2 rounded-lg bg-zinc-50/70 p-3"
            >
              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                {t(`visibility.field.${field}` as MessageKey)}
              </p>
              <VisibilityAudiencePill
                value={audience}
                size="sm"
                onChange={(next) => onAudienceChange(artwork.id, field, next)}
                disabled={savingKey === k}
                ariaLabel={`${title} — ${t(
                  `visibility.field.${field}` as MessageKey
                )}`}
              />
              <RequestModeSelect
                value={requestMode}
                onChange={(next) =>
                  onRequestModeChange(artwork.id, field, next)
                }
                disabled={savingKey === k}
              />
              {errorKey === k && (
                <p className="text-[11px] text-red-600">
                  {t("visibility.preset.saveFailed")}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

