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
import { useEntryBack } from "@/hooks/useEntryBack";

function NewExhibitionPageInner() {
  const searchParams = useSearchParams();
  const fromUpload = searchParams.get("from") === "upload";
  const { t, locale } = useT();
  // Back and cancel return to the screen that opened the form (profile,
  // board, list); the list or upload only when it was opened by a link.
  const back = useEntryBack({ fallback: fromUpload ? "/upload" : "/my/exhibitions" });

  return (
    <AuthGate>
      <PageShell variant="narrow">
        <div className="mb-6">
          <Link
            href={back.path}
            {...back.linkProps}
            className="text-sm text-zinc-600 hover:text-zinc-900"
          >
            ← {backToLabel(t(back.labelKey), locale)}
          </Link>
        </div>
        <NewExhibitionFormShell
          showCancelLink={!fromUpload}
          cancelHref={back.path}
          cancelLinkProps={back.linkProps}
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
