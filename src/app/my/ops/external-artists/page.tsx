"use client";

import { useCallback, useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { ConfirmActionDialog } from "@/components/ds/ConfirmActionDialog";
import { OpsBackLink } from "@/components/ops/OpsBackLink";
import { useT } from "@/lib/i18n/useT";
import {
  adminFetchExternalArtistBatch,
  adminMergeExternalArtists,
  adminSearchExternalArtistDuplicates,
  formatAdminMergeExternalArtistsError,
  isAdminMergeUniqueCollision,
  isOpsUser,
  type AdminExternalArtistDetail,
  type ExternalArtistDuplicateGroup,
} from "@/lib/provenance/adminExternalArtists";

type GroupState = {
  loading: boolean;
  members?: AdminExternalArtistDetail[];
};

export default function OpsExternalArtistsPage() {
  const { t } = useT();
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [groups, setGroups] = useState<ExternalArtistDuplicateGroup[]>([]);
  const [groupState, setGroupState] = useState<Record<string, GroupState>>({});
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const ok = await isOpsUser();
      setAllowed(ok);
      setChecking(false);
      if (ok) {
        const { data, error: err } = await adminSearchExternalArtistDuplicates();
        if (err) setError(formatAdminMergeExternalArtistsError(err));
        else setGroups(data);
      }
    })();
  }, []);

  const expandGroup = useCallback(async (key: string, ids: string[]) => {
    setGroupState((s) => ({ ...s, [key]: { loading: true } }));
    const { data, error: err } = await adminFetchExternalArtistBatch(ids);
    if (err) {
      setGroupState((s) => ({ ...s, [key]: { loading: false } }));
      setError(formatAdminMergeExternalArtistsError(err));
      return;
    }
    setGroupState((s) => ({ ...s, [key]: { loading: false, members: data } }));
    if (!targets[key] && data.length > 0) {
      setTargets((prev) => ({ ...prev, [key]: data[0].id }));
    }
  }, [targets]);

  async function handleConfirmMerge() {
    if (!pendingKey) return;
    const target = targets[pendingKey];
    const state = groupState[pendingKey];
    if (!target || !state?.members) return;
    const sources = state.members.map((m) => m.id).filter((id) => id !== target);
    if (sources.length === 0) {
      setPendingKey(null);
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error: err } = await adminMergeExternalArtists(target, sources);
    setBusy(false);
    setPendingKey(null);
    if (err) {
      setError(
        isAdminMergeUniqueCollision(err)
          ? t("ops.merge.uniqueError")
          : formatAdminMergeExternalArtistsError(err)
      );
      return;
    }
    const dropped = data?.claims_dropped ?? 0;
    const droppedNote =
      dropped > 0
        ? t("ops.merge.noticeDropped").replace("{n}", String(dropped))
        : "";
    setNotice(
      t("ops.merge.notice")
        .replace("{n}", String(data?.source_count ?? sources.length))
        .replace("{id}", target.slice(0, 8))
        .replace("{moved}", String(data?.claims_moved ?? 0)) + droppedNote
    );
    const { data: refreshed } = await adminSearchExternalArtistDuplicates();
    setGroups(refreshed);
    setGroupState({});
    setTargets({});
  }

  if (checking) {
    return (
      <AuthGate>
        <main className="mx-auto max-w-3xl px-4 py-8 text-sm text-zinc-500">
          {t("common.loading")}
        </main>
      </AuthGate>
    );
  }

  if (!allowed) {
    return (
      <AuthGate>
        <main className="mx-auto max-w-3xl px-4 py-8">
          <OpsBackLink />
          <h1 className="mb-4 text-xl font-semibold text-zinc-900">
            {t("ops.merge.title")}
          </h1>
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
            {t("ops.merge.noAccess")}
          </div>
        </main>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <OpsBackLink />
        <h1 className="mb-2 text-xl font-semibold text-zinc-900">
          {t("ops.merge.title")}
        </h1>
        <p className="mb-6 text-sm text-zinc-500">{t("ops.merge.lead")}</p>

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
        {notice && <p className="mb-4 text-sm text-emerald-700">{notice}</p>}

        {groups.length === 0 ? (
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">
            {t("ops.merge.empty")}
          </div>
        ) : (
          <ul className="space-y-4">
            {groups.map((g) => {
              const key = `${g.bucket}:${g.key}`;
              const state = groupState[key];
              const isExpanded = !!state;
              const target = targets[key];
              return (
                <li
                  key={key}
                  className="rounded-2xl border border-zinc-200 bg-white p-4"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-zinc-900">
                        {g.key}{" "}
                        <span className="ml-2 text-xs text-zinc-500">
                          ({g.bucket} · {t("ops.merge.rows").replace("{n}", String(g.n))})
                        </span>
                      </p>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-500"
                      onClick={() =>
                        isExpanded
                          ? setGroupState((s) => {
                              const rest = { ...s };
                              delete rest[key];
                              return rest;
                            })
                          : void expandGroup(key, g.ids)
                      }
                    >
                      {isExpanded ? t("ops.merge.collapse") : t("ops.merge.inspect")}
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="mt-3 border-t border-zinc-100 pt-3">
                      {state?.loading ? (
                        <p className="text-sm text-zinc-500">{t("common.loading")}</p>
                      ) : state?.members && state.members.length > 0 ? (
                        <>
                          <ul className="space-y-2">
                            {state.members.map((m) => (
                              <li
                                key={m.id}
                                className={`flex flex-wrap items-start justify-between gap-2 rounded-lg border p-2.5 text-xs ${
                                  target === m.id
                                    ? "border-emerald-300 bg-emerald-50"
                                    : "border-zinc-200 bg-zinc-50"
                                }`}
                              >
                                <label className="flex min-w-0 items-start gap-2">
                                  <input
                                    type="radio"
                                    name={`target-${key}`}
                                    checked={target === m.id}
                                    onChange={() =>
                                      setTargets((prev) => ({
                                        ...prev,
                                        [key]: m.id,
                                      }))
                                    }
                                    className="mt-0.5"
                                  />
                                  <span className="min-w-0">
                                    <span className="block truncate font-mono text-[11px] text-zinc-600">
                                      {m.id}
                                    </span>
                                    <span className="block truncate text-zinc-900">
                                      {m.display_name}
                                      {m.display_name_ko && (
                                        <span className="ml-1 text-zinc-500">
                                          / ko: {m.display_name_ko}
                                        </span>
                                      )}
                                      {m.display_name_en && (
                                        <span className="ml-1 text-zinc-500">
                                          / en: {m.display_name_en}
                                        </span>
                                      )}
                                    </span>
                                    <span className="mt-0.5 block text-zinc-500">
                                      {t("ops.merge.email")}:{" "}
                                      {m.invite_email ? (
                                        <span className="text-zinc-800">
                                          {m.invite_email}
                                        </span>
                                      ) : (
                                        <span className="italic text-amber-700">
                                          {t("ops.merge.emailNone")}
                                        </span>
                                      )}{" "}
                                      · {t("ops.merge.status")}: {m.status ?? "—"} ·{" "}
                                      {t("ops.merge.created")}:{" "}
                                      {m.created_at?.slice(0, 10)}
                                    </span>
                                  </span>
                                </label>
                              </li>
                            ))}
                          </ul>
                          <div className="mt-3 flex justify-end">
                            <button
                              type="button"
                              disabled={!target}
                              onClick={() => setPendingKey(key)}
                              className="rounded-lg border border-amber-400 bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-200 disabled:opacity-50"
                            >
                              {t("ops.merge.mergeN").replace(
                                "{n}",
                                String(state.members.length - 1)
                              )}
                            </button>
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-zinc-500">{t("ops.merge.noMembers")}</p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <ConfirmActionDialog
          open={!!pendingKey}
          title={t("ops.merge.confirmTitle")}
          description={
            pendingKey
              ? t("ops.merge.confirmDesc")
                  .replace(
                    "{n}",
                    String((groupState[pendingKey]?.members?.length ?? 1) - 1)
                  )
                  .replace("{id}", (targets[pendingKey] ?? "").slice(0, 8))
              : undefined
          }
          confirmLabel={t("ops.merge.confirm")}
          cancelLabel={t("common.cancel")}
          tone="destructive"
          busy={busy}
          onConfirm={handleConfirmMerge}
          onCancel={() => (busy ? null : setPendingKey(null))}
        />
      </main>
    </AuthGate>
  );
}
