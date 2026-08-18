"use client";

// Sprint 6.2 — Access Requests panel.
//
// Extracted from /my/access-requests/page.tsx so the same inbox can
// render inline as a tab inside the unified Network hub at /my/network.
// The legacy /my/access-requests route now redirects to
// /my/network?tab=requests and reuses this same panel.
//
// Sprint 7.1 Phase A: principal-aware. When the operator is acting-as
// a delegate, this panel must read the *principal's* access requests,
// not `auth.uid()`'s own. We mirror the RelationshipDeskPanel pattern
// (`effectiveOwnerProfileId = actingAsProfileId ?? sessionUserId`) so
// both Network Hub tabs share one principal source of truth. The
// Sprint 5 RLS policies on `access_requests` already allow
// `is_active_account_delegate_writer(owner_profile_id)`, so passing
// the principal id is sufficient — no extra elevation required.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { setArtworkBack } from "@/lib/artworkBack";
import { FloorPanel } from "@/components/ds/FloorPanel";
import { LaneChips, type LaneOption } from "@/components/ds/LaneChips";
import { EmptyState } from "@/components/ds/EmptyState";
import { Chip } from "@/components/ds/Chip";
import { useT } from "@/lib/i18n/useT";
import { formatDisplayName } from "@/lib/identity/format";
import type { MessageKey } from "@/lib/i18n/messages";
import { requireSessionUid } from "@/lib/supabase/requireSessionUid";
import { supabase } from "@/lib/supabase/client";
import { useActingAs } from "@/context/ActingAsContext";
import {
  listAccessRequestsForOwnerEnriched,
  type AccessRequestRowEnriched,
} from "@/lib/supabase/relationshipAccess";
import type { AccessRequestStatus } from "@/lib/visibility/types";
import { logBetaEventSync } from "@/lib/beta/logEvent";
import {
  ACCESS_GRANT_SCOPES,
  resolveAccessRequestWithScope,
  type AccessGrantScope,
} from "@/lib/access/resolveV2Adapter";

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

