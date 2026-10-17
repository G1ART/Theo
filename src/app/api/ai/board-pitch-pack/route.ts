import { NextResponse } from "next/server";
import { handleAiRoute } from "@/lib/ai/route";
import {
  buildBoardPitchPackContext,
  type BoardPitchPackInput,
} from "@/lib/ai/contexts";
import {
  BOARD_PITCH_PACK_SCHEMA,
  BOARD_PITCH_PACK_SYSTEM,
} from "@/lib/ai/prompts";
import type { BoardPitchPackResult } from "@/lib/ai/types";
import {
  parseBoardPitchPackBody,
  type BoardPitchPackBody,
} from "@/lib/ai/validation";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Deterministic, model-free fallback. Used when the OpenAI key is absent
 * or the upstream model fails — the user still gets a useful structural
 * snapshot of their board plus a "missing info" checklist so they can
 * keep working. Never invents prose; the route only ever pastes counts
 * and verbatim board fields.
 */
function buildBoardPitchPackFallback(ctx: BoardPitchPackInput): BoardPitchPackResult {
  const isKo = ctx.locale === "ko";
  const artworkN = ctx.artworks?.length ?? 0;
  const exhibitionN = ctx.exhibitions?.length ?? 0;
  const totalN = artworkN + exhibitionN;

  const summary = (() => {
    if (totalN === 0) {
      return isKo
        ? "보드에 담긴 항목이 아직 없어요."
        : "This board has no items yet.";
    }
    const titleClause = ctx.boardTitle
      ? isKo
        ? `"${ctx.boardTitle}" 보드는 `
        : `"${ctx.boardTitle}" groups `
      : isKo
        ? "이 보드는 "
        : "This board groups ";
    const itemsClause = isKo
      ? `작품 ${artworkN}점${exhibitionN > 0 ? `과 전시 ${exhibitionN}건` : ""}을 묶고 있어요.`
      : `${artworkN} artwork${artworkN === 1 ? "" : "s"}${exhibitionN > 0 ? ` and ${exhibitionN} exhibition${exhibitionN === 1 ? "" : "s"}` : ""}.`;
    return titleClause + itemsClause;
  })();

  const missingInfo: string[] = [];
  if (!ctx.boardDescription || ctx.boardDescription.trim().length === 0) {
    missingInfo.push(
      isKo
        ? "보드 설명이 비어 있어요. 한 줄 메시지로 묶음의 의도를 적어 두면 도움이 됩니다."
        : "Board description is empty — a one-line statement helps anchor the throughline.",
    );
  }
  const artworksMissingMeta = (ctx.artworks ?? []).filter(
    (a) => !a.title || !a.year || !a.medium,
  ).length;
  if (artworksMissingMeta > 0) {
    missingInfo.push(
      isKo
        ? `작품 ${artworksMissingMeta}점에 제목/연도/매체 중 일부 정보가 비어 있어요.`
        : `${artworksMissingMeta} artwork${artworksMissingMeta === 1 ? "" : "s"} missing title, year, or medium.`,
    );
  }
  if (totalN < 2) {
    missingInfo.push(
      isKo
        ? "초안을 풍부하게 만들려면 작품이나 전시를 2개 이상 담아 주세요."
        : "Add at least two items for richer drafts.",
    );
  }

  return {
    summary,
    throughline: "",
    missingInfo,
    drafts: [],
  };
}

/**
 * P1-A — Board Pitch Pack route.
 *
 * Authorisation: relies on `shortlists` RLS — the user's own boards or
 * boards they are listed as a collaborator on are readable; everything
 * else returns zero rows from the SELECT and we 404. We never query
 * with the service role here so an attacker cannot pivot to another
 * curator's board by guessing the id.
 */
export async function POST(req: Request) {
  return handleAiRoute<BoardPitchPackBody, BoardPitchPackResult>(req, {
    feature: "board_pitch_pack",
    validateBody: (raw) => {
      const r = parseBoardPitchPackBody(raw);
      return r.ok ? { ok: true, value: r.value } : { ok: false, reason: r.reason };
    },
    async buildPromptInput({ body, supabase }) {
      const { data: board, error: boardErr } = await supabase
        .from("shortlists")
        .select("id, title, description")
        .eq("id", body.boardId)
        .single();

      if (boardErr || !board) {
        return NextResponse.json(
          { degraded: true, reason: "invalid_input", validation: "missing_board" },
          { status: 404 },
        );
      }

      const { data: itemsRaw } = await supabase
        .from("shortlist_items")
        .select(
          "id, artwork_id, exhibition_id, note, " +
            "artworks!artwork_id(id, title, year, medium), " +
            "projects!exhibition_id(id, title, start_date)",
        )
        .eq("shortlist_id", body.boardId)
        .order("position")
        .order("created_at");

      const items = Array.isArray(itemsRaw) ? itemsRaw : [];
      const editorialNotes: string[] = [];
      const artworks: NonNullable<BoardPitchPackInput["artworks"]> = [];
      const exhibitions: NonNullable<BoardPitchPackInput["exhibitions"]> = [];

      for (const row of items as unknown as Array<Record<string, unknown>>) {
        const note = typeof row.note === "string" ? row.note.trim() : "";
        if (note) editorialNotes.push(note.slice(0, 200));
        const aw = row.artworks as
          | {
              id: string;
              title: string | null;
              year: string | number | null;
              medium: string | null;
            }
          | null;
        if (aw && typeof aw === "object" && !Array.isArray(aw)) {
          artworks.push({
            id: aw.id,
            title: aw.title,
            year: aw.year,
            medium: aw.medium,
            themes: null,
          });
        }
        const ex = row.projects as
          | { id: string; title: string | null; start_date: string | null }
          | null;
        if (ex && typeof ex === "object" && !Array.isArray(ex)) {
          const yearStr = typeof ex.start_date === "string" ? ex.start_date.slice(0, 4) : null;
          exhibitions.push({
            id: ex.id,
            title: ex.title,
            year: yearStr,
            venue: null,
          });
        }
      }

      const ctx: BoardPitchPackInput = {
        locale: body.locale,
        boardTitle: (board as { title?: string | null }).title ?? null,
        boardDescription: (board as { description?: string | null }).description ?? null,
        editorialNote: editorialNotes.length > 0 ? editorialNotes.join(" / ") : null,
        artworks,
        exhibitions,
      };

      return {
        system: BOARD_PITCH_PACK_SYSTEM,
        user: buildBoardPitchPackContext(ctx),
        schemaHint: BOARD_PITCH_PACK_SCHEMA,
        fallback: () => buildBoardPitchPackFallback(ctx),
      };
    },
  });
}
