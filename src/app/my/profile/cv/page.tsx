"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGate } from "@/components/AuthGate";
import { useT } from "@/lib/i18n/useT";
import { PageShell } from "@/components/ds/PageShell";
import { PageHeader } from "@/components/ds/PageHeader";
import { getMyProfile } from "@/lib/supabase/profiles";
import { CvEditorClient } from "./CvEditorClient";

/**
 * /my/profile/cv — structured CV + PDF editor.
 *
 * Reached from the public-profile CV card (owner Edit) and from the
 * settings identity section. Back-link prefers the public profile so
 * the artist returns to the surface visitors see.
 */
export default function CvEditorPage() {
  const { t } = useT();
  const [backHref, setBackHref] = useState("/settings#cv");
  const [backLabel, setBackLabel] = useState<string | null>(null);

  useEffect(() => {
    void getMyProfile().then(({ data }) => {
      const handle = data?.username?.trim();
      if (handle) {
        setBackHref(`/u/${handle}`);
        setBackLabel(t("cv.editor.backToProfile"));
      } else {
        setBackHref("/settings#cv");
        setBackLabel(t("cv.editor.backToStudio"));
      }
    });
  }, [t]);

  return (
    <AuthGate>
      <PageShell variant="narrow">
        <div className="mb-3 flex items-center justify-between gap-2">
          <Link
            href={backHref}
            className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-3 py-1 text-[11px] font-medium text-zinc-600 hover:border-zinc-300 hover:text-zinc-900"
          >
            <span aria-hidden="true">←</span>
            {backLabel ?? t("cv.editor.backToProfile")}
          </Link>
        </div>
        <PageHeader
          variant="plain"
          title={t("cv.editor.title")}
          lead={t("cv.editor.lead")}
        />
        <CvEditorClient />
      </PageShell>
    </AuthGate>
  );
}
