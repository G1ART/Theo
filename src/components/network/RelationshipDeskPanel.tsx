"use client";

// Sprint 6.2 — Relationship Desk panel.
//
// Extracted from /my/relationships/page.tsx so the same desk + card +
// private-note UI can render inline as a tab inside the unified Network
// hub at /my/network. The Sprint 6.1 acting-as / delegate principal
// correctness (effectiveOwnerProfileId is passed to every RPC) lives
// here verbatim — the panel is principal-aware regardless of which
// surface mounts it. The legacy /my/relationships route now redirects
// to /my/network?tab=relationships and reuses this same panel.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n/useT";
import { useActingAs } from "@/context/ActingAsContext";
import { logBetaEventSync } from "@/lib/beta/logEvent";
import { LaneChips, type LaneOption } from "@/components/ds/LaneChips";
import { EmptyState } from "@/components/ds/EmptyState";
import { FloorPanel } from "@/components/ds/FloorPanel";
import {
  getRelationshipDeskForOwner,
  getRelationshipCardForOwner,
  upsertRelationshipPrivateNote,
} from "@/lib/supabase/relationshipAccess";
import type {
  RelationshipCard,
  RelationshipDeskFilter,
  RelationshipDeskRow,
  RelationshipStatus,
} from "@/lib/visibility/types";
import { getArtworkImageUrl } from "@/lib/supabase/artworks";

function avatarSrc(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.startsWith("http")) return raw;
  return getArtworkImageUrl(raw, "avatar");
}

const FILTER_ORDER: RelationshipDeskFilter[] = [
  "all",
  "access_request",
  "inquiry",
  "grant",
  "follow",
  "note",
];

type Props = {
  /**
   * Caller's resolved auth user id. Required so we know whether to
   * fetch at all (signed-out -> empty render). When the panel is
   * mounted under acting-as, this is still the delegate's `auth.uid()`;
   * the principal id comes from `useActingAs()` and is sent to the RPC
   * via `p_owner_profile_id`.
   */
  userId: string | null;
  authReady: boolean;
};

