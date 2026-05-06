"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { useActingAs } from "@/context/ActingAsContext";
import { useT } from "@/lib/i18n/useT";
import {
  listPriceInquiriesForArtist,
  listPriceInquiryMessages,
  listInquiryNotes,
  addInquiryNote,
  markPriceInquiryRead,
  replyToPriceInquiry,
  setPriceInquiryStatus,
  updateInquiryPipeline,
  type InquiryListCursor,
  type InquiryNoteRow,
  type InquiryStatus,
  type PipelineStage,
  type PriceInquiryMessageRow,
  type PriceInquiryRow,
} from "@/lib/supabase/priceInquiries";
import { EmptyState } from "@/components/ds/EmptyState";
import { Chip } from "@/components/ds/Chip";
import { PageShell } from "@/components/ds/PageShell";
import { PageHeader } from "@/components/ds/PageHeader";
import { LaneChips, type LaneOption } from "@/components/ds/LaneChips";
import { FloorPanel } from "@/components/ds/FloorPanel";
import { SectionLabel } from "@/components/ds/SectionLabel";
import type { MessageKey } from "@/lib/i18n/messages";
import { formatIdentityPair } from "@/lib/identity/format";
import { InquiryReplyAssist } from "@/components/ai/InquiryReplyAssist";
import { markAiAccepted } from "@/lib/ai/accept";
import { ActingAsChip } from "@/components/ActingAsChip";
import type { InquirySourceSurface } from "@/lib/supabase/priceInquiries";
import { listAccessRequestsForMe } from "@/lib/supabase/relationshipAccess";
import { requireSessionUid } from "@/lib/supabase/requireSessionUid";
import { supabase as supabaseClient } from "@/lib/supabase/client";

