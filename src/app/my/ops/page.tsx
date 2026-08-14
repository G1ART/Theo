"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { supabase } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/useT";
import { generateCsv, downloadCsv } from "@/lib/csv/parse";

type OpsRow = {
  profile_id: string;
  username: string | null;
  display_name: string | null;
  email: string | null;
  has_random_username: boolean;
  artwork_count: number;
  created_at: string;
  delegation_count: number;
};

type RescueStats = {
  placeholder_total: number | null;
  placeholder_created_7d: number | null;
  placeholder_created_30d: number | null;
  rescued_7d: number | null;
  rescued_30d: number | null;
};

function OpsContent() {
  const { t } = useT();
  const [rows, setRows] = useState<OpsRow[]>([]);
  const [rescue, setRescue] = useState<RescueStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "random_username" | "no_uploads" | "with_delegations" | "recent_7d">("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [summary, rescueRes] = await Promise.all([
      supabase.rpc("ops_onboarding_summary"),
      supabase.from("v_identity_rescue_stats").select("*").maybeSingle(),
    ]);
    if (!summary.error && summary.data) setRows(summary.data as OpsRow[]);
    if (!rescueRes.error && rescueRes.data) setRescue(rescueRes.data as RescueStats);
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = requestAnimationFrame(() => { void refresh(); });
    return () => cancelAnimationFrame(t);
  }, [refresh]);

  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  const filtered = rows.filter((r) => {
    if (filter === "random_username") return r.has_random_username;
    if (filter === "no_uploads") return r.artwork_count === 0;
    if (filter === "with_delegations") return r.delegation_count > 0;
    if (filter === "recent_7d") return new Date(r.created_at).getTime() > sevenDaysAgo;
    return true;
  });

  const stats = {
    total: rows.length,
    randomUsername: rows.filter((r) => r.has_random_username).length,
    noUploads: rows.filter((r) => r.artwork_count === 0).length,
    withDelegations: rows.filter((r) => r.delegation_count > 0).length,
    recent7d: rows.filter((r) => new Date(r.created_at).getTime() > sevenDaysAgo).length,
  };

  const copyToClipboard = useCallback((text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }, []);

  const handleExportCsv = useCallback(() => {
    const headers = ["username", "display_name", "email", "artwork_count", "delegation_count", "random_username", "joined"];
    const csvRows = filtered.map((r) => [
      r.username ?? "",
      r.display_name ?? "",
      r.email ?? "",
      String(r.artwork_count),
      String(r.delegation_count),
      r.has_random_username ? "yes" : "no",
      new Date(r.created_at).toISOString().split("T")[0],
    ]);
    downloadCsv("ops_export.csv", generateCsv(headers, csvRows));
  }, [filtered]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <Link href="/my" className="mb-6 inline-block text-sm text-zinc-600 hover:text-zinc-900">
        ← {t("profile.privateBackToMy")}
      </Link>
      <h1 className="mb-4 text-xl font-semibold text-zinc-900">
        {t("workspace.ops.title")}{" "}
        <span className="text-sm font-normal text-zinc-400">
          ({t("ops.hub.internal")})
        </span>
      </h1>

      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href="/my/ops/external-artists"
          className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-500"
        >
          {t("ops.hub.externalArtists")} →
        </Link>
        <Link
          href="/my/ops/board"
          className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-500"
        >
          {t("ops.hub.boardQueue")} →
        </Link>
        <Link
          href="/my/ops/people"
          className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-500"
        >
          {t("ops.hub.people")} →
        </Link>
        <Link
          href="/my/ops/staff"
          className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-500"
        >
          {t("ops.hub.staff")} →
        </Link>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="rounded-lg border border-zinc-200 bg-white p-3 text-center">
          <p className="text-2xl font-bold text-zinc-900">{stats.total}</p>
          <p className="text-xs text-zinc-500">{t("ops.hub.stat.total")}</p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-center">
          <p className="text-2xl font-bold text-amber-700">{stats.randomUsername}</p>
          <p className="text-xs text-zinc-500">{t("ops.hub.stat.placeholderId")}</p>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-center">
          <p className="text-2xl font-bold text-red-700">{stats.noUploads}</p>
          <p className="text-xs text-zinc-500">{t("ops.hub.stat.noUploads")}</p>
        </div>
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-center">
          <p className="text-2xl font-bold text-blue-700">{stats.withDelegations}</p>
          <p className="text-xs text-zinc-500">{t("ops.hub.stat.delegations")}</p>
        </div>
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-center">
          <p className="text-2xl font-bold text-green-700">{stats.recent7d}</p>
          <p className="text-xs text-zinc-500">{t("ops.hub.stat.last7d")}</p>
        </div>
      </div>

      {rescue && (
        <section className="mb-6 rounded-lg border border-zinc-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-800">{t("ops.hub.rescue.title")}</h2>
            <span className="text-xs text-zinc-400">v_identity_rescue_stats</span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <p className="text-lg font-semibold text-zinc-900">{rescue.placeholder_total ?? 0}</p>
              <p className="text-xs text-zinc-500">{t("ops.hub.rescue.stillPlaceholder")}</p>
            </div>
            <div>
              <p className="text-lg font-semibold text-zinc-900">
                {rescue.placeholder_created_7d ?? 0} / {rescue.placeholder_created_30d ?? 0}
              </p>
              <p className="text-xs text-zinc-500">{t("ops.hub.rescue.newPlaceholder")}</p>
            </div>
            <div>
              <p className="text-lg font-semibold text-zinc-900">{rescue.rescued_7d ?? 0}</p>
              <p className="text-xs text-zinc-500">{t("ops.hub.rescue.rescued7d")}</p>
            </div>
            <div>
              <p className="text-lg font-semibold text-zinc-900">{rescue.rescued_30d ?? 0}</p>
              <p className="text-xs text-zinc-500">{t("ops.hub.rescue.rescued30d")}</p>
            </div>
          </div>
        </section>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          className="rounded border border-zinc-300 px-3 py-2 text-sm"
        >
          <option value="all">{t("ops.hub.filter.all").replace("{n}", String(stats.total))}</option>
          <option value="random_username">{t("ops.hub.filter.placeholder").replace("{n}", String(stats.randomUsername))}</option>
          <option value="no_uploads">{t("ops.hub.filter.noUploads").replace("{n}", String(stats.noUploads))}</option>
          <option value="with_delegations">{t("ops.hub.filter.delegations").replace("{n}", String(stats.withDelegations))}</option>
          <option value="recent_7d">{t("ops.hub.filter.recent").replace("{n}", String(stats.recent7d))}</option>
        </select>
        <button type="button" onClick={() => void refresh()} className="rounded border border-zinc-200 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50">
          {t("common.refresh")}
        </button>
        <button type="button" onClick={handleExportCsv} disabled={filtered.length === 0} className="rounded border border-zinc-200 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50 disabled:opacity-50">
          {t("ops.hub.exportCsv")}
        </button>
      </div>

      {loading ? (
        <p className="text-zinc-500">{t("common.loading")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs text-zinc-500">
              <tr>
                <th className="pb-2 pr-3">{t("ops.hub.col.username")}</th>
                <th className="pb-2 pr-3">{t("ops.hub.col.displayName")}</th>
                <th className="pb-2 pr-3">{t("ops.hub.col.email")}</th>
                <th className="pb-2 pr-3 text-right">{t("ops.hub.col.works")}</th>
                <th className="pb-2 pr-3 text-right">{t("ops.hub.col.deleg")}</th>
                <th className="pb-2 pr-3">{t("ops.hub.col.flags")}</th>
                <th className="pb-2 pr-3">{t("ops.hub.col.joined")}</th>
                <th className="pb-2">{t("ops.hub.col.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filtered.map((r) => {
                const profileUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/u/${r.username ?? ""}`;
                const identityFix = `${typeof window !== "undefined" ? window.location.origin : ""}/onboarding/identity`;
                return (
                  <tr key={r.profile_id} className="hover:bg-zinc-50">
                    <td className="py-2 pr-3">
                      <Link href={`/u/${r.username ?? ""}`} className="font-medium text-zinc-800 hover:underline">
                        {r.username ?? "—"}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-zinc-600">{r.display_name ?? "—"}</td>
                    <td className="py-2 pr-3 text-zinc-500 text-xs">{r.email ?? "—"}</td>
                    <td className="py-2 pr-3 text-right">{r.artwork_count}</td>
                    <td className="py-2 pr-3 text-right">{r.delegation_count}</td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {r.has_random_username && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">{t("ops.hub.flag.placeholderId")}</span>}
                        {r.artwork_count === 0 && <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800">{t("ops.hub.flag.noUploads")}</span>}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-xs text-zinc-400">{new Date(r.created_at).toLocaleDateString()}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          onClick={() => copyToClipboard(profileUrl, `p-${r.profile_id}`)}
                          className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 hover:bg-zinc-200"
                        >
                          {copiedId === `p-${r.profile_id}` ? "✓" : t("ops.hub.action.profileLink")}
                        </button>
                        {r.has_random_username && (
                          <button
                            type="button"
                            onClick={() => copyToClipboard(identityFix, `u-${r.profile_id}`)}
                            className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700 hover:bg-amber-200"
                          >
                            {copiedId === `u-${r.profile_id}` ? "✓" : t("ops.hub.action.identityFix")}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="mt-4 text-center text-sm text-zinc-500">{t("ops.hub.empty")}</p>}
        </div>
      )}
    </main>
  );
}

export default function OpsPage() {
  return (
    <AuthGate>
      <OpsContent />
    </AuthGate>
  );
}