export function RelationshipDeskPanel({ userId, authReady }: Props) {
  const { t } = useT();
  const { actingAsProfileId, actingAsLabel } = useActingAs();
  const [filter, setFilter] = useState<RelationshipDeskFilter>("all");
  const [rows, setRows] = useState<RelationshipDeskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openProfileId, setOpenProfileId] = useState<string | null>(null);
  const [card, setCard] = useState<RelationshipCard | null>(null);
  const [cardLoading, setCardLoading] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteSavedTick, setNoteSavedTick] = useState(0);
  const [noteSavedAt, setNoteSavedAt] = useState<number | null>(null);
  useEffect(() => {
    if (noteSavedTick === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNoteSavedAt(Date.now());
  }, [noteSavedTick]);

  const effectiveOwnerProfileId = actingAsProfileId ?? userId;

  const reload = useCallback(async () => {
    if (!effectiveOwnerProfileId) return;
    setLoading(true);
    const { data, error: err } = await getRelationshipDeskForOwner({
      ownerProfileId: effectiveOwnerProfileId,
      filter,
    });
    setLoading(false);
    if (err) {
      setError(t("relationships.loadFailed"));
      setRows([]);
      return;
    }
    setError(null);
    setRows(data);
    logBetaEventSync("relationship_desk_viewed", {
      surface: "relationship_desk",
      action_kind: filter,
      acting_as: !!actingAsProfileId,
    });
  }, [filter, t, effectiveOwnerProfileId, actingAsProfileId]);

  useEffect(() => {
    if (!authReady) return;
    if (!effectiveOwnerProfileId) return;
    const handle = requestAnimationFrame(() => {
      void reload();
    });
    return () => cancelAnimationFrame(handle);
  }, [authReady, effectiveOwnerProfileId, reload]);

  const openCard = useCallback(
    async (profileId: string) => {
      setOpenProfileId(profileId);
      setCard(null);
      setCardLoading(true);
      setNoteSavedAt(null);
      const { data, error: err } = await getRelationshipCardForOwner(
        effectiveOwnerProfileId,
        profileId
      );
      setCardLoading(false);
      if (err || !data) {
        setError(t("relationships.cardLoadFailed"));
        return;
      }
      setCard(data);
      setNoteDraft(data.private_note?.note ?? "");
      logBetaEventSync("relationship_card_opened", {
        surface: "relationship_desk",
        relationship_status: data.relationship_status,
        acting_as: !!actingAsProfileId,
      });
    },
    [t, effectiveOwnerProfileId, actingAsProfileId]
  );

  const closeCard = useCallback(() => {
    setOpenProfileId(null);
    setCard(null);
    setNoteDraft("");
    setNoteSavedAt(null);
  }, []);

  const handleSaveNote = useCallback(async () => {
    if (!card?.profile.id) return;
    setNoteSaving(true);
    const { data, error: err } = await upsertRelationshipPrivateNote({
      ownerProfileId: effectiveOwnerProfileId,
      targetProfileId: card.profile.id,
      note: noteDraft,
    });
    setNoteSaving(false);
    if (err || !data) {
      setError(t("relationships.note.saveFailed"));
      return;
    }
    logBetaEventSync("relationship_private_note_saved", {
      surface: "relationship_card",
      action_kind: "save",
      acting_as: !!actingAsProfileId,
    });
    setNoteSavedTick((tick) => tick + 1);
    void reload();
  }, [card, noteDraft, reload, t, effectiveOwnerProfileId, actingAsProfileId]);

  const laneOptions = useMemo<LaneOption<RelationshipDeskFilter>[]>(
    () =>
      FILTER_ORDER.map((id) => ({
        id,
        label: t(`relationships.filter.${id}`),
      })),
    [t]
  );

  if (authReady && !userId) {
    return (
      <EmptyState
        title={t("relationships.signInRequired.title")}
        description={t("relationships.signInRequired.desc")}
        action={{ label: t("nav.login"), href: "/login" }}
      />
    );
  }

  return (
    <div data-tour="network-relationships-panel">
      {actingAsProfileId && (
        <div className="mb-4 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
          {t("relationships.actingAsBanner")}
          {actingAsLabel ? (
            <span className="ml-1 font-medium text-zinc-900">{actingAsLabel}</span>
          ) : null}
        </div>
      )}

      <div className="mb-6">
        <LaneChips
          options={laneOptions}
          active={filter}
          onChange={(id) => setFilter(id)}
          variant="lane"
          ariaLabel={t("relationships.filter.aria")}
        />
      </div>

      {loading ? (
        <p className="py-12 text-center text-sm text-zinc-500">
          {t("common.loading")}
        </p>
      ) : error ? (
        <p className="py-8 text-center text-sm text-red-600">{error}</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title={t("relationships.empty.title")}
          description={t("relationships.empty.desc")}
        />
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200 bg-white">
          {rows.map((row) => (
            <li key={row.profile_id} className="px-4 py-4">
              <DeskRowItem
                row={row}
                onOpen={() => openCard(row.profile_id)}
              />
            </li>
          ))}
        </ul>
      )}

      {openProfileId && (
        <CardDrawer onClose={closeCard}>
          {cardLoading || !card ? (
            <p className="py-8 text-center text-sm text-zinc-500">
              {t("common.loading")}
            </p>
          ) : (
            <CardBodyWithClock
              card={card}
              noteDraft={noteDraft}
              onNoteChange={setNoteDraft}
              onSaveNote={handleSaveNote}
              noteSaving={noteSaving}
              noteSavedAt={noteSavedAt}
            />
          )}
        </CardDrawer>
      )}
    </div>
  );
}

