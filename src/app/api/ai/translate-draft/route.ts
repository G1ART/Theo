import { handleAiRoute } from "@/lib/ai/route";
import {
  buildTranslateDraftContext,
  type TranslateDraftContextInput,
} from "@/lib/ai/contexts";
import {
  TRANSLATE_DRAFT_SCHEMA,
  TRANSLATE_DRAFT_SYSTEM,
} from "@/lib/ai/prompts";
import type { TranslateDraftResult } from "@/lib/ai/types";
import { parseTranslateBody, type TranslateDraftBody } from "@/lib/ai/validation";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * QA 2026-07-28 (Track C) — 이중언어 인풋의 "AI 초안" 버튼 전용 라우트.
 * 원문 텍스트(sourceText)를 targetLocale 언어로 옮긴 draft 한 개를
 * 돌려준다. 절대 자동 저장되지 않으며 (UI 는 draft 를 secondary 입력창에
 * 채워 넣기만 함), fallback 은 빈 draft + degraded true 로 반환하여
 * 호출측이 "empty" 와 "error" 를 구분할 수 있게 한다.
 *
 * Prompt shape reuses the shared handleAiRoute plumbing (auth, entitlement
 * gate skipped intentionally — see AI_FEATURE_TO_ENTITLEMENT_KEY —, daily
 * soft cap, event logging). No meter mapping either; if translation-draft
 * usage becomes significant enough to bill, add it under
 * `AI_FEATURE_TO_METER_KEY` in a follow-up.
 */
export async function POST(req: Request) {
  return handleAiRoute<TranslateDraftBody, TranslateDraftResult>(req, {
    feature: "translate_draft",
    validateBody: (raw) => {
      const r = parseTranslateBody(raw);
      return r.ok ? { ok: true, value: r.value } : { ok: false, reason: r.reason };
    },
    async buildPromptInput({ body }) {
      const ctxInput: TranslateDraftContextInput = {
        fieldKind: body.fieldKind,
        sourceLocale: body.sourceLocale,
        targetLocale: body.targetLocale,
        sourceText: body.sourceText,
        styleAnchors: body.styleAnchors,
      };
      return {
        system: TRANSLATE_DRAFT_SYSTEM,
        user: buildTranslateDraftContext(ctxInput),
        schemaHint: TRANSLATE_DRAFT_SCHEMA,
        fallback: () => ({
          fieldKind: body.fieldKind,
          sourceLocale: body.sourceLocale,
          targetLocale: body.targetLocale,
          draft: "",
        }),
      };
    },
  });
}
