import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  IR_DEMO_COOKIE,
  irPersona,
  isIrDemo,
} from "@/lib/irDemo/config";
import { irDemoCookieToken } from "@/lib/irDemo/gate";

function secretsMatch(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export async function POST(req: Request) {
  if (!isIrDemo()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const expected = process.env.IR_DEMO_SECRET?.trim() ?? "";
  const password = process.env.IR_DEMO_PASSWORD?.trim() ?? "";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  if (!expected || !password || !url || !anon) {
    return NextResponse.json({ error: "demo_not_configured" }, { status: 503 });
  }

  let body: { secret?: string; persona?: string } = {};
  try {
    body = (await req.json()) as { secret?: string; persona?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!secretsMatch(body.secret ?? "", expected)) {
    return NextResponse.json({ error: "forbidden" }, { status: 401 });
  }

  const persona = irPersona(body.persona);
  if (!persona) {
    return NextResponse.json({ error: "unknown_persona" }, { status: 400 });
  }

  const supabase = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({
    email: persona.email,
    password,
  });
  if (error || !data.session) {
    return NextResponse.json(
      { error: "persona_signin_failed" },
      { status: 503 },
    );
  }

  const res = NextResponse.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    home: persona.home,
    persona: persona.key,
  });
  res.cookies.set(IR_DEMO_COOKIE, await irDemoCookieToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return res;
}
