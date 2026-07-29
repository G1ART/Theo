"use client";

/**
 * QA 2026-07-29 (Track δ) — Layer 4 벌크 이중언어 정리 대시보드.
 *
 * 목적:
 *   기존 유저가 프로필/작품/전시의 다른 언어 슬롯을 한자리에서 채우도록
 *   돕는 페이지. Layer 2 배너의 primary CTA 가 여기로 딥링크되고, 사이드바
 *   설정 아래 링크에서도 접근 가능하다.
 *
 * 원칙:
 *   1. 자동 저장 금지 — AI 초안 은 편집창을 채워 주기만 하고, 저장은 사용자
 *      가 명시적으로 눌러야 반영된다.
 *   2. 소유자 전용 데이터만 다룬다 — 프로필은 `auth.uid()`, 작품/전시는
 *      RLS 로 걸린 목록만 로드한다.
 *   3. 페이지 리렌더링/오프라인/에러에 대해 실패-조용 (fail-quiet): 배너
 *      를 부수지 않는다. Row-level 저장 실패는 chip 으로 즉시 알리고 원문
 *      은 유지한다.
 *   4. AI 초안 사용량은 `ai.translate_draft` entitlement 를 통해 쿼터로
 *      제한된다. 남은 횟수를 상단 chip 으로 노출해 사용자가 "언제 소진되는
 *      지" 예측할 수 있도록 한다.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AuthGate } from "@/components/AuthGate";
import { PageShell } from "@/components/ds/PageShell";
import { useT } from "@/lib/i18n/useT";
import { supabase } from "@/lib/supabase/client";
import { getMyProfile, updateMyProfile } from "@/lib/supabase/profiles";
import { updateArtwork } from "@/lib/supabase/artworks";
import { updateExhibition, listMyExhibitions } from "@/lib/supabase/exhibitions";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { BilingualDashboardRow } from "@/components/bilingual/BilingualDashboardRow";
import type { TranslateDraftFieldKind } from "@/lib/ai/types";

type Locale = "ko" | "en";

type FieldSlot = {
  /** i18n label key. */
  labelKey: string;
  /** DB column suffix (before `_ko` / `_en`). e.g. `display_name`, `title`. */
  columnBase:
    | "display_name"
    | "bio"
    | "artist_statement"
    | "title"
    | "medium"
    | "story"
    | "host_name";
  fieldKind: TranslateDraftFieldKind;
};

type ProfileRowState = {
  rowId: "profile";
  entityId: string;
  slot: FieldSlot;
  sourceLocale: Locale;
  targetLocale: Locale;
  sourceValue: string;
  targetValue: string;
  contextHref: string;
};

type ArtworkRowState = {
  rowId: `artwork:${string}:${string}`;
  entityId: string;
  slot: FieldSlot;
  sourceLocale: Locale;
  targetLocale: Locale;
  sourceValue: string;
  targetValue: string;
  contextHref: string;
};

type ExhibitionRowState = {
  rowId: `exhibition:${string}:${string}`;
  entityId: string;
  slot: FieldSlot;
  sourceLocale: Locale;
  targetLocale: Locale;
  sourceValue: string;
  targetValue: string;
  contextHref: string;
};

type RowState = ProfileRowState | ArtworkRowState | ExhibitionRowState;

type GroupKey = "profile" | "artworks" | "exhibitions";

const PROFILE_FIELDS: FieldSlot[] = [
  { labelKey: "bilingual.dashboard.field.displayName", columnBase: "display_name", fieldKind: "title" },
  { labelKey: "bilingual.dashboard.field.bio", columnBase: "bio", fieldKind: "bio" },
  { labelKey: "bilingual.dashboard.field.statement", columnBase: "artist_statement", fieldKind: "statement" },
];

const ARTWORK_FIELDS: FieldSlot[] = [
  { labelKey: "bilingual.dashboard.field.title", columnBase: "title", fieldKind: "title" },
  { labelKey: "bilingual.dashboard.field.medium", columnBase: "medium", fieldKind: "medium" },
  { labelKey: "bilingual.dashboard.field.story", columnBase: "story", fieldKind: "story" },
];

