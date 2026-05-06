"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AuthGate } from "@/components/AuthGate";
import { PageShell } from "@/components/ds/PageShell";
import { PageHeader } from "@/components/ds/PageHeader";
import { FloorPanel } from "@/components/ds/FloorPanel";
import { LaneChips, type LaneOption } from "@/components/ds/LaneChips";
import { EmptyState } from "@/components/ds/EmptyState";
import { Chip } from "@/components/ds/Chip";
import { useT } from "@/lib/i18n/useT";
import type { MessageKey } from "@/lib/i18n/messages";
import { requireSessionUid } from "@/lib/supabase/requireSessionUid";
import { supabase } from "@/lib/supabase/client";
import {
  listAccessRequestsForMe,
  resolveAccessRequest,
} from "@/lib/supabase/relationshipAccess";
import type {
  AccessRequest,
  AccessRequestStatus,
} from "@/lib/visibility/types";
import { logBetaEventSync } from "@/lib/beta/logEvent";

type FilterKey = "all" | "pending" | "resolved";

function statusToFilter(status: AccessRequestStatus): "pending" | "resolved" {
  return status === "pending" ? "pending" : "resolved";
}

function relativeTime(iso: string, locale: string): string {
  try {
    const dt = new Date(iso);
    const diffMs = Date.now() - dt.getTime();
    const minute = 60_000;
    if (diffMs < 60 * minute) {
      const m = Math.max(1, Math.round(diffMs / minute));
      return locale === "ko" ? `${m}분 전` : `${m}m ago`;
    }
    if (diffMs < 24 * 60 * minute) {
      const h = Math.round(diffMs / (60 * minute));
      return locale === "ko" ? `${h}시간 전` : `${h}h ago`;
    }
    const d = Math.round(diffMs / (24 * 60 * minute));
    return locale === "ko" ? `${d}일 전` : `${d}d ago`;
  } catch {
    return iso;
  }
}

function AccessRequestsInner() {
  const { t, locale } = useT();
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [rows, setRows] = useState<AccessRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("pending");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refresh = useCallback(async (uid: string) => {
    setLoading(true);
    const { data } = await listAccessRequestsForMe({
      ownerProfileId: uid,
      status: "all",
      limit: 100,
    });
    setRows(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let uid: string | null = null;
      try {
        uid = await requireSessionUid(supabase);
      } catch {
        uid = null;
      }
      if (cancelled || !uid) return;
      setOwnerId(uid);
      await refresh(uid);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const filterOptions: LaneOption<FilterKey>[] = [
    { id: "all", label: t("accessRequestInbox.filter.all") },
    { id: "pending", label: t("accessRequestInbox.filter.pending") },
    { id: "resolved", label: t("accessRequestInbox.filter.resolved") },
  ];

  const visible = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => statusToFilter(r.status) === filter);
  }, [rows, filter]);

  const handleAction = async (
    request: AccessRequest,
    action: "approve" | "decline"
  ) => {
    setActingId(request.id);
    setErrorMessage(null);
    const { data, error } = await resolveAccessRequest({
      requestId: request.id,
      action,
    });
    setActingId(null);
    if (error || !data) {
      setErrorMessage(t("visibility.preset.saveFailed"));
      return;
    }
    logBetaEventSync("access_request_resolved", {
      subject_type: request.subject_type,
      subject_id: request.subject_id ?? undefined,
      field_key: request.field_key,
      request_type: request.request_type,
      status: data.status,
      surface: "access_request_inbox",
    });
    if (action === "approve") {
      logBetaEventSync("access_grant_created", {
        subject_type: request.subject_type,
        subject_id: request.subject_id ?? undefined,
        field_key: request.field_key,
        surface: "access_request_inbox",
      });
      logBetaEventSync("approved_viewer_added", {
        subject_type: request.subject_type,
        subject_id: request.subject_id ?? undefined,
        field_key: request.field_key,
        surface: "access_request_inbox",
      });
    }
    setRows((prev) => prev.map((r) => (r.id === request.id ? data : r)));
  };

  if (!ownerId) {
    return (
      <PageShell variant="narrow">
        <p className="text-sm text-zinc-500">{t("common.loading")}</p>
      </PageShell>
    );
  }

  return (
    <PageShell variant="narrow">
      <PageHeader
        variant="editorial"
        kicker={t("accessRequestInbox.kicker")}
        title={t("accessRequestInbox.title")}
      />

      <div className="mb-5">
        <LaneChips
          variant="sort"
          options={filterOptions}
          active={filter}
          onChange={setFilter}
          ariaLabel={t("accessRequestInbox.title")}
        />
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500">{t("accessRequestInbox.loading")}</p>
      ) : visible.length === 0 ? (
        <EmptyState title={t("accessRequestInbox.empty")} />
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((row) => {
            const isOpen = expandedId === row.id;
            const subjectHref =
              row.subject_type === "artwork" && row.subject_id
                ? `/artwork/${row.subject_id}`
                : null;
            return (
              <li key={row.id}>
                <FloorPanel padding="sm">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 text-left"
                    onClick={() =>
                      setExpandedId((prev) => (prev === row.id ? null : row.id))
                    }
                    aria-expanded={isOpen}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-900">
                        {t(
                          `accessRequest.requestType.${row.request_type}` as MessageKey
                        )}{" "}
                        ·{" "}
                        <span className="font-normal text-zinc-600">
                          {t(`visibility.field.${row.field_key}` as MessageKey)}
                        </span>
                      </p>
                      <p className="mt-0.5 text-[11px] text-zinc-500">
                        {row.requester_profile_id.slice(0, 8)} ·{" "}
                        {relativeTime(row.created_at, locale)}
                      </p>
                    </div>
                    <Chip
                      tone={
                        row.status === "pending"
                          ? "warning"
                          : row.status === "approved"
                          ? "success"
                          : "muted"
                      }
                      size="sm"
                    >
                      {t(
                        `accessRequestInbox.${row.status}` as MessageKey
                      )}
                    </Chip>
                  </button>

                  {isOpen && (
                    <div className="mt-4 flex flex-col gap-3 border-t border-zinc-200/70 pt-4">
                      {row.message && (
                        <p className="whitespace-pre-wrap rounded-xl bg-white px-3 py-2.5 text-xs text-zinc-700">
                          {row.message}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        {subjectHref ? (
                          <Link
                            href={subjectHref}
                            className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50"
                          >
                            {t("accessRequestInbox.viewSubject")}
                          </Link>
                        ) : (
                          <span />
                        )}
                        {row.status === "pending" && (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void handleAction(row, "decline")}
                              disabled={actingId === row.id}
                              className="rounded-full border border-zinc-300 bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed"
                            >
                              {t("accessRequestInbox.decline")}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleAction(row, "approve")}
                              disabled={actingId === row.id}
                              className="rounded-full bg-zinc-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
                            >
                              {t("accessRequestInbox.approve")}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </FloorPanel>
              </li>
            );
          })}
        </ul>
      )}

      {errorMessage && (
        <p className="mt-4 text-xs text-red-600">{errorMessage}</p>
      )}
    </PageShell>
  );
}

export default function AccessRequestsPage() {
  return (
    <AuthGate>
      <AccessRequestsInner />
    </AuthGate>
  );
}
