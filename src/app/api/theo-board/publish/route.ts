import { NextResponse } from "next/server";
import { requireTheoBoardPublish } from "@/lib/theoBoard/publishGuard";
import {
  isTheoBoardType,
  type TheoBoardType,
} from "@/lib/supabase/theoBoard";

type PublishBody = {
  type?: unknown;
  title?: unknown;
  body_md?: unknown;
  summary?: unknown;
  href?: unknown;
  author_id?: unknown;
  pinned?: unknown;
  publish_now?: unknown;
  expires_in_days?: unknown;
};

function asOptionalString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length ? t : null;
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const gate = requireTheoBoardPublish(req);
  if (!gate.ok) return gate.response;

  let body: PublishBody;
  try {
    body = (await req.json()) as PublishBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const type = typeof body.type === "string" ? body.type.trim() : "";
  if (!isTheoBoardType(type)) {
    return NextResponse.json({ error: "invalid_type" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title.length < 1 || title.length > 120) {
    return NextResponse.json({ error: "invalid_title" }, { status: 400 });
  }

  const href = asOptionalString(body.href);
  if (href && !isHttpUrl(href)) {
    return NextResponse.json({ error: "invalid_href" }, { status: 400 });
  }

  const publishNow = body.publish_now !== false;
  const now = new Date();
  const publishedAt = publishNow ? now.toISOString() : null;

  let expiresAt: string | null = null;
  if (body.expires_in_days != null && body.expires_in_days !== "") {
    const days = Number(body.expires_in_days);
    if (!Number.isFinite(days) || days <= 0) {
      return NextResponse.json({ error: "invalid_expires_in_days" }, { status: 400 });
    }
    expiresAt = new Date(now.getTime() + days * 86400000).toISOString();
  }

  const row = {
    type: type as TheoBoardType,
    title,
    body_md: asOptionalString(body.body_md),
    summary: asOptionalString(body.summary),
    href,
    author_id: asOptionalString(body.author_id),
    pinned: body.pinned === true,
    published_at: publishedAt,
    expires_at: expiresAt,
    updated_at: now.toISOString(),
  };

  const { data, error } = await gate.supabase
    .from("theo_board_posts")
    .insert(row)
    .select("id, published_at")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "insert_failed", detail: error?.message ?? "unknown" },
      { status: 500 },
    );
  }

  return NextResponse.json({ id: data.id, published_at: data.published_at });
}
