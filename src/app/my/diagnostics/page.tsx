"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { useT } from "@/lib/i18n/useT";
import { readFeedPerf } from "@/lib/feed/feedPerf";
import { supabase } from "@/lib/supabase/client";

const SHOW =
  process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_DIAGNOSTICS === "1";

type EventRow = {
  event_name: string;
  created_at: string;
  payload: Record<string, unknown> | null;
};

const FEED_SURFACE_EVENTS = new Set<string>([
  "feed_loaded",
  "feed_first_paint",
  "feed_load_more",
  "feed_item_impression",
  "feed_item_click",
  "feed_item_like_or_save",
  "feed_item_follow",
  "feed_item_inquiry_click",
  "profile_view_from_feed",
  "exhibition_view_from_feed",
]);

const ACTIVATION_EVENTS = [
  "signup_completed",
  "profile_completed",
  "upload_completed",
  "bulk_publish_completed",
  "exhibition_created",
  "exhibition_artwork_added",
  "inquiry_created",
] as const;

export default function DiagnosticsPage() {
  const { t } = useT();
  const [rows, setRows] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!SHOW) return;
    setLoading(true);
    // Pull a wider window than the previous 80 so the activation readout
    // (which slices by event_name) has room to count beyond the most-
    // recent feed events. RLS still restricts to the viewer's own rows.
    const { data } = await supabase
      .from("beta_analytics_events")
      .select("event_name, created_at, payload")
      .order("created_at", { ascending: false })
      .limit(400);
    setRows((data ?? []) as EventRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = requestAnimationFrame(() => {
      void refresh();
    });
    return () => cancelAnimationFrame(t);
  }, [refresh]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      m.set(r.event_name, (m.get(r.event_name) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const feedSurfaceCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      if (!FEED_SURFACE_EVENTS.has(r.event_name)) continue;
      m.set(r.event_name, (m.get(r.event_name) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  // Per-tab feed click split (e.g. "all" vs "following") so an artist can
  // see whether their own feed exploration leans recommended or follow-led.
  const feedClickByTab = useMemo(() => {
    const tabs = new Map<string, number>();
    for (const r of rows) {
      if (r.event_name !== "feed_item_click") continue;
      const tab =
        (r.payload && typeof r.payload === "object" && typeof (r.payload as { tab?: unknown }).tab === "string"
          ? ((r.payload as { tab?: string }).tab as string)
          : "?");
      tabs.set(tab, (tabs.get(tab) ?? 0) + 1);
    }
    return Array.from(tabs.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  // Click split by item kind so we can spot whether artwork tiles, exhibition
  // strips, or people carousels are getting the most attention from the
  // current viewer.
  const feedClickByKind = useMemo(() => {
    const kinds = new Map<string, number>();
    for (const r of rows) {
      if (r.event_name !== "feed_item_click") continue;
      const kind =
        (r.payload && typeof r.payload === "object" && typeof (r.payload as { item_kind?: unknown }).item_kind === "string"
          ? ((r.payload as { item_kind?: string }).item_kind as string)
          : "?");
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    }
    return Array.from(kinds.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  // Personalization readout from feed_first_paint payloads. Sprint 2
  // attaches a small `personalization` object so we can verify, per
  // session, whether the mixer had viewer signals to differentiate on.
  const personalizationLatest = useMemo(() => {
    for (const r of rows) {
      if (r.event_name !== "feed_first_paint") continue;
      const p = (r.payload as Record<string, unknown> | null)?.personalization;
      if (p && typeof p === "object") {
        return p as {
          enabled?: boolean;
          has_role?: boolean;
          following_count?: number;
          liked_count?: number;
        };
      }
    }
    return null;
  }, [rows]);

  const activationCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const name of ACTIVATION_EVENTS) m.set(name, 0);
    for (const r of rows) {
      if (m.has(r.event_name)) m.set(r.event_name, (m.get(r.event_name) ?? 0) + 1);
    }
    return Array.from(m.entries());
  }, [rows]);

  if (!SHOW) {
    return (
      <AuthGate>
        <main className="mx-auto max-w-lg px-4 py-12">
          <p className="text-zinc-600">{t("diagnostics.denied")}</p>
          <Link href="/my" className="mt-4 inline-block text-sm text-zinc-500 hover:text-zinc-800">
            ← /my
          </Link>
        </main>
      </AuthGate>
    );
  }

  const buildStamp =
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_BUILD_ID ||
    "local";

  return (
    <AuthGate>
      <main className="mx-auto max-w-lg px-4 py-8">
        <Link href="/my" className="mb-6 inline-block text-sm text-zinc-600 hover:text-zinc-900">
          ← /my
        </Link>
        <h1 className="mb-4 text-xl font-semibold text-zinc-900">{t("diagnostics.title")}</h1>
        <p className="mb-6 text-sm text-zinc-600">
          {t("diagnostics.build")}: <code className="rounded bg-zinc-100 px-1">{buildStamp}</code>
        </p>
        <p className="mb-2 text-sm font-medium text-zinc-800">{t("diagnostics.feedPerf")}</p>
        <ul className="mb-6 list-inside list-disc text-sm text-zinc-600">
          <li>feed_first_paint: {readFeedPerf("feed_first_paint") ?? "—"}</li>
          <li>feed_data_loaded_ms: {readFeedPerf("feed_data_loaded_ms") ?? "—"}</li>
          <li>feed_fetch_started: {readFeedPerf("feed_fetch_started") ?? "—"}</li>
        </ul>
        <p className="mb-2 text-sm font-medium text-zinc-800">{t("diagnostics.activation.title")}</p>
        {loading ? (
          <p className="text-sm text-zinc-500">{t("common.loading")}</p>
        ) : (
          <ul className="mb-6 text-sm text-zinc-700">
            {activationCounts.map(([name, n]) => (
              <li key={name}>
                {name}: <b>{n}</b>
              </li>
            ))}
          </ul>
        )}

        <p className="mb-2 text-sm font-medium text-zinc-800">{t("diagnostics.feedSurface.title")}</p>
        {loading ? (
          <p className="text-sm text-zinc-500">{t("common.loading")}</p>
        ) : feedSurfaceCounts.length === 0 ? (
          <p className="mb-6 text-sm text-zinc-500">—</p>
        ) : (
          <>
            <ul className="mb-3 text-sm text-zinc-700">
              {feedSurfaceCounts.map(([name, n]) => (
                <li key={name}>
                  {name}: <b>{n}</b>
                </li>
              ))}
            </ul>
            {feedClickByTab.length > 0 && (
              <p className="mb-1 text-xs text-zinc-600">
                <span className="font-medium">{t("diagnostics.feedSurface.byTab")}</span>{" "}
                {feedClickByTab.map(([k, v]) => `${k}:${v}`).join(" · ")}
              </p>
            )}
            {feedClickByKind.length > 0 && (
              <p className="mb-3 text-xs text-zinc-600">
                <span className="font-medium">{t("diagnostics.feedSurface.byKind")}</span>{" "}
                {feedClickByKind.map(([k, v]) => `${k}:${v}`).join(" · ")}
              </p>
            )}
            {personalizationLatest && (
              <p className="mb-6 text-xs text-zinc-600">
                <span className="font-medium">{t("diagnostics.personalization.title")}</span>{" "}
                enabled:{personalizationLatest.enabled ? "yes" : "no"} ·{" "}
                role:{personalizationLatest.has_role ? "known" : "unknown"} ·{" "}
                following:{personalizationLatest.following_count ?? 0} ·{" "}
                liked:{personalizationLatest.liked_count ?? 0}
              </p>
            )}
          </>
        )}

        <p className="mb-2 text-sm font-medium text-zinc-800">{t("diagnostics.recentEvents")}</p>
        {loading ? (
          <p className="text-sm text-zinc-500">{t("common.loading")}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-zinc-500">—</p>
        ) : (
          <>
            <ul className="mb-4 text-sm text-zinc-700">
              {counts.slice(0, 24).map(([name, n]) => (
                <li key={name}>
                  {name}: {n}
                </li>
              ))}
            </ul>
            <ul className="max-h-64 overflow-auto text-xs text-zinc-500">
              {rows.slice(0, 40).map((r) => (
                <li key={`${r.event_name}-${r.created_at}`}>
                  {r.event_name} · {new Date(r.created_at).toLocaleString()}
                </li>
              ))}
            </ul>
          </>
        )}
        <button
          type="button"
          onClick={() => void refresh()}
          className="mt-6 rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
        >
          {t("common.refresh")}
        </button>
        <p className="mt-8 text-xs text-zinc-400">
          Migrations: apply <code className="rounded bg-zinc-100 px-1">p0_beta_hardening_wave1.sql</code> in Supabase
          for events + inquiry thread.
        </p>
      </main>
    </AuthGate>
  );
}
