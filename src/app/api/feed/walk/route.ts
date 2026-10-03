import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { assembleWalk } from "@/lib/feed/walk/assemble";
import { decodeCursor } from "@/lib/feed/walk/cursor";
import { loadWalkPools } from "@/lib/feed/walk/loadPools";
import type { WalkLane } from "@/lib/feed/walk/types";
import type { Locale } from "@/lib/i18n/locale";

export const dynamic = "force-dynamic";

/**
 * One page of the main-feed walk. The client appends `modules` in order.
 * It does not choose or shuffle the scenario.
 */
export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  if (!url || !anon) {
    return NextResponse.json({ scenario: null, modules: [], nextCursor: null }, { status: 503 });
  }

  let body: { cursor?: unknown; lane?: unknown; sort?: unknown; locale?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const header = request.headers.get("authorization");
  const token = header?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;
  const supabase = createClient(url, anon, {
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  let userId: string | null = null;
  if (token) {
    const { data, error } = await supabase.auth.getUser(token);
    if (!error && data.user?.id) userId = data.user.id;
  }

  let lane: WalkLane = "public";
  if (userId && body.lane === "following") lane = "following";
  else if (userId && body.lane === "personalized") lane = "personalized";

  const sort = body.sort === "popular" ? "popular" : "latest";
  const locale: Locale = body.locale === "ko" ? "ko" : "en";
  const cursor = typeof body.cursor === "string" ? decodeCursor(body.cursor) : null;

  const { viewer, pools } = await loadWalkPools(supabase, { userId, sort, locale });
  const page = assembleWalk({ lane, viewer, pools, cursor });
  return NextResponse.json(page, { headers: { "cache-control": "no-store" } });
}
