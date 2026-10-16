"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { useT } from "@/lib/i18n/useT";
import { backToLabel } from "@/lib/i18n/back";
import { PageShell } from "@/components/ds/PageShell";
import { PageShellSkeleton } from "@/components/ds/PageShellSkeleton";
import { NewExhibitionFormShell } from "@/components/exhibitions/NewExhibitionFormShell";
import { listReturnLinkProps } from "@/lib/list/scrollRestore";

function NewExhibitionPageInner() {
  const searchParams = useSearchParams();
  const fromUpload = searchParams.get("from") === "upload";
  const { t, locale } = useT();

  const backHref = fromUpload ? "/upload" : "/my/exhibitions";
  const backLabel = fromUpload
    ? t("upload.backToUpload")
    : backToLabel(t("exhibition.myExhibitions"), locale);

  return (
    <AuthGate>
      <PageShell variant="narrow">
        <div className="mb-6">
          <Link
            href={backHref}
            {...listReturnLinkProps(backHref)}
            className="text-sm text-zinc-600 hover:text-zinc-900"
          >
            ← {backLabel}
          </Link>
        </div>
        <NewExhibitionFormShell
          showCancelLink={!fromUpload}
          cancelHref="/my/exhibitions"
        />
      </PageShell>
    </AuthGate>
  );
}

export default function NewExhibitionPage() {
  return (
    <Suspense fallback={<PageShellSkeleton variant="narrow" />}>
      <NewExhibitionPageInner />
    </Suspense>
  );
}
