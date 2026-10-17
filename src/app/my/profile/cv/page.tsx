"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGate } from "@/components/AuthGate";
import { useActingAs } from "@/context/ActingAsContext";
import { useEntryBack } from "@/hooks/useEntryBack";
import { useT } from "@/lib/i18n/useT";
import { backToLabel } from "@/lib/i18n/back";
import { PageShell } from "@/components/ds/PageShell";
import { PageHeader } from "@/components/ds/PageHeader";
import { principalPublicProfileHref } from "@/lib/delegation/principalProfileHref";
import { getMyProfile, getProfileById } from "@/lib/supabase/profiles";
import { CvEditorClient } from "./CvEditorClient";

/**
 * /my/profile/cv — structured CV + PDF editor.
 *
 * Reached from the public-profile CV card (owner Edit) and from the
 * settings identity section. Back returns to that screen. Opened by a
 * link, it goes to the public profile being edited (the delegated one
 * while acting), else the settings CV section.
 */
export default function CvEditorPage() {
  const { t, locale } = useT();
  const { actingAsProfileId } = useActingAs();
  const [fallback, setFallback] = useState("/settings#cv");
  const back = useEntryBack({ fallback });

  useEffect(() => {
    let cancelled = false;
    const load = actingAsProfileId ? getProfileById(actingAsProfileId) : getMyProfile();
    void load.then(({ data }) => {
      if (cancelled) return;
      setFallback(principalPublicProfileHref(data?.username) ?? "/settings#cv");
    });
    return () => {
      cancelled = true;
    };
  }, [actingAsProfileId]);

  return (
    <AuthGate>
      <PageShell variant="narrow">
        <div className="mb-3 flex items-center justify-between gap-2">
          <Link
            href={back.path}
            {...back.linkProps}
            className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-3 py-1 text-[11px] font-medium text-zinc-600 hover:border-zinc-300 hover:text-zinc-900"
          >
            <span aria-hidden="true">←</span>
            {backToLabel(t(back.labelKey), locale)}
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