export function AccessRequestsPanel() {
  const { t, locale } = useT();
  const { actingAsProfileId, actingAsLabel } = useActingAs();
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [rows, setRows] = useState<AccessRequestRowEnriched[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("pending");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showNarrowFor, setShowNarrowFor] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Sprint 7.1 Phase A — principal scope. Acting-as never swaps
  // `auth.uid()`; the principal id flows through React context.
  const effectiveOwnerProfileId = actingAsProfileId ?? sessionUserId;

  const refresh = useCallback(async (ownerProfileId: string) => {
    setLoading(true);
    const { data } = await listAccessRequestsForOwnerEnriched({
      ownerProfileId,
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
      setSessionUserId(uid);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!effectiveOwnerProfileId) return;
    // Defer the fetch (which calls setState) one frame so the lint
    // rule `react-hooks/set-state-in-effect` doesn't trip. Mirrors the
    // RelationshipDeskPanel pattern.
    const handle = requestAnimationFrame(() => {
      void refresh(effectiveOwnerProfileId);
    });
    return () => cancelAnimationFrame(handle);
  }, [effectiveOwnerProfileId, refresh]);

  const filterOptions: LaneOption<FilterKey>[] = [
    { id: "all", label: t("accessRequestInbox.filter.all") },
    { id: "pending", label: t("accessRequestInbox.filter.pending") },
    { id: "resolved", label: t("accessRequestInbox.filter.resolved") },
  ];

  const visible = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => statusToFilter(r.status) === filter);
  }, [rows, filter]);

  const handleScopedAction = async (
    request: AccessRequestRowEnriched,
    scope: AccessGrantScope
  ) => {
    setActingId(request.id);
    setErrorMessage(null);
    const { data, error } = await resolveAccessRequestWithScope({
      request,
      scope,
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
    logBetaEventSync("access_grant_lifecycle_changed", {
      scope,
      subject_type: request.subject_type,
      surface: "network_hub",
    });
    if (scope !== "decline") {
      logBetaEventSync("access_grant_created", {
        subject_type: request.subject_type,
        subject_id: request.subject_id ?? undefined,
        field_key: request.field_key,
        scope,
        surface: "access_request_inbox",
      });
      logBetaEventSync("approved_viewer_added", {
        subject_type: request.subject_type,
        subject_id: request.subject_id ?? undefined,
        field_key: request.field_key,
        scope,
        surface: "access_request_inbox",
      });
    }
    setRows((prev) =>
      prev.map((r) =>
        r.id === request.id ? { ...data, requester: r.requester } : r
      )
    );
    setShowNarrowFor(null);
  };

  const scopeLabelKey = (scope: AccessGrantScope): MessageKey => {
    switch (scope) {
      case "all":
        return "accessRequestInbox.narrow.all";
      case "this_work":
        return "accessRequestInbox.narrow.thisWork";
      case "thirty_days":
        return "accessRequestInbox.narrow.thirtyDays";
      case "decline":
        return "accessRequestInbox.narrow.decline";
    }
  };

  if (!effectiveOwnerProfileId) {
    return (
      <p className="py-8 text-center text-sm text-zinc-500">
        {t("common.loading")}
      </p>
    );
  }

  const actingAsHint =
    actingAsProfileId && actingAsLabel
      ? t("accessRequestInbox.actingAsHint").replace("{label}", actingAsLabel)
      : null;

  return (
    <div data-tour="network-requests-panel">
      {actingAsHint && (
        <p
          data-acting-as="true"
          className="mb-3 rounded-xl border border-dashed border-zinc-200 bg-zinc-50/70 px-3 py-2 text-[11px] text-zinc-600 break-keep"
        >
          {actingAsHint}
        </p>
      )}
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
        <p className="text-sm text-zinc-500">
          {t("accessRequestInbox.loading")}
        </p>
      ) : visible.length === 0 ? (
        <EmptyState
          title={t("empty.requests.title")}
          description={`${t("empty.requests.why")} ${t("empty.requests.whatNext")}`}
          action={{ label: t("empty.requests.cta"), href: "/my/visibility" }}
        />
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
                      setExpandedId((prev) =>
                        prev === row.id ? null : row.id
                      )
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
                          {t(
                            `visibility.field.${row.field_key}` as MessageKey
                          )}
                        </span>
                      </p>
                      <p className="mt-0.5 text-[11px] text-zinc-500 break-keep">
                        {(() => {
                          const r = row.requester;
                          const localized = r
                            ? formatDisplayName(r, t, locale)
                            : "";
                          const name =
                            localized ||
                            r?.display_name?.trim() ||
                            (r?.username ? `@${r.username}` : null) ||
                            t("accessRequestInbox.requesterUnknown");
                          const role = r?.main_role?.trim() || null;
                          return role ? `${name} · ${role}` : name;
                        })()}
                        {" · "}
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
                      {t(`accessRequestInbox.${row.status}` as MessageKey)}
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
                            onClick={() => setArtworkBack()}
                            className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50"
                          >
                            {t("accessRequestInbox.viewSubject")}
                          </Link>
                        ) : (
                          <span />
                        )}
                        {row.status === "pending" && (
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setShowNarrowFor((prev) =>
                                  prev === row.id ? null : row.id
                                )
                              }
                              aria-expanded={showNarrowFor === row.id}
                              className="rounded-full border border-transparent bg-transparent px-2.5 py-1.5 text-[11px] font-medium text-zinc-500 hover:text-zinc-700"
                            >
                              {showNarrowFor === row.id
                                ? t("accessRequestInbox.narrow.toggleHide")
                                : t("accessRequestInbox.narrow.toggleShow")}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void handleScopedAction(row, "decline")
                              }
                              disabled={actingId === row.id}
                              className="rounded-full border border-zinc-300 bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed"
                            >
                              {t("accessRequestInbox.decline")}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void handleScopedAction(row, "all")
                              }
                              disabled={actingId === row.id}
                              className="rounded-full bg-zinc-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
                            >
                              {t("accessRequestInbox.approve")}
                            </button>
                          </div>
                        )}
                      </div>
                      {row.status === "pending" && showNarrowFor === row.id && (
                        <div className="flex flex-col gap-2 rounded-xl border border-zinc-200/70 bg-zinc-50/60 px-3 py-3">
                          <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                            {t("accessRequestInbox.narrow.label")}
                          </p>
                          <p className="text-xs text-zinc-600">
                            {t("accessRequestInbox.narrow.hint")}
                          </p>
                          <div className="flex flex-wrap gap-2 pt-1">
                            {ACCESS_GRANT_SCOPES.map((scope) => {
                              const isPrimary = scope === "all";
                              const isDanger = scope === "decline";
                              const base =
                                "rounded-full px-3 py-1.5 text-[11px] font-medium disabled:cursor-not-allowed";
                              const tone = isPrimary
                                ? "bg-zinc-900 text-white hover:bg-zinc-800 disabled:bg-zinc-300"
                                : isDanger
                                ? "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                                : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50";
                              return (
                                <button
                                  key={scope}
                                  type="button"
                                  data-scope={scope}
                                  onClick={() =>
                                    void handleScopedAction(row, scope)
                                  }
                                  disabled={actingId === row.id}
                                  className={`${base} ${tone}`}
                                >
                                  {t(scopeLabelKey(scope))}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
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
    </div>
  );
}
