"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useT } from "@/lib/i18n/useT";
import { AuthGate } from "@/components/AuthGate";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { TourTrigger, TourHelpButton } from "@/components/tour";
import { TOUR_IDS } from "@/lib/tours/tourRegistry";
import { PageShell } from "@/components/ds/PageShell";
import { AppShell } from "@/components/shell/AppShell";
import { ProfileTabUploadNotice } from "@/components/upload/ProfileTabUploadNotice";
/**
 * Upload chrome sits in the existing 3-column shell (sidebar | center |
 * My Connection). Artworks is the entry workspace; Exhibition keeps the
 * exhibition composer. Single is the one-work form, Bulk is the default.
 */
export default function UploadLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useT();
  const [query, setQuery] = useState("");
  const [bulkHelp, setBulkHelp] = useState(false);

  useEffect(() => {
    setQuery(window.location.search || "");
  }, [pathname]);

  const onExhibition = pathname.startsWith("/upload/exhibition");
  const onSingle = pathname.startsWith("/upload/single");
  const onArtworks = !onExhibition;

  function hrefWithQuery(path: string) {
    return query ? `${path}${query}` : path;
  }

  function jumpToDrafts() {
    if (onArtworks && !onSingle) {
      document.getElementById("upload-drafts")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    router.push("/upload#upload-drafts");
  }

  const tabClass = (active: boolean) =>
    active ? "text-sm text-zinc-900" : "text-sm text-zinc-300 hover:text-zinc-500";

  const modeClass = (active: boolean) =>
    active ? "text-sm text-zinc-900" : "text-sm text-zinc-300 hover:text-zinc-500";

  return (
    <AppShell>
      <PageShell variant="studio">
        <header className="mb-1 flex items-start justify-between gap-3">
          <h1 className="text-[2rem] font-normal tracking-tight text-zinc-900">
            {t("upload.title")}
          </h1>
          <div className="flex items-center gap-2 pt-2">
            <TourHelpButton tourId={TOUR_IDS.upload} />
            <button
              type="button"
              onClick={jumpToDrafts}
              className="rounded-full border border-zinc-400 px-4 py-1 text-sm text-zinc-800 hover:bg-zinc-50"
            >
              {t("bulk.statusDraft")}
            </button>
          </div>
        </header>
        <nav
          data-tour="upload-tabs"
          aria-label={t("upload.title")}
          className="mt-4 grid grid-cols-2 border-b border-zinc-200 pb-2 text-center"
        >
          <Link href={hrefWithQuery("/upload")} className={tabClass(onArtworks)}>
            {t("upload.tabArtworks")}
          </Link>
          <Link
            href={hrefWithQuery("/upload/exhibition")}
            data-tour="upload-tab-exhibition"
            className={tabClass(onExhibition)}
          >
            {t("upload.tabExhibitionShort")}
          </Link>
        </nav>
        {onArtworks && <ProfileTabUploadNotice search={query} />}
        {onArtworks && (
          <div className="relative mt-6 mb-6 grid grid-cols-2 text-center">
            <Link
              href={hrefWithQuery("/upload/single")}
              data-tour="upload-tab-single"
              className={modeClass(onSingle)}
            >
              {t("upload.modeSingle")}
            </Link>
            <div className="relative inline-flex items-center justify-center gap-1">
              <Link
                href={hrefWithQuery(pathname.startsWith("/upload/bulk") ? "/upload/bulk" : "/upload")}
                data-tour="upload-tab-bulk"
                className={modeClass(!onSingle)}
              >
                {t("upload.modeBulk")}
              </Link>
              <button
                type="button"
                aria-expanded={bulkHelp}
                aria-label={t("upload.modeBulk")}
                onClick={() => setBulkHelp((open) => !open)}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-zinc-400 text-[10px] leading-none text-zinc-500"
              >
                ?
              </button>
              {bulkHelp && (
                <div className="absolute right-0 top-7 z-20 w-64 max-w-[calc(100vw-2rem)] rounded-md border border-zinc-300 bg-white px-3 py-2 text-left text-xs leading-relaxed text-zinc-600 shadow-sm">
                  <p>{t("bulk.dropLine1")}</p>
                  <p className="mt-1">
                    {t("bulk.dropLine2")}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
        <ErrorBoundary
          fallback={({ reset }) => (
            <div>
              <p className="text-sm font-medium text-zinc-900">
                {t("upload.error.title")}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-zinc-600">
                {t("upload.error.body")}
              </p>
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
          )}
        >
          <AuthGate>
            <TourTrigger tourId={TOUR_IDS.upload} />
            {children}
          </AuthGate>
        </ErrorBoundary>
      </PageShell>
    </AppShell>
  );
}
