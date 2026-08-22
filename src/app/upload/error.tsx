"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n/useT";

export default function UploadError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useT();

  useEffect(() => {
    if (typeof console !== "undefined") {
      console.error("[/upload] error", error);
    }
  }, [error]);

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <p className="text-sm font-medium text-zinc-900">{t("upload.error.title")}</p>
      <p className="mt-2 text-sm leading-relaxed text-zinc-600">
        {t("upload.error.body")}
      </p>
      {error.digest && (
        <p className="mt-3 text-[11px] uppercase tracking-wide text-zinc-400">
          error id: <code className="rounded bg-zinc-100 px-1">{error.digest}</code>
        </p>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm text-white hover:bg-zinc-800"
        >
          {t("common.retry")}
        </button>
        <Link
          href="/feed"
          className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
        >
          {t("nav.feed")}
        </Link>
      </div>
    </div>
  );
}
