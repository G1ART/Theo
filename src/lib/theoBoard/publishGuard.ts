import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/supabase/serviceClient";

function bearerToken(req: Request): string {
  const h = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  if (!h.startsWith("Bearer ")) return "";
  return h.slice("Bearer ".length).trim();
}

function tokenEquals(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    const dummy = Buffer.alloc(a.length);
    if (a.length > 0) timingSafeEqual(a, dummy);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function requireTheoBoardPublish(req: Request):
  | { ok: true; supabase: SupabaseClient }
  | { ok: false; response: NextResponse } {
  const expected = process.env.THEO_BOARD_PUBLISH_TOKEN?.trim() ?? "";
  if (!expected) {
    return {
      ok: false,
      response: NextResponse.json({ error: "publish_unconfigured" }, { status: 503 }),
    };
  }
  const provided = bearerToken(req);
  if (!tokenEquals(provided, expected)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }
  const supabase = getServiceClient();
  if (!supabase) {
    return {
      ok: false,
      response: NextResponse.json({ error: "service_role_unconfigured" }, { status: 503 }),
    };
  }
  return { ok: true, supabase };
}
