import { NextResponse } from "next/server";
import { requireTheoBoardPublish } from "@/lib/theoBoard/publishGuard";

export async function POST(req: Request) {
  const gate = requireTheoBoardPublish(req);
  if (!gate.ok) return gate.response;

  let body: { id?: unknown; reason?: unknown };
  try {
    body = (await req.json()) as { id?: unknown; reason?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { data, error } = await gate.supabase
    .from("theo_board_posts")
    .update({ hidden_at: now, updated_at: now })
    .eq("id", id)
    .select("id, hidden_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "update_failed", detail: error.message },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ id: data.id, hidden_at: data.hidden_at });
}
