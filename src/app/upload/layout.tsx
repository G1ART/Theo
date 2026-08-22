"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useT } from "@/lib/i18n/useT";
import { AuthGate } from "@/components/AuthGate";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { TourTrigger, TourHelpButton } from "@/components/tour";
import { TOUR_IDS } from "@/lib/tours/tourRegistry";
import { PageShell } from "@/components/ds/PageShell";
import { PageHeader } from "@/components/ds/PageHeader";
import { LaneChips, type LaneOption } from "@/components/ds/LaneChips";
// 2026-08-03 (Phase A redesign) — Upload joins the 3-column shell so
// the left sidebar / right rail render consistently across primary
// surfaces. The inner PageShell keeps the narrow max-width for the
// upload form itself.
import { AppShell } from "@/components/shell/AppShell";

type TabKey = "single" | "bulk" | "exhibition";

const TABS: ReadonlyArray<{
  key: TabKey;
  href: string;
  labelKey: "upload.tabSingle" | "upload.tabBulk" | "upload.tabExhibition";
  anchor: string;
}> = [
  { key: "single", href: "/upload", labelKey: "upload.tabSingle", anchor: "upload-tab-single" },
  { key: "bulk", href: "/upload/bulk", labelKey: "upload.tabBulk", anchor: "upload-tab-bulk" },
  { key: "exhibition", href: "/upload/exhibition", labelKey: "upload.tabExhibition", anchor: "upload-tab-exhibition" },
];

/**
 * Upload chrome (sidebar + title + tabs) must paint even when the
 * session check is slow or hung. AuthGate only wraps the form body.
 * Desktop shell routes hide the global Header, so gating the chrome
 * used to leave a blank white canvas.
 */
export default function UploadLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { t } = useT();

  const activeKey: TabKey =
    pathname.startsWith("/upload/bulk")
      ? "bulk"
      : pathname.startsWith("/upload/exhibition")
        ? "exhibition"
        : "single";

  const options: ReadonlyArray<LaneOption<TabKey>> = TABS.map((tab) => ({
    id: tab.key,
    label: t(tab.labelKey),
    href: tab.href,
    "data-tour": tab.anchor,
  }));

  return (
    <AppShell>
      <PageShell variant="narrow">
        <PageHeader
          variant="plain"
          title={t("upload.title")}
          lead={t("upload.layoutLead")}
          actions={<TourHelpButton tourId={TOUR_IDS.upload} />}
          density="tight"
        />
        <LaneChips
          variant="lane"
          options={options}
          active={activeKey}
          ariaLabel={t("upload.title")}
          data-tour="upload-tabs"
          className="mb-8"
        />
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
