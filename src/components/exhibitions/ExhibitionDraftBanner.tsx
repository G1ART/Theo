"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n/useT";

/**
 * Owner-visible status banner for exhibitions that are still in "임시 저장"
 * (planned + zero works) — the QA 2026-07 Phase 2-3 draft UX.
 *
 * Rules mirror deriveState() in /my/exhibitions/page.tsx:
 *   - status === "planned" && worksCount === 0 → draft banner (amber)
 *   - status === "planned" && worksCount ≥ 1  → we do NOT render (parent
 *     surfaces standard state elsewhere)
 *   - status === "live" | "ended"             → we do NOT render
 *
 * Renders a "just created" ephemeral toast the first time the owner
 * lands on the /add page after creating an exhibition, driven by a
 * sessionStorage flag written in NewExhibitionFormShell.
 */
export function ExhibitionDraftBanner(props: {
  exhibitionId: string;
  status: string;
  worksCount: number;
  /**
   * Optional override for the primary action's href. Defaults to the
   * exhibition's /add page. On the /add page itself the caller can pass
   * an anchor (e.g. "#works") to scroll instead of navigating.
   */
  addWorkHref?: string;
  /**
   * Callback to flip status to "live". When omitted, the "Set to Live"
   * button is not rendered (used on the /add page where the owner is
   * still adding works and we don't want to encourage flipping yet).
   */
  onSetLive?: () => void | Promise<void>;
  className?: string;
}) {
  const { t } = useT();
  const {
    exhibitionId,
    status,
    worksCount,
    addWorkHref,
    onSetLive,
    className = "",
  } = props;

  const [justCreated, setJustCreated] = useState(false);
  const [settingLive, setSettingLive] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = `theo:exhibition-just-created:${exhibitionId}`;
    try {
      const flag = window.sessionStorage.getItem(key);
      if (flag === "1") {
        window.sessionStorage.removeItem(key);
        setJustCreated(true);
        window.setTimeout(() => setJustCreated(false), 6000);
      }
    } catch {
      // No-op on private mode / disabled storage.
    }
  }, [exhibitionId]);

  const isDraft = status === "planned" && worksCount === 0;
  if (!isDraft && !justCreated) return null;

  const addHref = addWorkHref ?? `/my/exhibitions/${exhibitionId}/add`;

  return (
    <div
      className={`space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 ${className}`}
      role="status"
    >
      {justCreated && (
        <p className="text-xs font-medium">
          {t("exhibition.savedNotPublic")}
        </p>
      )}
      {isDraft && (
        <>
          <p className="font-semibold">{t("exhibition.draftBanner.title")}</p>
          <p className="text-xs leading-relaxed text-amber-900/85">
            {t("exhibition.draftBanner.body")}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Link
              href={addHref}
              className="rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800"
            >
              {t("exhibition.draftBanner.addWork")}
            </Link>
            {onSetLive && (
              <button
                type="button"
                disabled
                title={t("exhibition.draftBanner.setLiveDisabled")}
                className="cursor-not-allowed rounded border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-700 opacity-60"
              >
                {t("exhibition.draftBanner.setLive")}
              </button>
            )}
          </div>
        </>
      )}
      {/*
        When worksCount ≥ 1 we do not render (see isDraft check above), so
        the "Set to Live" button is never live here; the parent page can
        add a promotion CTA elsewhere. Kept the disabled version above to
        make the state grammar obvious to future readers.
      */}
      {!isDraft && worksCount >= 1 && onSetLive && (
        <button
          type="button"
          onClick={async () => {
            setSettingLive(true);
            try {
              await onSetLive();
            } finally {
              setSettingLive(false);
            }
          }}
          disabled={settingLive}
          className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {settingLive ? "…" : t("exhibition.draftBanner.setLive")}
        </button>
      )}
    </div>
  );
}
