"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/useT";
import { getMyProfile } from "@/lib/supabase/profiles";
import {
  parseActiveTabParam,
  parseStudioPortfolio,
} from "@/lib/studio/studioPortfolioConfig";

function tabParamFromSearch(search: string): string | null {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const value = new URLSearchParams(raw).get("tab");
  return value && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Confirms the upload was opened from a custom profile tab.
 * 전체 and a bare /upload visit render nothing.
 */
export function ProfileTabUploadNotice({ search }: { search: string }) {
  const { t } = useT();
  const tabParam = tabParamFromSearch(search);
  const active = parseActiveTabParam(tabParam);
  const customId = active?.kind === "custom" ? active.id : null;
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!customId) {
      setLabel(null);
      return;
    }
    let cancelled = false;
    setLabel(null);
    getMyProfile().then(({ data }) => {
      if (cancelled || !data) return;
      const portfolio = parseStudioPortfolio(data.profile_details ?? null);
      const tab = (portfolio.custom_tabs ?? []).find((row) => row.id === customId);
      if (!tab) return;
      setLabel(tab.label);
    });
    return () => {
      cancelled = true;
    };
  }, [customId]);

  if (!customId || !label) return null;
  return (
    <p className="mb-4 text-sm text-zinc-600" role="status">
      {t("upload.profileTab.into").replace("{name}", label)}
    </p>
  );
}