export default function MyInquiriesPage() {
  const { t, locale } = useT();
  const { actingAsProfileId } = useActingAs();
  const [list, setList] = useState<PriceInquiryRow[]>([]);
  const [nextCursor, setNextCursor] = useState<InquiryListCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [replyAiEventId, setReplyAiEventId] = useState<Record<string, string>>({});
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<InquiryStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [pipelineFilter, setPipelineFilter] = useState<PipelineStage | "all">("all");
  /**
   * Sprint 4 §4.1 — quiet source filter. Client-side mask only (the
   * server-side keyset pagination is unchanged), so the filter says "of
   * the rows currently loaded, only show these surfaces". Sized to the
   * minimum: All + the four surfaces actually written by Sprint 3 +
   * Profile/Exhibition (rare but valid). Direct rows show under "All"
   * because they have no source attribution to filter on.
   */
  const [sourceFilter, setSourceFilter] = useState<InquirySourceSurface | "all">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [messagesByInquiry, setMessagesByInquiry] = useState<Record<string, PriceInquiryMessageRow[]>>({});
  const [notesByInquiry, setNotesByInquiry] = useState<Record<string, InquiryNoteRow[]>>({});
  const [noteText, setNoteText] = useState<Record<string, string>>({});
  const [loadingMessages, setLoadingMessages] = useState<string | null>(null);
  const [pendingAccessRequests, setPendingAccessRequests] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let uid: string | null = null;
      try {
        uid = await requireSessionUid(supabaseClient);
      } catch {
        uid = null;
      }
      if (cancelled || !uid) return;
      const { data } = await listAccessRequestsForMe({
        ownerProfileId: uid,
        status: "pending",
        limit: 50,
      });
      if (cancelled) return;
      setPendingAccessRequests(data.length);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const tmr = setTimeout(() => setSearchDebounced(search.trim()), 350);
    return () => clearTimeout(tmr);
  }, [search]);

  const fetchFirstPage = useCallback(async () => {
    setLoading(true);
    const { data, nextCursor: nc, error } = await listPriceInquiriesForArtist({
      profileId: actingAsProfileId ?? undefined,
      limit: 20,
      cursor: null,
      status: statusFilter,
      pipelineStage: pipelineFilter,
      search: searchDebounced,
    });
    if (error) {
      setLoading(false);
      return;
    }
    setList(data ?? []);
    setNextCursor(nc);
    setLoading(false);
  }, [actingAsProfileId, statusFilter, pipelineFilter, searchDebounced]);

  useEffect(() => {
    const t = requestAnimationFrame(() => {
      void fetchFirstPage();
    });
    return () => cancelAnimationFrame(t);
  }, [fetchFirstPage]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const { data, nextCursor: nc, error } = await listPriceInquiriesForArtist({
      profileId: actingAsProfileId ?? undefined,
      limit: 20,
      cursor: nextCursor,
      pipelineStage: pipelineFilter,
      status: statusFilter,
      search: searchDebounced,
    });
    setLoadingMore(false);
    if (error) return;
    setList((prev) => {
      const seen = new Set(prev.map((r) => r.id));
      const add = (data ?? []).filter((r) => !seen.has(r.id));
      return [...prev, ...add];
    });
    setNextCursor(nc);
  }, [nextCursor, loadingMore, actingAsProfileId, statusFilter, pipelineFilter, searchDebounced]);

  const openThread = useCallback(
    async (row: PriceInquiryRow) => {
      const id = row.id;
      if (expandedId === id) {
        setExpandedId(null);
        return;
      }
      setExpandedId(id);
      void markPriceInquiryRead(id);
      setLoadingMessages(id);
      const [{ data, error }, { data: notes }] = await Promise.all([
        listPriceInquiryMessages(id),
        listInquiryNotes(id),
      ]);
      setLoadingMessages(null);
      if (!error && data) {
        setMessagesByInquiry((prev) => ({ ...prev, [id]: data }));
      }
      if (notes) {
        setNotesByInquiry((prev) => ({ ...prev, [id]: notes }));
      }
    },
    [expandedId]
  );

  const handleReply = useCallback(
    async (inquiryId: string) => {
      const text = replyText[inquiryId]?.trim();
      if (!text) return;
      const adoptedAiEventId = replyAiEventId[inquiryId] ?? null;
      setReplyingId(inquiryId);
      const { error } = await replyToPriceInquiry(inquiryId, text);
      setReplyingId(null);
      if (error) {
        setToast(t("common.replyFailed"));
        return;
      }
      if (adoptedAiEventId) {
        markAiAccepted(adoptedAiEventId, {
          feature: "inquiry_reply_draft",
          via: "send",
        });
      }
      setReplyText((prev) => {
        const next = { ...prev };
        delete next[inquiryId];
        return next;
      });
      setReplyAiEventId((prev) => {
        const next = { ...prev };
        delete next[inquiryId];
        return next;
      });
      const { data: msgs } = await listPriceInquiryMessages(inquiryId);
      if (msgs) setMessagesByInquiry((prev) => ({ ...prev, [inquiryId]: msgs }));
      await fetchFirstPage();
      setToast(t("common.replySent"));
    },
    [replyText, replyAiEventId, fetchFirstPage, t]
  );

  const handleStatusChange = useCallback(
    async (inquiryId: string, status: InquiryStatus) => {
      const { error } = await setPriceInquiryStatus(inquiryId, status);
      if (error) {
        setToast(t("priceInquiry.statusUpdateFailed"));
        return;
      }
      setList((prev) =>
        prev.map((r) => (r.id === inquiryId ? { ...r, inquiry_status: status } : r))
      );
      setToast(t("priceInquiry.statusUpdated"));
    },
    [t]
  );

  const handlePipelineChange = useCallback(
    async (inquiryId: string, stage: PipelineStage) => {
      const { error } = await updateInquiryPipeline(inquiryId, { pipeline_stage: stage });
      if (error) { setToast(t("priceInquiry.statusUpdateFailed")); return; }
      setList((prev) => prev.map((r) => (r.id === inquiryId ? { ...r, pipeline_stage: stage } : r)));
    },
    [t]
  );

  const handleAddNote = useCallback(
    async (inquiryId: string) => {
      const text = noteText[inquiryId]?.trim();
      if (!text) return;
      const { error } = await addInquiryNote(inquiryId, text);
      if (error) { setToast(t("common.replyFailed")); return; }
      setNoteText((prev) => { const n = { ...prev }; delete n[inquiryId]; return n; });
      const { data: notes } = await listInquiryNotes(inquiryId);
      if (notes) setNotesByInquiry((prev) => ({ ...prev, [inquiryId]: notes }));
    },
    [noteText, t]
  );

  const handleNextActionDate = useCallback(
    async (inquiryId: string, date: string) => {
      await updateInquiryPipeline(inquiryId, { next_action_date: date || null });
      setList((prev) => prev.map((r) => (r.id === inquiryId ? { ...r, next_action_date: date || null } : r)));
    },
    []
  );

  const unreadCount = useMemo(() => list.filter((r) => r.artist_unread === true).length, [list]);

  // Sprint 4 §4.1 — apply the client-side source filter on top of the
  // already-server-filtered list. "all" passes through; any other value
  // matches `source_surface` exactly (legacy/null rows never match a
  // specific surface, so they correctly disappear from non-"all" views
  // — that's the desired UX, those rows still show under "All").
  const visibleList = useMemo(() => {
    if (sourceFilter === "all") return list;
    return list.filter((r) => r.source_surface === sourceFilter);
  }, [list, sourceFilter]);

  // Pre-built lane options. Memoized so identity is stable across renders
  // (avoids LaneChips re-rendering its child buttons unnecessarily).
  const statusLaneOptions = useMemo<ReadonlyArray<LaneOption<InquiryStatus | "all">>>(
    () => [
      { id: "all", label: t("priceInquiry.filterAll") },
      { id: "new", label: t("priceInquiry.filterNew") },
      { id: "open", label: t("priceInquiry.filterOpen") },
      { id: "replied", label: t("priceInquiry.filterReplied") },
      { id: "closed", label: t("priceInquiry.filterClosed") },
    ],
    [t]
  );
  const sourceLaneOptions = useMemo<
    ReadonlyArray<LaneOption<InquirySourceSurface | "all">>
  >(
    () => [
      { id: "all", label: t("inquiry.source.filterAll") },
      { id: "feed", label: t("inquiry.source.filterFeed") },
      { id: "room", label: t("inquiry.source.filterRoom") },
      { id: "artwork", label: t("inquiry.source.filterArtwork") },
      { id: "exhibition", label: t("inquiry.source.filterExhibition") },
      { id: "profile", label: t("inquiry.source.filterProfile") },
    ],
    [t]
  );

  return (
    <AuthGate>
      <PageShell variant="narrow">
        <Link
          href="/my"
          className="mb-6 inline-block text-sm text-zinc-500 hover:text-zinc-900"
        >
          ← {t("profile.privateBackToMy")}
        </Link>
        <PageHeader
          title={t("priceInquiry.title")}
          lead={
            unreadCount > 0
              ? t("priceInquiry.unreadBadge").replace("{n}", String(unreadCount))
              : null
          }
          density="tight"
        />

        <ActingAsChip mode="replying" />

        {pendingAccessRequests !== null && pendingAccessRequests > 0 && (
          <Link
            href="/my/access-requests"
            className="mt-3 inline-flex items-center gap-2 rounded-full bg-zinc-900 px-3 py-1 text-[11px] font-medium text-white hover:bg-zinc-800"
          >
            {t("inquiries.accessRequestsChip").replace(
              "{n}",
              String(pendingAccessRequests)
            )}
          </Link>
        )}

        {/* Filter rail — calmer than the previous select trio. status is
            a 5-option lane (all + 4), source is a 6-option lane, search
            stays as a single input. Pipeline is intentionally still a
            native select: 7 options is too many for a calm chip rail and
            would push width past the 2xl content column on mobile. */}
        <div className="mb-3 mt-4 flex flex-col gap-2.5">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("priceInquiry.searchPlaceholder")}
            className="w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-300 sm:max-w-xs"
          />
          <LaneChips
            variant="sort"
            ariaLabel={t("priceInquiry.statusLabel")}
            options={statusLaneOptions}
            active={statusFilter}
            onChange={setStatusFilter}
          />
          <LaneChips
            variant="sort"
            ariaLabel={t("inquiry.source.filterAll")}
            options={sourceLaneOptions}
            active={sourceFilter}
            onChange={setSourceFilter}
          />
          <div className="flex items-center gap-2">
            <SectionLabel as="span">{t("priceInquiry.pipelineLabel")}</SectionLabel>
            <select
              value={pipelineFilter}
              onChange={(e) => setPipelineFilter(e.target.value as PipelineStage | "all")}
              className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-700 focus:border-zinc-400 focus:outline-none"
            >
              <option value="all">{t("priceInquiry.pipelineFilterAll")}</option>
              <option value="new">{t("priceInquiry.pipelineStage.new")}</option>
              <option value="contacted">{t("priceInquiry.pipelineStage.contacted")}</option>
              <option value="in_discussion">{t("priceInquiry.pipelineStage.in_discussion")}</option>
              <option value="offer_sent">{t("priceInquiry.pipelineStage.offer_sent")}</option>
              <option value="closed_won">{t("priceInquiry.pipelineStage.closed_won")}</option>
              <option value="closed_lost">{t("priceInquiry.pipelineStage.closed_lost")}</option>
            </select>
          </div>
        </div>

        {toast && (
          <p className="mb-4 text-sm text-zinc-600" role="status">
            {toast}
          </p>
        )}

        {loading ? (
          <p className="text-zinc-500">{t("common.loading")}</p>
        ) : visibleList.length === 0 ? (
          <EmptyState title={t("priceInquiry.empty")} size="sm" />
        ) : (
          <ul className="space-y-4">
            {visibleList.map((row) => {
              const expanded = expandedId === row.id;
              const msgs = messagesByInquiry[row.id];
              return (
                <li
                  key={row.id}
                  className={`rounded-2xl border bg-white p-4 ${
                    row.artist_unread ? "border-amber-200 ring-1 ring-amber-100" : "border-zinc-200"
                  }`}
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void openThread(row)}
                      className="text-left font-medium text-zinc-900 hover:underline"
                    >
                      {row.artwork?.title ?? t("common.untitled")}
                    </button>
                    <Link
                      href={`/artwork/${row.artwork_id}`}
                      className="text-xs text-zinc-500 hover:text-zinc-800"
                      onClick={() => void markPriceInquiryRead(row.id)}
                    >
                      {t("priceInquiry.viewArtwork")}
                    </Link>
                    {row.artist_unread && (
                      <Chip tone="warning">{t("priceInquiry.unread")}</Chip>
                    )}
                    {/* Sprint 3 — quiet source chip. Mapped via i18n key
                        to avoid hardcoding visible English/Korean. Falls
                        through silently when no attribution was recorded
                        (legacy rows + direct page visits). */}
                    {(() => {
                      const surface = row.source_surface;
                      if (!surface) return null;
                      const key = `inquiry.source.${surface}` as const;
                      return (
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                          {t(key)}
                        </span>
                      );
                    })()}
                  </div>
                  {/* Default row meta — Sprint 4 §3.3 progressive disclosure.
                      Identity + last activity + status summary chip. The
                      whole pipeline / assignee / next-action / notes UI
                      moves into the expanded "Manage" panel below so the
                      list is calm at rest. */}
                  <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-600">
                    {(() => {
                      const { primary, secondary } = formatIdentityPair(row.inquirer, t);
                      return (
                        <span>
                          {primary}
                          {secondary && <span className="text-zinc-400"> {secondary}</span>}
                        </span>
                      );
                    })()}
                    <span className="text-zinc-300">·</span>
                    <span className="text-xs text-zinc-500">
                      {row.last_message_at
                        ? new Date(row.last_message_at).toLocaleString()
                        : new Date(row.created_at).toLocaleString()}
                    </span>
                    <span className="text-zinc-300">·</span>
                    {(() => {
                      const status = row.inquiry_status ?? "open";
                      const labelKey = (
                        status === "new"
                          ? "priceInquiry.statusSummaryNew"
                          : status === "open"
                            ? "priceInquiry.statusSummaryOpen"
                            : status === "replied"
                              ? "priceInquiry.statusSummaryReplied"
                              : "priceInquiry.statusSummaryClosed"
                      ) satisfies MessageKey;
                      const tone =
                        status === "replied"
                          ? "success"
                          : status === "closed"
                            ? "muted"
                            : "neutral";
                      return (
                        <Chip tone={tone} size="xs">
                          {t(labelKey)}
                        </Chip>
                      );
                    })()}
                  </div>

                  {expanded && (
                    <div className="mt-3 space-y-4 border-t border-zinc-100 pt-3">
                      {/* Manage panel: pipeline / assignee / next-action.
                          Hand-rolled controls collected into a single
                          FloorPanel so the operator sees them as ONE
                          area, not four neighbouring strays. */}
                      <FloorPanel padding="sm" as="div">
                        <SectionLabel className="mb-2">
                          {t("priceInquiry.manageTitle")}
                        </SectionLabel>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                          <label className="flex items-center gap-1.5 text-xs text-zinc-600">
                            <span className="text-zinc-500">{t("priceInquiry.statusLabel")}</span>
                            <select
                              value={row.inquiry_status ?? "open"}
                              onChange={(e) => void handleStatusChange(row.id, e.target.value as InquiryStatus)}
                              className="rounded-full border border-zinc-200 bg-white px-2.5 py-0.5 text-xs"
                            >
                              <option value="new">{t("priceInquiry.filterNew")}</option>
                              <option value="open">{t("priceInquiry.filterOpen")}</option>
                              <option value="replied">{t("priceInquiry.filterReplied")}</option>
                              <option value="closed">{t("priceInquiry.filterClosed")}</option>
                            </select>
                          </label>
                          <label className="flex items-center gap-1.5 text-xs text-zinc-600">
                            <span className="text-zinc-500">{t("priceInquiry.pipelineLabel")}</span>
                            <select
                              value={row.pipeline_stage ?? "new"}
                              onChange={(e) => void handlePipelineChange(row.id, e.target.value as PipelineStage)}
                              className="rounded-full border border-zinc-200 bg-white px-2.5 py-0.5 text-xs"
                            >
                              <option value="new">{t("priceInquiry.pipelineStage.new")}</option>
                              <option value="contacted">{t("priceInquiry.pipelineStage.contacted")}</option>
                              <option value="in_discussion">{t("priceInquiry.pipelineStage.in_discussion")}</option>
                              <option value="offer_sent">{t("priceInquiry.pipelineStage.offer_sent")}</option>
                              <option value="closed_won">{t("priceInquiry.pipelineStage.closed_won")}</option>
                              <option value="closed_lost">{t("priceInquiry.pipelineStage.closed_lost")}</option>
                            </select>
                          </label>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                void updateInquiryPipeline(row.id, {
                                  assignee_id: actingAsProfileId ?? undefined,
                                });
                                setList((prev) =>
                                  prev.map((r) =>
                                    r.id === row.id
                                      ? { ...r, assignee_id: actingAsProfileId }
                                      : r
                                  )
                                );
                              }}
                              className="rounded-full border border-zinc-200 bg-white px-2.5 py-0.5 text-xs text-zinc-600 hover:bg-zinc-50"
                            >
                              {row.assignee_id
                                ? t("priceInquiry.reassignToMe")
                                : t("priceInquiry.assignToMe")}
                            </button>
                            {row.assignee_id && (
                              <Chip tone="success" size="xs">
                                {t("priceInquiry.assigneeAssignedHint")}
                              </Chip>
                            )}
                          </div>
                          <label className="flex items-center gap-1.5 text-xs text-zinc-600">
                            <span className="text-zinc-500">{t("priceInquiry.nextActionLabel")}</span>
                            <input
                              type="date"
                              lang={locale}
                              value={row.next_action_date ?? ""}
                              onChange={(e) => void handleNextActionDate(row.id, e.target.value)}
                              className="rounded-full border border-zinc-200 bg-white px-2.5 py-0.5 text-xs"
                            />
                          </label>
                        </div>
                      </FloorPanel>

                      {loadingMessages === row.id ? (
                        <p className="text-sm text-zinc-500">{t("common.loading")}</p>
                      ) : msgs && msgs.length > 0 ? (
                        <ul className="mb-4 space-y-3">
                          {msgs.map((m) => (
                            <li key={m.id} className="rounded bg-zinc-50 px-3 py-2 text-sm text-zinc-800">
                              <span className="text-xs text-zinc-500">
                                {new Date(m.created_at).toLocaleString()}
                              </span>
                              <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        row.message && (
                          <p className="mb-3 text-sm text-zinc-700">{row.message}</p>
                        )
                      )}
                      <div>
                        {/* Moment-of-mutation chip: surfaces persona right
                            above the reply textarea so the operator never
                            confuses operator-self with principal when sending. */}
                        <ActingAsChip mode="replying" className="mb-2" />
                        <textarea
                          placeholder={t("priceInquiry.replyPlaceholder")}
                          value={replyText[row.id] ?? ""}
                          onChange={(e) => {
                            const next = e.target.value;
                            setReplyText((prev) => ({ ...prev, [row.id]: next }));
                            if (!next.trim()) {
                              setReplyAiEventId((prev) => {
                                const copy = { ...prev };
                                delete copy[row.id];
                                return copy;
                              });
                            }
                          }}
                          className="w-full rounded border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                          rows={3}
                        />
                        <button
                          type="button"
                          disabled={!replyText[row.id]?.trim() || replyingId === row.id}
                          onClick={() => void handleReply(row.id)}
                          className="mt-2 rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                        >
                          {replyingId === row.id ? t("common.loading") : t("priceInquiry.reply")}
                        </button>
                        <InquiryReplyAssist
                          artwork={{
                            title: row.artwork?.title ?? null,
                          }}
                          thread={(messagesByInquiry[row.id] ?? [])
                            .slice(-3)
                            .map((m) => ({
                              from: (m.sender_id === row.inquirer_id
                                ? "inquirer"
                                : "owner") as "inquirer" | "owner",
                              text: m.body ?? "",
                            }))}
                          currentReply={replyText[row.id] ?? ""}
                          onApply={(text, aiEventId) => {
                            setReplyText((prev) => ({ ...prev, [row.id]: text }));
                            setReplyAiEventId((prev) => {
                              const next = { ...prev };
                              if (aiEventId) next[row.id] = aiEventId;
                              else delete next[row.id];
                              return next;
                            });
                          }}
                        />
                      </div>

                      <div className="mt-4 border-t border-zinc-100 pt-3">
                        <p className="mb-2 text-xs font-medium text-zinc-500">{t("priceInquiry.internalNotesTitle")}</p>
                        {(notesByInquiry[row.id] ?? []).length > 0 && (
                          <ul className="mb-3 space-y-2">
                            {notesByInquiry[row.id].map((n) => (
                              <li key={n.id} className="rounded bg-amber-50 px-3 py-2 text-sm text-zinc-700">
                                <span className="text-xs text-zinc-400">{new Date(n.created_at).toLocaleString()}</span>
                                <p className="mt-0.5 whitespace-pre-wrap">{n.body}</p>
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder={t("priceInquiry.internalNotePlaceholder")}
                            value={noteText[row.id] ?? ""}
                            onChange={(e) => setNoteText((prev) => ({ ...prev, [row.id]: e.target.value }))}
                            className="flex-1 rounded border border-zinc-300 px-3 py-1.5 text-sm"
                          />
                          <button
                            type="button"
                            disabled={!noteText[row.id]?.trim()}
                            onClick={() => void handleAddNote(row.id)}
                            className="rounded-full bg-zinc-700 px-4 py-1.5 text-sm text-white hover:bg-zinc-600 disabled:opacity-50"
                          >
                            {t("priceInquiry.internalNoteAdd")}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {!expanded && (
                    <button
                      type="button"
                      onClick={() => void openThread(row)}
                      className="text-sm text-zinc-600 underline hover:text-zinc-900"
                    >
                      {t("priceInquiry.openThread")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {nextCursor != null && !loading && (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => void loadMore()}
              className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            >
              {loadingMore ? t("common.loading") : t("priceInquiry.loadMore")}
            </button>
          </div>
        )}
      </PageShell>
    </AuthGate>
  );
}
