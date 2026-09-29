import { NextResponse } from "next/server";
import { crawlPortfolioSite } from "@/lib/websiteImport/crawlSite";
import { normalizeWebsiteUrl } from "@/lib/websiteImport/urlSafety";
import { requireUserFromRequest } from "@/lib/websiteImport/supabaseServer";
import { recordUsageEvent } from "@/lib/metering/recordUsageEvent";
import { USAGE_KEYS } from "@/lib/metering/usageKeys";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * If a session has been stuck in `scanning` for more than this window we
 * treat the prior run as dead (Vercel function timeout, container kill,
 * etc.) and allow a fresh scan to take over. Longer than `maxDuration`
 * so a live scan is not interrupted by a retry.
 */
const STALE_SCAN_MS = 150_000;

const SCAN_RATE_WINDOW_MS = 60_000;
const SCAN_RATE_MAX_PER_WINDOW = 2;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUserFromRequest(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;

  const { data: row, error: loadErr } = await auth.supabase
    .from("website_import_sessions")
    .select("id, source_url, status, user_id, updated_at")
    .eq("id", id)
    .eq("user_id", auth.userId)
    .maybeSingle();

  if (loadErr || !row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Stuck-scan recovery: if another scan claims the session but more than
  // STALE_SCAN_MS has elapsed since its last update, we assume the worker
  // died (typical: Vercel killed the function at maxDuration). Otherwise
  // reject — we don't want two crawls hammering the same session.
  if (row.status === "scanning") {
    const updatedAt = row.updated_at ? Date.parse(row.updated_at as string) : 0;
    const ageMs = Number.isFinite(updatedAt) ? Date.now() - updatedAt : Number.POSITIVE_INFINITY;
    if (ageMs < STALE_SCAN_MS) {
      return NextResponse.json(
        { error: "scan_in_progress", retry_after_ms: STALE_SCAN_MS - ageMs },
        { status: 409 },
      );
    }
  }

  // Lightweight per-user rate limit using `usage_events` as the source of
  // truth. Cheap (one indexed count per call) and aligned with how every
  // other quota in the app is tracked.
  const since = new Date(Date.now() - SCAN_RATE_WINDOW_MS).toISOString();
  const { count: recentScanCount } = await auth.supabase
    .from("usage_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", auth.userId)
    .eq("event_key", USAGE_KEYS.IMPORT_WEBSITE_SCANNED)
    .gte("client_ts", since);
  if (typeof recentScanCount === "number" && recentScanCount >= SCAN_RATE_MAX_PER_WINDOW) {
    return NextResponse.json(
      { error: "rate_limited", retry_after_ms: SCAN_RATE_WINDOW_MS },
      { status: 429 },
    );
  }

  const norm = normalizeWebsiteUrl(row.source_url as string);
  if (!norm.ok) {
    return NextResponse.json({ error: "invalid_stored_url" }, { status: 400 });
  }

  await auth.supabase
    .from("website_import_sessions")
    .update({ status: "scanning", scan_error: null, updated_at: new Date().toISOString() })
    .eq("id", id);

  const crawled = await crawlPortfolioSite(norm.url);
  if (!crawled.ok) {
    await auth.supabase
      .from("website_import_sessions")
      .update({
        status: "failed",
        scan_error: crawled.error,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    return NextResponse.json({ error: crawled.error }, { status: 422 });
  }

  await auth.supabase
    .from("website_import_sessions")
    .update({
      status: "scan_done",
      candidates: crawled.candidates,
      scan_meta: crawled.scan_meta,
      scan_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  void recordUsageEvent(
    {
      key: USAGE_KEYS.IMPORT_WEBSITE_SCANNED,
      userId: auth.userId,
      metadata: {
        session_id: id,
        pages: crawled.scan_meta.pages_fetched,
        candidates: crawled.candidates.length,
      },
    },
    { client: auth.supabase, dualWriteBeta: false },
  );

  return NextResponse.json({
    ok: true,
    candidateCount: crawled.candidates.length,
    scan_meta: crawled.scan_meta,
  });
}