function DeskRowItem({
  row,
  onOpen,
}: {
  row: RelationshipDeskRow;
  onOpen: () => void;
}) {
  const { t } = useT();
  const name = row.display_name || row.username || "—";
  const avatar = avatarSrc(row.avatar_url);
  const statusLabel = relationshipStatusLabel(row.relationship_status, t);
  const lastActivity = row.last_activity_at
    ? new Date(row.last_activity_at).toLocaleDateString()
    : null;
  const lastActivityLabel = row.last_activity_type
    ? t(`relationships.activity.${row.last_activity_type}`)
    : null;
  const subjectTitle =
    row.last_subject_title && row.last_subject_title !== "*"
      ? row.last_subject_title
      : null;

  const counts: string[] = [];
  if (row.pending_access_request_count > 0)
    counts.push(
      `${row.pending_access_request_count} ${t("relationships.count.pendingAccess")}`
    );
  if (row.open_inquiry_count > 0)
    counts.push(
      `${row.open_inquiry_count} ${t("relationships.count.openInquiry")}`
    );
  if (row.active_grant_count > 0)
    counts.push(
      `${row.active_grant_count} ${t("relationships.count.activeGrant")}`
    );

  return (
    <div className="flex items-start gap-3">
      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-zinc-100">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatar}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-zinc-400">
            {name.slice(0, 1).toUpperCase()}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-zinc-900">{name}</p>
        <p className="mt-0.5 truncate text-xs text-zinc-500">
          {[row.role_label, statusLabel].filter(Boolean).join(" · ")}
        </p>
        {(lastActivityLabel || subjectTitle) && (
          <p className="mt-1 truncate text-xs text-zinc-600">
            {[
              lastActivityLabel,
              subjectTitle ? `"${subjectTitle}"` : null,
              lastActivity,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
        {counts.length > 0 && (
          <p className="mt-1 truncate text-xs text-zinc-500">
            {counts.join(" · ")}
          </p>
        )}
        {row.has_private_note && (
          <p className="mt-1 inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">
            {t("relationships.privateNoteChip")}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="shrink-0 rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
      >
        {t("relationships.openCard")}
      </button>
    </div>
  );
}

function relationshipStatusLabel(
  status: RelationshipStatus,
  t: ReturnType<typeof useT>["t"]
): string {
  return t(`relationships.status.${status}`);
}

function CardDrawer({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  const { t } = useT();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex">
      <button
        type="button"
        aria-label={t("common.close")}
        onClick={onClose}
        className="flex-1 bg-zinc-900/30"
      />
      <div className="ml-auto flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-xl sm:w-[28rem]">
        <div className="sticky top-0 flex items-center justify-between border-b border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur">
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
            {t("relationships.card.kicker")}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100"
          >
            {t("common.close")}
          </button>
        </div>
        <div className="flex-1 px-4 py-4">{children}</div>
      </div>
    </div>
  );
}

function CardBodyWithClock(
  props: Omit<Parameters<typeof CardBody>[0], "nowMs">
) {
  const [nowMs, setNowMs] = useState<number>(0);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNowMs(Date.now());
  }, [props.card.profile.id]);
  return <CardBody {...props} nowMs={nowMs} />;
}

function CardBody({
  card,
  noteDraft,
  onNoteChange,
  onSaveNote,
  noteSaving,
  noteSavedAt,
  nowMs,
}: {
  card: RelationshipCard;
  noteDraft: string;
  onNoteChange: (v: string) => void;
  onSaveNote: () => void;
  noteSaving: boolean;
  noteSavedAt: number | null;
  nowMs: number;
}) {
  const { t } = useT();
  const name = card.profile.display_name || card.profile.username || "—";
  const avatar = avatarSrc(card.profile.avatar_url);
  const profileHref = card.profile.username
    ? `/u/${card.profile.username}`
    : null;
  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3">
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-zinc-100">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm text-zinc-400">
              {name.slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>
        <div className="min-w-0">
          {profileHref ? (
            <Link
              href={profileHref}
              className="truncate text-base font-semibold text-zinc-900 hover:underline"
            >
              {name}
            </Link>
          ) : (
            <p className="truncate text-base font-semibold text-zinc-900">
              {name}
            </p>
          )}
          <p className="mt-0.5 text-xs text-zinc-500">
            {[card.profile.main_role, t(`relationships.status.${card.relationship_status}`)]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {card.profile.bio && (
            <p className="mt-2 text-xs text-zinc-600 line-clamp-3">
              {card.profile.bio}
            </p>
          )}
        </div>
      </header>

      {card.requests.length > 0 && (
        <section>
          <SectionHeading label={t("relationships.section.requests")} />
          <ul className="mt-2 space-y-2">
            {card.requests.slice(0, 5).map((r) => (
              <li
                key={r.id}
                className="rounded-md border border-zinc-200 bg-zinc-50/60 px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-zinc-800">
                    {t(`relationships.requestType.${r.request_type}`)}
                  </span>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] uppercase tracking-wide text-zinc-500 ring-1 ring-inset ring-zinc-200">
                    {t(`relationships.requestStatus.${r.status}`)}
                  </span>
                </div>
                {r.subject_title && (
                  <p className="mt-1 truncate text-xs text-zinc-600">
                    &ldquo;{r.subject_title}&rdquo;
                  </p>
                )}
                {r.status === "pending" && (
                  <Link
                    href="/my/network?tab=requests"
                    className="mt-1 inline-block text-xs text-zinc-700 underline-offset-2 hover:underline"
                    onClick={() =>
                      logBetaEventSync("relationship_next_action_clicked", {
                        surface: "relationship_card",
                        action_kind: "review_request",
                      })
                    }
                  >
                    {t("relationships.action.reviewRequest")}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {card.grants.length > 0 && (
        <section>
          <SectionHeading label={t("relationships.section.grants")} />
          <ul className="mt-2 space-y-1.5 text-sm">
            {card.grants.slice(0, 5).map((g) => {
              const subject = g.subject_title
                ? `"${g.subject_title}"`
                : t(`relationships.subjectType.${g.subject_type}`);
              const fieldLabel =
                g.field_key && g.field_key !== "*"
                  ? t(`visibility.field.${g.field_key}`)
                  : t("relationships.fieldAll");
              const expiry = g.expires_at
                ? new Date(g.expires_at)
                : null;
              const expired = expiry ? expiry.getTime() < nowMs : false;
              return (
                <li
                  key={g.id}
                  className="flex items-center justify-between gap-2 text-zinc-700"
                >
                  <span className="truncate">
                    {fieldLabel} · {subject}
                  </span>
                  <span className="shrink-0 text-xs text-zinc-500">
                    {expired
                      ? t("relationships.grant.expired")
                      : expiry
                        ? `${t("relationships.grant.expiresOn")} ${expiry.toLocaleDateString()}`
                        : t("relationships.grant.noExpiry")}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {card.inquiries.length > 0 && (
        <section>
          <SectionHeading label={t("relationships.section.inquiries")} />
          <ul className="mt-2 space-y-1.5 text-sm">
            {card.inquiries.slice(0, 5).map((i) => (
              <li
                key={i.id}
                className="flex items-center justify-between gap-2 text-zinc-700"
              >
                <Link
                  href={`/artwork/${i.artwork_id}`}
                  className="truncate hover:underline"
                >
                  {i.subject_title ?? t("relationships.inquiry.untitled")}
                </Link>
                <span className="shrink-0 text-xs text-zinc-500">
                  {t(`relationships.inquiryStatus.${i.inquiry_status}`)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {card.rooms.length > 0 && (
        <section>
          <SectionHeading label={t("relationships.section.rooms")} />
          <ul className="mt-2 space-y-1.5 text-sm">
            {card.rooms.slice(0, 5).map((room) => (
              <li
                key={room.room_id}
                className="flex items-center justify-between gap-2 text-zinc-700"
              >
                <Link
                  href={`/my/shortlists/${room.room_id}`}
                  className="truncate hover:underline"
                >
                  {room.title}
                </Link>
                <span className="shrink-0 text-xs text-zinc-500">
                  {room.has_active_grant
                    ? t("relationships.room.approved")
                    : t("relationships.room.shared")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section data-tour="network-relationships-private-note">
        <SectionHeading label={t("relationships.section.privateNote")} />
        <FloorPanel as="div" padding="sm" className="mt-2 space-y-2">
          <p className="text-xs text-zinc-500">
            {t("relationships.note.helper")}
          </p>
          <textarea
            value={noteDraft}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder={t("relationships.note.placeholder")}
            rows={4}
            className="w-full rounded border border-zinc-200 px-3 py-2 text-sm text-zinc-800"
            maxLength={4000}
          />
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-400">
              {noteDraft.length}/4000
              {noteSavedAt && (
                <>
                  {" · "}
                  {t("relationships.note.savedAt")}{" "}
                  {new Date(noteSavedAt).toLocaleTimeString()}
                </>
              )}
            </span>
            <button
              type="button"
              onClick={onSaveNote}
              disabled={noteSaving}
              className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
            >
              {noteSaving ? t("common.loading") : t("relationships.note.save")}
            </button>
          </div>
        </FloorPanel>
      </section>

      <SuggestedNextAction card={card} />
    </div>
  );
}

function SectionHeading({ label }: { label: string }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500">
      {label}
    </p>
  );
}

function SuggestedNextAction({ card }: { card: RelationshipCard }) {
  const { t } = useT();
  const pendingRequest = card.requests.find((r) => r.status === "pending");
  const openInquiry = card.inquiries.find(
    (i) => i.inquiry_status !== "closed"
  );
  if (pendingRequest) {
    return (
      <Link
        href="/my/network?tab=requests"
        className="block rounded-xl bg-zinc-900 px-4 py-3 text-center text-sm font-medium text-white hover:bg-zinc-800"
        onClick={() =>
          logBetaEventSync("relationship_next_action_clicked", {
            surface: "relationship_card",
            action_kind: "reply_to_request",
          })
        }
      >
        {t("relationships.suggested.reviewRequest")}
      </Link>
    );
  }
  if (openInquiry) {
    return (
      <Link
        href={`/artwork/${openInquiry.artwork_id}`}
        className="block rounded-xl bg-zinc-900 px-4 py-3 text-center text-sm font-medium text-white hover:bg-zinc-800"
        onClick={() =>
          logBetaEventSync("relationship_next_action_clicked", {
            surface: "relationship_card",
            action_kind: "reply_to_inquiry",
          })
        }
      >
        {t("relationships.suggested.replyInquiry")}
      </Link>
    );
  }
  return (
    <Link
      href="/my/shortlists"
      className="block rounded-xl border border-zinc-300 bg-white px-4 py-3 text-center text-sm font-medium text-zinc-700 hover:bg-zinc-100"
      onClick={() =>
        logBetaEventSync("relationship_next_action_clicked", {
          surface: "relationship_card",
          action_kind: "share_room",
        })
      }
    >
      {t("relationships.suggested.shareRoom")}
    </Link>
  );
}
