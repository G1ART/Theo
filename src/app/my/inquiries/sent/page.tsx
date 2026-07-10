"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { useT } from "@/lib/i18n/useT";
import { backToLabel } from "@/lib/i18n/back";
import {
  listPriceInquiriesForInquirer,
  type PriceInquiryRow,
} from "@/lib/supabase/priceInquiries";
import { EmptyState } from "@/components/ds/EmptyState";
import { Chip } from "@/components/ds/Chip";
import { PageShell } from "@/components/ds/PageShell";
import { PageHeader } from "@/components/ds/PageHeader";

/**
 * Collector / inquirer "sent inquiries" inbox.
 *
 * The artist-side inbox (`/my/inquiries`) filters by `artworks.artist_id`,
 * so it is always empty for someone who only *sent* inquiries. This page
 * closes that broken loop: it lists the works a user has asked about and
 * links each row to the artwork page, where the full inquiry thread (with
 * reply history) already lives for the inquirer.
 *
 * Read-only + RLS-safe: `listPriceInquiriesForInquirer` relies on the
 * existing `price_inquiries_select_own` policy — no schema change.
 */
function SentInquiryStatus({ row }: { row: PriceInquiryRow }) {
  const { t } = useT();
  const status = row.inquiry_status;
  const replied =
    status === "replied" || (row.artist_reply ?? "").trim().length > 0 || !!row.replied_at;
  if (status === "closed") {
    return <Chip tone="muted">{t("inquiriesSent.statusClosed")}</Chip>;
  }
  if (replied) {
    return <Chip tone="success">{t("inquiriesSent.statusReplied")}</Chip>;
  }
  return <Chip tone="neutral">{t("inquiriesSent.statusWaiting")}</Chip>;
}

function SentInquiriesContent() {
  const { t, locale } = useT();
  const [list, setList] = useState<PriceInquiryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    listPriceInquiriesForInquirer().then(({ data }) => {
      if (!alive) return;
      setList(data);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <PageShell>
      <Link
        href="/feed?tab=all&sort=latest"
        className="mb-6 inline-block text-sm text-zinc-600 hover:text-zinc-900"
      >
        ← {backToLabel(t("nav.feed"), locale)}
      </Link>
      <PageHeader
        title={t("inquiriesSent.title")}
        lead={t("inquiriesSent.lead")}
      />
      {loading ? (
        <p className="text-sm text-zinc-500">{t("common.loading")}</p>
      ) : list.length === 0 ? (
        <EmptyState
          title={t("inquiriesSent.empty")}
          description={t("inquiriesSent.emptyDesc")}
          action={{ label: t("nav.feed"), href: "/feed?tab=artworks" }}
          size="sm"
        />
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200">
          {list.map((row) => {
            const title = row.artwork?.title || "Untitled";
            const date = new Date(
              row.last_message_at ?? row.created_at
            ).toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
            });
            return (
              <li key={row.id}>
                <Link
                  href={`/artwork/${row.artwork_id}`}
                  className="flex items-center justify-between gap-3 px-4 py-4 hover:bg-zinc-50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-900">
                      {title}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">{date}</p>
                  </div>
                  <SentInquiryStatus row={row} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </PageShell>
  );
}

export default function SentInquiriesPage() {
  return (
    <AuthGate>
      <SentInquiriesContent />
    </AuthGate>
  );
}
