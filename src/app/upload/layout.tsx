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
import { PageHeader } from "@/components/ds/PageHeader";
import { AppShell } from "@/components/shell/AppShell";

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
    active
      ? "-mb-px border-b-2 border-zinc-900 pb-2 text-sm font-medium text-zinc-900"
      : "pb-2 text-sm text-zinc-400 hover:text-zinc-700";

  const modeClass = (active: boolean) =>
    active
      ? "border-b border-zinc-900 pb-0.5 text-sm font-medium text-zinc-900"
      : "pb-0.5 text-sm text-zinc-400 hover:text-zinc-700";

  return (
    <AppShell>
      <PageShell variant="studio">
        <PageHeader
          variant="plain"
          title={t("upload.title")}
          actions={
            <>
              <button
                type="button"
                onClick={jumpToDrafts}
                className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-zinc-800 hover:bg-zinc-50"
              >
                {t("bulk.statusDraft")}
              </button>
              <TourHelpButton tourId={TOUR_IDS.upload} />
            </>
          }
          density="tight"
        />
        <nav
          data-tour="upload-tabs"
          aria-label={t("upload.title")}
          className="mb-5 flex items-center justify-center gap-12 border-b border-zinc-200"
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
        {onArtworks && (
          <div className="mb-6 flex items-center justify-center gap-16">
            <Link
              href={hrefWithQuery("/upload/single")}
              data-tour="upload-tab-single"
              className={modeClass(onSingle)}
            >
              {t("upload.modeSingle")}
            </Link>
            <Link
              href={hrefWithQuery(pathname.startsWith("/upload/bulk") ? "/upload/bulk" : "/upload")}
              data-tour="upload-tab-bulk"
              className={modeClass(!onSingle)}
            >
              {t("upload.modeBulk")}
              <span
                className="ml-1 text-xs font-normal text-zinc-400"
                title={t("bulk.workspaceDrop")}
              >
                (?)
              </span>
            </Link>
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