const EXHIBITION_FIELDS: FieldSlot[] = [
  { labelKey: "bilingual.dashboard.field.title", columnBase: "title", fieldKind: "title" },
  { labelKey: "bilingual.dashboard.field.hostName", columnBase: "host_name", fieldKind: "host_name" },
];

/** 첫 페이지에 로드할 row 개수 (묶음별). load-more 로 25 개씩 확장. */
const PAGE_SIZE = 25;
/** AI 벌크 초안의 병렬도. 라우트별 rate-limit 를 자극하지 않도록 3 으로 시작. */
const BULK_CONCURRENCY = 3;

function nonEmpty(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/**
 * 이중언어 gap 판정: 정확히 한 쪽만 채워진 경우 → target 을 그 반대쪽으로
 * 정한다. 둘 다 비어 있거나 둘 다 채워진 필드는 대시보드에 노출하지 않는다.
 */
function gapFor(
  koValue: string | null | undefined,
  enValue: string | null | undefined
): { sourceLocale: Locale; targetLocale: Locale; sourceValue: string } | null {
  const ko = nonEmpty(koValue);
  const en = nonEmpty(enValue);
  if (ko && !en) return { sourceLocale: "ko", targetLocale: "en", sourceValue: ko };
  if (en && !ko) return { sourceLocale: "en", targetLocale: "ko", sourceValue: en };
  return null;
}

function BilingualDashboardInner() {
  const { t, locale: uiLocale } = useT();
  const [uid, setUid] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [profileRows, setProfileRows] = useState<ProfileRowState[]>([]);
  const [artworkRows, setArtworkRows] = useState<ArtworkRowState[]>([]);
  const [exhibitionRows, setExhibitionRows] = useState<ExhibitionRowState[]>([]);
  const [visibleCounts, setVisibleCounts] = useState<Record<GroupKey, number>>({
    profile: 999,
    artworks: PAGE_SIZE,
    exhibitions: PAGE_SIZE,
  });
  const [bulkDrafting, setBulkDrafting] = useState<GroupKey | null>(null);

  const translateAccess = useFeatureAccess("ai.translate_draft");

  const loadData = useCallback(async () => {
    setReady(false);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const userId = session?.user?.id ?? null;
    setUid(userId);
    if (!userId) {
      setReady(true);
      return;
    }

    // Profile ---------------------------------------------------------------
    const { data: profile } = await getMyProfile();
    const nextProfileRows: ProfileRowState[] = [];
    if (profile) {
      for (const slot of PROFILE_FIELDS) {
        const koKey = `${slot.columnBase}_ko` as keyof typeof profile;
        const enKey = `${slot.columnBase}_en` as keyof typeof profile;
        const gap = gapFor(
          (profile as Record<string, string | null | undefined>)[koKey as string],
          (profile as Record<string, string | null | undefined>)[enKey as string]
        );
        if (!gap) continue;
        nextProfileRows.push({
          rowId: "profile",
          entityId: profile.id ?? userId,
          slot,
          sourceLocale: gap.sourceLocale,
          targetLocale: gap.targetLocale,
          sourceValue: gap.sourceValue,
          targetValue: "",
          contextHref:
            slot.columnBase === "artist_statement"
              ? "/settings#statement"
              : slot.columnBase === "bio"
                ? "/settings#bio"
                : "/settings#displayName",
        });
      }
    }
    setProfileRows(nextProfileRows);

    // Artworks --------------------------------------------------------------
    const { data: artworksRaw } = await supabase
      .from("artworks")
      .select(
        "id, title, title_ko, title_en, medium, medium_ko, medium_en, story, story_ko, story_en"
      )
      .eq("artist_id", userId)
      .order("created_at", { ascending: false });

    const nextArtworkRows: ArtworkRowState[] = [];
    for (const artwork of (artworksRaw ?? []) as Array<
      Record<string, string | null>
    > & Array<{ id: string }>) {
      for (const slot of ARTWORK_FIELDS) {
        const koKey = `${slot.columnBase}_ko`;
        const enKey = `${slot.columnBase}_en`;
        const legacyKey = slot.columnBase;
        // Fallback for legacy rows that only have the un-suffixed column
        // populated (backfill hasn't touched them yet). We treat the legacy
        // string as belonging to the primary language slot (KO wins by our
        // trigger convention) so authors still see it as their "current"
        // value and can add the other language.
        const koVal =
          (artwork as Record<string, string | null>)[koKey] ??
          (artwork as Record<string, string | null>)[legacyKey];
        const enVal = (artwork as Record<string, string | null>)[enKey];
        const gap = gapFor(koVal, enVal);
        if (!gap) continue;
        nextArtworkRows.push({
          rowId: `artwork:${artwork.id}:${slot.columnBase}`,
          entityId: artwork.id,
          slot,
          sourceLocale: gap.sourceLocale,
          targetLocale: gap.targetLocale,
          sourceValue: gap.sourceValue,
          targetValue: "",
          contextHref: `/artwork/${artwork.id}/edit#${slot.columnBase}`,
        });
      }
    }
    setArtworkRows(nextArtworkRows);

    // Exhibitions -----------------------------------------------------------
    const { data: exhibitions } = await listMyExhibitions();
    const nextExhibitionRows: ExhibitionRowState[] = [];
    for (const exhibition of exhibitions) {
      // Only surface exhibitions the current user actually curates or hosts
      // (never delegate-only rows — those should be tidied by the principal).
      if (
        exhibition.curator_id !== userId &&
        exhibition.host_profile_id !== userId
      ) {
        continue;
      }
      for (const slot of EXHIBITION_FIELDS) {
        const koKey = `${slot.columnBase}_ko` as
          | "title_ko"
          | "host_name_ko";
        const enKey = `${slot.columnBase}_en` as
          | "title_en"
          | "host_name_en";
        const legacyKey = slot.columnBase as "title" | "host_name";
        const koVal =
          (exhibition as unknown as Record<string, string | null>)[koKey] ??
          (exhibition as unknown as Record<string, string | null>)[legacyKey];
        const enVal = (exhibition as unknown as Record<string, string | null>)[enKey];
        const gap = gapFor(koVal, enVal);
        if (!gap) continue;
        nextExhibitionRows.push({
          rowId: `exhibition:${exhibition.id}:${slot.columnBase}`,
          entityId: exhibition.id,
          slot,
          sourceLocale: gap.sourceLocale,
          targetLocale: gap.targetLocale,
          sourceValue: gap.sourceValue,
          targetValue: "",
          contextHref: `/exhibitions/${exhibition.id}/edit`,
        });
      }
    }
    setExhibitionRows(nextExhibitionRows);

    setReady(true);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const saveRow = useCallback(
    async (row: RowState, value: string): Promise<{ error?: unknown }> => {
      const trimmed = value.trim();
      if (row.rowId === "profile") {
        const key =
          `${row.slot.columnBase}_${row.targetLocale}` as
            | "display_name_ko"
            | "display_name_en"
            | "bio_ko"
            | "bio_en"
            | "artist_statement_ko"
            | "artist_statement_en";
        const { error } = await updateMyProfile({ [key]: trimmed || null });
        return { error };
      }
      if (row.rowId.startsWith("artwork:")) {
        const key = `${row.slot.columnBase}_${row.targetLocale}`;
        const { error } = await updateArtwork(row.entityId, {
          [key]: trimmed || null,
        });
        return { error };
      }
      // exhibition:{id}:{field}
      const key = `${row.slot.columnBase}_${row.targetLocale}` as
        | "title_ko"
        | "title_en"
        | "host_name_ko"
        | "host_name_en";
      const { error } = await updateExhibition(row.entityId, {
        [key]: trimmed || null,
      });
      return { error };
    },
    []
  );

  const removeRow = useCallback((rowId: string) => {
    // On save success we drop the row from the list so the "gap" set shrinks
    // in real time. This keeps the progress counter honest and avoids
    // surfacing already-saved rows during the same session.
    setProfileRows((prev) => prev.filter((r) => r.rowId !== rowId));
    setArtworkRows((prev) => prev.filter((r) => r.rowId !== rowId));
    setExhibitionRows((prev) => prev.filter((r) => r.rowId !== rowId));
  }, []);

  const handleSave = useCallback(
    async (row: RowState, value: string) => {
      const result = await saveRow(row, value);
      if (!result.error && value.trim().length > 0) {
        removeRow(row.rowId);
      }
      return result;
    },
    [saveRow, removeRow]
  );

  const handleBulkDraft = useCallback(
    async (group: GroupKey) => {
      // Bulk draft only fills the target input; the user still has to click
      // save on each row (or the future "save all" button once we add it).
      // We batch requests through the row-level AiTranslationDraftButton by
      // dispatching a synthetic click through refs, but for the MVP we call
      // the AI API directly per row and update targetValue via state — this
      // is simpler and mirrors what the row would do.
      if (bulkDrafting) return;
      setBulkDrafting(group);
      const source =
        group === "profile"
          ? profileRows
          : group === "artworks"
            ? artworkRows
            : exhibitionRows;
      const applyDraft = (rowId: string, draft: string) => {
        if (group === "profile") {
          setProfileRows((prev) =>
            prev.map((r) => (r.rowId === rowId ? { ...r, targetValue: draft } : r))
          );
        } else if (group === "artworks") {
          setArtworkRows((prev) =>
            prev.map((r) => (r.rowId === rowId ? { ...r, targetValue: draft } : r))
          );
        } else {
          setExhibitionRows((prev) =>
            prev.map((r) => (r.rowId === rowId ? { ...r, targetValue: draft } : r))
          );
        }
      };

      const { aiApi } = await import("@/lib/ai/browser");
      const pending = source.filter((r) => r.targetValue.trim().length === 0);
      // Very small concurrency pool — 3 in flight. Failures fall through as
      // no-ops so a single flaky call doesn't halt the whole run.
      let cursor = 0;
      async function worker() {
        while (cursor < pending.length) {
          const idx = cursor++;
          const row = pending[idx];
          try {
            const res = await aiApi.translateDraft({
              translate: {
                fieldKind: row.slot.fieldKind,
                sourceLocale: row.sourceLocale,
                targetLocale: row.targetLocale,
                sourceText: row.sourceValue,
                styleAnchors: [],
              },
            });
            const draft = typeof res.draft === "string" ? res.draft.trim() : "";
            if (!res.degraded && draft) {
              applyDraft(row.rowId, draft);
            }
          } catch {
            /* row-level failure: skip and continue */
          }
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(BULK_CONCURRENCY, pending.length) }, () =>
          worker()
        )
      );
      setBulkDrafting(null);
      translateAccess.refresh();
    },
    [bulkDrafting, profileRows, artworkRows, exhibitionRows, translateAccess]
  );

  const totalGap = profileRows.length + artworkRows.length + exhibitionRows.length;

  const quotaChip = useMemo(() => {
    if (translateAccess.loading || !translateAccess.decision) return null;
    const q = translateAccess.decision.quota;
    if (!q) return null;
    if (!Number.isFinite(q.limit)) {
      return t("bilingual.dashboard.quotaChipUnlimited");
    }
    if (q.remaining <= 0) return t("bilingual.dashboard.quotaExhausted");
    return t("bilingual.dashboard.quotaChip").replace(
      "{remaining}",
      String(q.remaining)
    );
  }, [translateAccess.loading, translateAccess.decision, t]);

  const renderGroup = (
    group: GroupKey,
    rows: RowState[]
  ) => {
    const visible = rows.slice(0, visibleCounts[group]);
    const bulkDisabled =
      bulkDrafting !== null ||
      visible.length === 0 ||
      (translateAccess.decision?.quota &&
        Number.isFinite(translateAccess.decision.quota.limit) &&
        translateAccess.decision.quota.remaining <= 0) ||
      false;

    const groupLabelKey =
      group === "profile"
        ? "bilingual.dashboard.groupProfile"
        : group === "artworks"
          ? "bilingual.dashboard.groupArtworks"
          : "bilingual.dashboard.groupExhibitions";

    return (
      <section key={group} className="mt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-zinc-900">
            {t(groupLabelKey)}
            <span className="ml-2 text-xs font-normal text-zinc-500">
              {rows.length}
            </span>
          </h2>
          {rows.length > 0 && (
            <button
              type="button"
              onClick={() => void handleBulkDraft(group)}
              disabled={bulkDisabled}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-500 disabled:opacity-50"
            >
              {bulkDrafting === group
                ? t("bilingual.dashboard.batchDraftPending")
                : t("bilingual.dashboard.batchDraft")}
            </button>
          )}
        </div>
        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-200 bg-white p-4 text-sm text-zinc-500">
            {t("bilingual.dashboard.emptySection")}
          </p>
        ) : (
          <div className="space-y-3">
            {visible.map((row) => (
              <BilingualDashboardRow
                key={row.rowId}
                labelKey={row.slot.labelKey}
                sourceValue={row.sourceValue}
                sourceLocale={row.sourceLocale}
                targetLocale={row.targetLocale}
                fieldKind={row.slot.fieldKind}
                initialTargetValue={row.targetValue}
                onSave={(value) => handleSave(row, value)}
                contextHref={row.contextHref}
                contextLabel={t("bilingual.dashboard.backToSettings")}
                onDraftGenerated={() => translateAccess.refresh()}
              />
            ))}
            {rows.length > visible.length && (
              <button
                type="button"
                onClick={() =>
                  setVisibleCounts((prev) => ({
                    ...prev,
                    [group]: prev[group] + PAGE_SIZE,
                  }))
                }
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-600 hover:border-zinc-500"
              >
                {t("bilingual.dashboard.loadMore")} ({rows.length - visible.length})
              </button>
            )}
          </div>
        )}
      </section>
    );
  };

  if (!ready) {
    return (
      <PageShell>
        <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-zinc-500">
          …
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">
              {t("bilingual.dashboard.title")}
            </h1>
            <p className="mt-1 max-w-prose text-sm text-zinc-600">
              {t("bilingual.dashboard.subtitle")}
            </p>
          </div>
          <Link
            href="/settings"
            className="whitespace-nowrap text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-800"
          >
            ← {t("bilingual.dashboard.backToSettings")}
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {totalGap === 0 ? (
            <span className="rounded-full bg-emerald-100 px-3 py-1 font-medium text-emerald-800">
              {t("bilingual.dashboard.allComplete")}
            </span>
          ) : (
            <span className="rounded-full bg-zinc-100 px-3 py-1 font-medium text-zinc-700">
              {t("bilingual.dashboard.progress")
                .replace("{total}", String(totalGap))
                .replace("{done}", "0")}
            </span>
          )}
          {quotaChip && (
            <span className="rounded-full bg-zinc-100 px-3 py-1 font-medium text-zinc-700">
              {quotaChip}
            </span>
          )}
        </div>

        {totalGap === 0 ? null : (
          <>
            {renderGroup("profile", profileRows)}
            {renderGroup("artworks", artworkRows)}
            {renderGroup("exhibitions", exhibitionRows)}
          </>
        )}

        {uid == null && (
          <p className="mt-8 text-sm text-zinc-500">
            {t("bilingual.dashboard.emptyState")}
          </p>
        )}
        <div className="mt-8 text-[10px] text-zinc-400">
          {t("bilingual.dashboard.settingsNavHint")} · locale: {uiLocale}
        </div>
      </div>
    </PageShell>
  );
}

export default function BilingualSettingsPage() {
  return (
    <AuthGate>
      <BilingualDashboardInner />
    </AuthGate>
  );
}
