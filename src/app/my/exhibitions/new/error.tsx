"use client";

/**
 * QA 2026-07-28 — Route-level error boundary for `/my/exhibitions/new`.
 * Mirrors `/my/exhibitions/[id]/edit/error.tsx`: keeps the shell + back
 * link intact so a broken assist/form widget doesn't strand the operator
 * on the generic "Application error" screen.
 */

import { useEffect } from "react";
import Link from "next/link";

export default function NewExhibitionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (typeof console !== "undefined") {
      console.error("[/my/exhibitions/new] error", error);
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
        <h2 className="mb-1 font-semibold">전시 생성 화면에서 예기치 못한 오류가 발생했어요.</h2>
        <p className="mb-3 text-amber-800">
          입력하신 내용이 저장되지는 않았어요. 잠시 후 다시 시도해 주세요.
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
