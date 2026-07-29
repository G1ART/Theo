"use client";

/**
 * QA 2026-07-28 — Route-level error boundary for the exhibition edit
 * surface (`/my/exhibitions/[id]/edit`). Prior to this file any client
 * exception thrown inside the edit page (bilingual title state, AI
 * assist, delegation wizard, etc.) fell back to Next.js's global
 * "Application error: a client-side exception has occurred" screen,
 * which erases the whole subtree including the "돌아가기" link.
 *
 * This boundary keeps the shell and back link intact so the operator
 * can leave the broken page without hitting the browser reload. We
 * deliberately keep the copy calm and generic — the specific failure
 * message goes to console/telemetry, never on-screen.
 *
 * Next.js contract:
 * - Must be a client component.
 * - Receives `error` and `reset`. `reset()` re-mounts the segment so
 *   transient errors self-heal on retry.
 * - `error.digest` is a stable short id we can point support at.
 */

import { useEffect } from "react";
import Link from "next/link";

export default function EditExhibitionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (typeof console !== "undefined") {
      console.error("[/my/exhibitions/[id]/edit] error", error);
    }
  }, [error]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <Link href="/my/exhibitions" className="text-sm text-zinc-600 hover:text-zinc-900">
          ← 내 전시 목록
        </Link>
      </div>
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <h2 className="mb-1 font-semibold">이 화면에서 예기치 못한 오류가 발생했어요.</h2>
        <p className="mb-3 text-amber-800">
          잠시 후 다시 시도해 주세요. 반복되면 관리자에게 아래 코드를 알려주시면 도움이 돼요.
        </p>
        {error.digest && (
          <p className="mb-3 text-[11px] uppercase tracking-wide text-amber-700">
            error id: <code className="rounded bg-white/70 px-1">{error.digest}</code>
          </p>
        )}
        <button
          type="button"
          onClick={() => reset()}
          className="rounded border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
        >
          다시 시도
        </button>
      </div>
    </main>
  );
}
