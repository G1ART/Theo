"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useParams } from "next/navigation";
import { getArtworkBack } from "@/lib/artworkBack";
import { getArtworkArtistLabel, getArtworkPriceDisplay } from "@/lib/supabase/artworks";
import { getSession } from "@/lib/supabase/auth";
import {
  type ArtworkWithLikes,
  canDeleteArtwork,
  canEditArtwork,
  canViewProvenance,
  deleteArtworkCascade,
  getArtworkById,
  getMyClaim,
  getProvenanceClaims,
  recordArtworkView,
} from "@/lib/supabase/artworks";
import { isLiked } from "@/lib/supabase/likes";
import { isFollowing } from "@/lib/supabase/follows";
import { FollowButton } from "@/components/FollowButton";
import { LikeButton } from "@/components/LikeButton";
import { ArtworkProvenanceBlock } from "@/components/ArtworkProvenanceBlock";
import {
  claimTypeToByPhrase,
  createClaimRequest,
  confirmClaim,
  rejectClaim,
  listPendingClaimsForWork,
  type PendingClaimRow,
} from "@/lib/provenance/rpc";
import type { ClaimType } from "@/lib/provenance/types";
import {
  createPriceInquiry,
  getMyInquiryForArtwork,
  listPriceInquiriesForArtwork,
  listPriceInquiryMessages,
  appendPriceInquiryMessage,
  replyToPriceInquiry,
  resendPriceInquiryNotification,
  canReplyToPriceInquiry,
  type PriceInquiryRow,
  type PriceInquiryMessageRow,
} from "@/lib/supabase/priceInquiries";
import { getExhibitionHostCuratorLabel, type ExhibitionWithCredits } from "@/lib/exhibitionCredits";
import { listMyDelegations } from "@/lib/supabase/delegations";
import { listExhibitionsForWork } from "@/lib/supabase/exhibitions";
import { logSupabaseError } from "@/lib/supabase/errors";
import { formatSupabaseError } from "@/lib/errors/supabase";
import { useT } from "@/lib/i18n/useT";
import { logFeedEvent, peekFeedSource } from "@/lib/feed/telemetry";
import { peekRoomSource, setRoomSource } from "@/lib/room/source";
import { getRoomByToken } from "@/lib/supabase/shortlists";
import type { InquirySource } from "@/lib/supabase/priceInquiries";
import { ownershipStatusLabel } from "@/lib/artworks/labels";
import { formatSizeForLocale } from "@/lib/size/format";
import { SaveToShortlistModal } from "@/components/SaveToShortlistModal";
import { formatIdentityPair, formatRoleChips } from "@/lib/identity/format";
import { InquiryReplyAssist } from "@/components/ai/InquiryReplyAssist";
import { ConfirmActionDialog } from "@/components/ds/ConfirmActionDialog";
import { markAiAccepted } from "@/lib/ai/accept";
import { useActingAs } from "@/context/ActingAsContext";
import { ArtworkPassportHeader } from "@/components/artwork/ArtworkPassportHeader";
import { ArtworkImageStage } from "@/components/artwork/ArtworkImageStage";
import { GatedField } from "@/components/visibility/GatedField";
import {
  getViewerRelationshipContext,
  resolveVisibilityForViewer,
} from "@/lib/supabase/relationshipAccess";
import type {
  ViewerRelationshipContext,
  VisibilityResolution,
} from "@/lib/visibility/types";


function ArtworkDetailContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, locale } = useT();
  const id = typeof params.id === "string" ? params.id : "";
  const fromRoom = searchParams.get("fromRoom");
  const { actingAsProfileId } = useActingAs();
  const [artwork, setArtwork] = useState<ArtworkWithLikes | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [liked, setLiked] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showProvenanceHistory, setShowProvenanceHistory] = useState(false);
  const [requestingClaim, setRequestingClaim] = useState<ClaimType | null>(null);
  /** When set, user is choosing period before sending CURATED/EXHIBITED request. */
  const [claimTypeToRequest, setClaimTypeToRequest] = useState<ClaimType | null>(null);
  const [requestPeriodStatus, setRequestPeriodStatus] = useState<"past" | "current" | "future">("current");
  const [pendingClaims, setPendingClaims] = useState<PendingClaimRow[]>([]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  /** When set, artist is editing period before confirming a CURATED/EXHIBITED claim. */
  const [confirmingClaimId, setConfirmingClaimId] = useState<string | null>(null);
  const [confirmPeriodStatus, setConfirmPeriodStatus] = useState<"past" | "current" | "future">("current");
  const [claimDropdownOpen, setClaimDropdownOpen] = useState(false);
  const [fullSizeOpen, setFullSizeOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [myPriceInquiry, setMyPriceInquiry] = useState<PriceInquiryRow | null>(null);
  const [priceInquiryLoading, setPriceInquiryLoading] = useState(false);
  const [priceInquirySubmitting, setPriceInquirySubmitting] = useState(false);
  const [priceInquiryMessage, setPriceInquiryMessage] = useState("");
  const [showInquiryForm, setShowInquiryForm] = useState(false);
  const [artistInquiries, setArtistInquiries] = useState<PriceInquiryRow[]>([]);
  const [artistInquiriesLoading, setArtistInquiriesLoading] = useState(false);
  const [canReplyToInquiriesFromBackend, setCanReplyToInquiriesFromBackend] = useState<boolean | null>(null);
  const [replyingInquiryId, setReplyingInquiryId] = useState<string | null>(null);
  const [resendingNotificationInquiryId, setResendingNotificationInquiryId] = useState<string | null>(null);
  const [artistReplyText, setArtistReplyText] = useState<Record<string, string>>({});
  const [artistReplyAiEventId, setArtistReplyAiEventId] = useState<Record<string, string>>({});
  const [myInquiryMessages, setMyInquiryMessages] = useState<PriceInquiryMessageRow[]>([]);
  const [inquirerReplyText, setInquirerReplyText] = useState("");
  const [inquirerReplying, setInquirerReplying] = useState(false);
  const [artistInquiryMessages, setArtistInquiryMessages] = useState<Record<string, PriceInquiryMessageRow[]>>({});
  const [exhibitionsForWork, setExhibitionsForWork] = useState<ExhibitionWithCredits[]>([]);
  const [delegatedProjectIds, setDelegatedProjectIds] = useState<Set<string>>(new Set());
  const [shortlistOpen, setShortlistOpen] = useState(false);
  // Sprint 5 — viewer-side relationship/visibility state. The page calls
  // resolve_visibility_for_viewer for each first-class field after the
  // artwork loads; client never assembles `requiredAudience` itself.
  const [viewerRelationship, setViewerRelationship] =
    useState<ViewerRelationshipContext | null>(null);
  const [priceResolution, setPriceResolution] =
    useState<VisibilityResolution | null>(null);
  const [availabilityResolution, setAvailabilityResolution] =
    useState<VisibilityResolution | null>(null);
  const [descriptionResolution, setDescriptionResolution] =
    useState<VisibilityResolution | null>(null);
  const claimDropdownRef = useRef<HTMLDivElement>(null);
  const VIEW_TTL_MS = 10 * 60 * 1000; // 10 minutes

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    setIsDesktop(mq.matches);
    const fn = () => setIsDesktop(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);

  useEffect(() => {
    if (!fullSizeOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setFullSizeOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [fullSizeOpen]);

  // Effective identity merges the operator's session uid with the
  // optional acting-as principal so that delegated edit/claim actions
  // surface the principal's perspective. Order: principal first → wins
  // priority searches in `getMyClaim`.
  const effectiveIds = useMemo<string[]>(() => {
    const out: string[] = [];
    if (actingAsProfileId) out.push(actingAsProfileId);
    if (userId && !out.includes(userId)) out.push(userId);
    return out;
  }, [actingAsProfileId, userId]);
  const isOwner = Boolean(
    artwork && effectiveIds.length > 0 && effectiveIds.includes(artwork.artist_id)
  );
  const canEdit = Boolean(artwork && canEditArtwork(artwork, effectiveIds));
  const canDelete = Boolean(artwork && canDeleteArtwork(artwork, effectiveIds));
  const myClaim = artwork ? getMyClaim(artwork, effectiveIds) : null;
  const myClaimsByType =
    artwork?.claims?.filter((c) => effectiveIds.includes(c.subject_profile_id)) ?? [];
  const hasPendingRequest = myClaim?.status === "pending";
  const hasOwnsClaim = myClaimsByType.some((c) => c.claim_type === "OWNS");
  const canRequestClaim = Boolean(effectiveIds.length > 0 && artwork && !isOwner);
  const provenanceClaims = artwork ? getProvenanceClaims(artwork) : [];
  const hasProvenanceHistory = provenanceClaims.length > 1;
  // canViewProvenance still uses the session uid (provenance visibility
  // gate is owner-or-public; delegate access for principal data already
  // flows through RLS).
  const showProvenance = artwork && canViewProvenance(artwork, userId);

  async function handleDelete() {
    if (!id || !canDelete) return;
    setDeleting(true);
    const { error: err } = await deleteArtworkCascade(id);
    setDeleting(false);
    setShowDeleteConfirm(false);
    if (err) {
      logSupabaseError("deleteArtwork", err);
      setError(formatSupabaseError(err, t, "errors.failedDelete"));
      return;
    }
    router.push("/my");
  }

  const recordView = useCallback(async () => {
    if (!id || typeof window === "undefined") return;
    const key = `viewed_artwork_${id}`;
    const raw = localStorage.getItem(key);
    if (raw) {
      const ts = parseInt(raw, 10);
      if (!isNaN(ts) && Date.now() - ts < VIEW_TTL_MS) return;
    }
    await recordArtworkView(id);
    localStorage.setItem(key, Date.now().toString());
  }, [id]);

  useEffect(() => {
    if (!id) return;
    getArtworkById(id).then(({ data, error: err }) => {
      setLoading(false);
      if (err) {
        const msg =
          (err as { message?: string })?.message ??
          (err as { error?: { message?: string } })?.error?.message ??
          (typeof err === "string" ? err : JSON.stringify(err));
        setError(msg);
        return;
      }
      setArtwork(data as ArtworkWithLikes | null);
    });
  }, [id]);

  useEffect(() => {
    if (!id) return;
    listExhibitionsForWork(id).then(({ data }) => setExhibitionsForWork(data ?? []));
  }, [id]);

  // Sprint 3 §4.3 — when the user arrives via `?fromRoom=token`, resolve
  // the share-token to the underlying shortlist UUID and stash the
  // *resolved id* (not the token) as a session-scoped breadcrumb. The
  // breadcrumb later flows into inquiry source attribution; the token
  // itself stays in the URL only and never enters long-lived analytics
  // rows. Failure to resolve is silently fine — attribution simply
  // degrades to "no room context".
  const [resolvedRoomId, setResolvedRoomId] = useState<string | null>(null);
  useEffect(() => {
    if (!fromRoom || !id) return;
    let cancelled = false;
    void getRoomByToken(fromRoom).then(({ data }) => {
      if (cancelled || !data?.id) return;
      setResolvedRoomId(data.id);
      setRoomSource({ room_id: data.id, artwork_id: id });
    });
    return () => {
      cancelled = true;
    };
  }, [fromRoom, id]);

  useEffect(() => {
    getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null);
    });
  }, []);

  useEffect(() => {
    if (!userId) return;
    listMyDelegations().then(({ data }) => {
      const ids = new Set<string>();
      for (const d of data?.received ?? []) {
        if (d.scope_type === "project" && d.status === "active" && d.project_id) ids.add(d.project_id);
      }
      setDelegatedProjectIds(ids);
    });
  }, [userId]);

  useEffect(() => {
    if (artwork?.artist_id && userId && userId !== artwork.artist_id) {
      isFollowing(artwork.artist_id).then(({ data }) => setFollowing(data ?? false));
    }
  }, [artwork?.artist_id, userId]);

  useEffect(() => {
    if (id && userId) {
      isLiked(id).then(setLiked);
    }
  }, [id, userId]);

  useEffect(() => {
    if (artwork && userId) {
      recordView();
    }
  }, [artwork, userId, recordView]);

  useEffect(() => {
    if (!id || !isOwner) return;
    listPendingClaimsForWork(id).then(({ data }) => setPendingClaims(data ?? []));
  }, [id, isOwner]);

  useEffect(() => {
    if (!claimDropdownOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (claimDropdownRef.current && !claimDropdownRef.current.contains(e.target as Node)) {
        setClaimDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [claimDropdownOpen]);

  const showPriceInquiryBlock =
    Boolean(userId && artwork && userId !== artwork.artist_id) &&
    (artwork?.pricing_mode === "inquire" || artwork?.is_price_public === false);

  const showArtistInquiryBlock =
    Boolean(userId && artwork && (artwork.pricing_mode === "inquire" || artwork.is_price_public === false)) &&
    canReplyToInquiriesFromBackend === true;

  /** True once the artist (or delegate) has sent any reply — inquirer must not see artist-only reply UI before this. */
  const artistHasRepliedToMyInquiry = useMemo(() => {
    if (!myPriceInquiry || !userId) return false;
    if (myPriceInquiry.inquirer_id !== userId) return false;
    if ((myPriceInquiry.artist_reply ?? "").trim().length > 0) return true;
    if (myPriceInquiry.replied_at) return true;
    return myInquiryMessages.some((m) => m.sender_id !== userId);
  }, [myPriceInquiry, userId, myInquiryMessages]);

  useEffect(() => {
    if (!id || !showPriceInquiryBlock) return;
    setPriceInquiryLoading(true);
    getMyInquiryForArtwork(id).then(({ data }) => {
      setMyPriceInquiry(data ?? null);
      setPriceInquiryLoading(false);
    });
  }, [id, showPriceInquiryBlock]);

  useEffect(() => {
    if (!id || !userId || !artwork) return;
    if (artwork.pricing_mode !== "inquire" && artwork.is_price_public !== false) {
      setCanReplyToInquiriesFromBackend(false);
      return;
    }
    canReplyToPriceInquiry(id).then(({ data, error }) => {
      if (error) setCanReplyToInquiriesFromBackend(false);
      else setCanReplyToInquiriesFromBackend(!!data);
    });
  }, [id, userId, artwork?.id, artwork?.pricing_mode, artwork?.is_price_public]);

  useEffect(() => {
    if (!myPriceInquiry?.id) {
      requestAnimationFrame(() => setMyInquiryMessages([]));
      return;
    }
    listPriceInquiryMessages(myPriceInquiry.id).then(({ data }) => setMyInquiryMessages(data ?? []));
  }, [myPriceInquiry?.id]);

  useEffect(() => {
    if (!id || !showArtistInquiryBlock) return;
    const t = requestAnimationFrame(() => {
      setArtistInquiriesLoading(true);
      listPriceInquiriesForArtwork(id).then(({ data: rows }) => {
        setArtistInquiries(rows ?? []);
        setArtistInquiriesLoading(false);
        for (const row of rows ?? []) {
          listPriceInquiryMessages(row.id).then(({ data: msgs }) => {
            if (msgs) setArtistInquiryMessages((prev) => ({ ...prev, [row.id]: msgs }));
          });
        }
      });
    });
    return () => cancelAnimationFrame(t);
  }, [id, showArtistInquiryBlock]);

  // Sprint 5 — Resolve viewer-side visibility for the price/availability/
  // description fields. Each call goes server-side; the client never builds
  // a `requiredAudience` itself. If the artwork or owner is missing, we
  // skip and let the page render in its existing form (back-compat).
  useEffect(() => {
    if (!artwork?.id || !artwork.artist_id) return;
    let cancelled = false;
    const owner = artwork.artist_id;
    const subjectId = artwork.id;
    (async () => {
      const [ctxRes, priceRes, availRes, descRes] = await Promise.all([
        getViewerRelationshipContext(owner),
        resolveVisibilityForViewer({
          ownerProfileId: owner,
          subjectType: "artwork",
          subjectId,
          fieldKey: "price",
        }),
        resolveVisibilityForViewer({
          ownerProfileId: owner,
          subjectType: "artwork",
          subjectId,
          fieldKey: "availability",
        }),
        resolveVisibilityForViewer({
          ownerProfileId: owner,
          subjectType: "artwork",
          subjectId,
          fieldKey: "description",
        }),
      ]);
      if (cancelled) return;
      if (ctxRes.data) setViewerRelationship(ctxRes.data);
      if (priceRes.data) setPriceResolution(priceRes.data);
      if (availRes.data) setAvailabilityResolution(availRes.data);
      if (descRes.data) setDescriptionResolution(descRes.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [artwork?.id, artwork?.artist_id]);

  /**
   * Decide where this inquiry was attributed from. Priority (most
   * specific → least): explicit `?fromRoom=` resolved → live `roomSource`
   * breadcrumb (e.g. clicked from a room earlier in the same session) →
   * live `feedSource` breadcrumb → fallback `artwork`. Privacy: the
   * room TOKEN is *never* forwarded to inquiry attribution; only the
   * resolved `roomId` is.
   */
  function buildInquirySource(): InquirySource {
    const room = resolvedRoomId ? { room_id: resolvedRoomId, artwork_id: id, ts: Date.now() } : peekRoomSource();
    if (room?.room_id) {
      return {
        surface: "room",
        roomId: room.room_id,
        artworkId: id,
      };
    }
    const feed = peekFeedSource();
    if (feed && feed.item_kind === "artwork" && feed.item_id === id) {
      return {
        surface: "feed",
        artworkId: id,
        feedItemKey: `art-${feed.item_id}`,
        payload: {
          tab: feed.tab,
          sort: feed.sort ?? null,
          position: feed.position,
        },
      };
    }
    return {
      surface: "artwork",
      artworkId: id,
    };
  }

  async function handleAskPrice() {
    if (!id || !artwork || priceInquirySubmitting) return;
    setPriceInquirySubmitting(true);
    const source = buildInquirySource();
    const { data, error } = await createPriceInquiry(
      id,
      priceInquiryMessage || undefined,
      source
    );
    setPriceInquirySubmitting(false);
    setShowInquiryForm(false);
    setPriceInquiryMessage("");
    if (error) {
      logSupabaseError("createPriceInquiry", error);
      setError(formatSupabaseError(error, t, "errors.failedSendInquiry"));
      return;
    }
    const { data: inquiry } = await getMyInquiryForArtwork(id);
    setMyPriceInquiry(inquiry ?? null);
    if (inquiry?.id) {
      const { data: msgs } = await listPriceInquiryMessages(inquiry.id);
      setMyInquiryMessages(msgs ?? []);
    }
  }

  async function handleInquirerFollowUp() {
    if (!myPriceInquiry?.id || inquirerReplying) return;
    const text = inquirerReplyText.trim();
    if (!text) return;
    setInquirerReplying(true);
    const { error: err } = await appendPriceInquiryMessage(myPriceInquiry.id, text);
    setInquirerReplying(false);
    if (err) {
      logSupabaseError("appendPriceInquiryMessage", err);
      setError(formatSupabaseError(err, t, "errors.failedSendMessage"));
      return;
    }
    setInquirerReplyText("");
    const { data: msgs } = await listPriceInquiryMessages(myPriceInquiry.id);
    setMyInquiryMessages(msgs ?? []);
  }

  async function handleResendNotification(inquiryId: string) {
    setResendingNotificationInquiryId(inquiryId);
    const { data, error } = await resendPriceInquiryNotification(inquiryId);
    setResendingNotificationInquiryId(null);
    if (error) {
      logSupabaseError("resendPriceInquiryNotification", error);
      setError(formatSupabaseError(error, t, "priceInquiry.resendFailed"));
      return;
    }
    if (data > 0) {
      setError(null);
      setSuccessMessage(t("priceInquiry.resendSuccess"));
      setTimeout(() => setSuccessMessage(null), 4000);
    }
  }

  async function handleArtistReply(inquiryId: string) {
    const text = artistReplyText[inquiryId]?.trim();
    if (!text) return;
    const adoptedAiEventId = artistReplyAiEventId[inquiryId] ?? null;
    setReplyingInquiryId(inquiryId);
    const { error: err } = await replyToPriceInquiry(inquiryId, text);
    setReplyingInquiryId(null);
    if (err) {
      logSupabaseError("replyToPriceInquiry", err);
      setError(formatSupabaseError(err, t, "errors.failedSendReply"));
      return;
    }
    if (adoptedAiEventId) {
      markAiAccepted(adoptedAiEventId, {
        feature: "inquiry_reply_draft",
        via: "send",
      });
    }
    setArtistReplyText((prev) => {
      const next = { ...prev };
      delete next[inquiryId];
      return next;
    });
    setArtistReplyAiEventId((prev) => {
      const next = { ...prev };
      delete next[inquiryId];
      return next;
    });
    const [{ data }, { data: msgs }] = await Promise.all([
      listPriceInquiriesForArtwork(id),
      listPriceInquiryMessages(inquiryId),
    ]);
    setArtistInquiries(data ?? []);
    if (msgs) setArtistInquiryMessages((prev) => ({ ...prev, [inquiryId]: msgs }));
  }

  /** One-click for OWNS; for CURATED/EXHIBITED we show period picker (claimTypeToRequest) first. */
  function handleRequestClaimClick(claimType: ClaimType) {
    if (claimType === "OWNS") {
      handleRequestClaim(claimType);
      return;
    }
    if (claimType === "CURATED" || claimType === "EXHIBITED") {
      setClaimTypeToRequest(claimType);
      setRequestPeriodStatus("current");
      setClaimDropdownOpen(false);
    }
  }

  async function handleRequestClaim(claimType: ClaimType, periodStatus?: "past" | "current" | "future") {
    if (!id || !artwork?.artist_id || !userId) return;
    setRequestingClaim(claimType);
    const payload: Parameters<typeof createClaimRequest>[0] = {
      workId: id,
      claimType,
      artistProfileId: artwork.artist_id,
      // Acting-as: file the request on behalf of the principal so the
      // pending claim attaches to *their* profile, not the operator's.
      // RPC validates `is_active_account_delegate_writer` server-side.
      subjectProfileId: actingAsProfileId ?? undefined,
    };
    if (claimType === "CURATED" || claimType === "EXHIBITED") {
      payload.period_status = periodStatus ?? "current";
    }
    const { error } = await createClaimRequest(payload);
    setRequestingClaim(null);
    setClaimTypeToRequest(null);
    setClaimDropdownOpen(false);
    if (error) {
      logSupabaseError("createClaimRequest", error);
      setError(formatSupabaseError(error, t, "errors.failedRequestClaim"));
      return;
    }
    const { data: refreshed } = await getArtworkById(id);
    setArtwork(refreshed as ArtworkWithLikes | null);
  }

  async function handleConfirm(
    claimId: string,
    payload?: { period_status?: "past" | "current" | "future"; start_date?: string | null; end_date?: string | null }
  ) {
    setConfirmingId(claimId);
    const { error } = await confirmClaim(claimId, payload);
    setConfirmingId(null);
    setConfirmingClaimId(null);
    if (error) {
      logSupabaseError("confirmClaim", error);
      setError(formatSupabaseError(error, t, "errors.failedConfirmClaim"));
      return;
    }
    setPendingClaims((prev) => prev.filter((c) => c.id !== claimId));
    if (id) {
      const { data } = await getArtworkById(id);
      setArtwork(data as ArtworkWithLikes | null);
    }
  }

  /** Open period form for CURATED/EXHIBITED; for OWNS confirm immediately. */
  function handleApproveClick(row: PendingClaimRow) {
    if (row.claim_type === "OWNS") {
      handleConfirm(row.id);
      return;
    }
    if (row.claim_type === "CURATED" || row.claim_type === "EXHIBITED") {
      setConfirmingClaimId(row.id);
      setConfirmPeriodStatus((row.period_status ?? "current") as "past" | "current" | "future");
    }
  }

  async function handleReject(claimId: string) {
    setConfirmingId(claimId);
    const { error } = await rejectClaim(claimId);
    setConfirmingId(null);
    if (error) {
      logSupabaseError("rejectClaim", error);
      setError(formatSupabaseError(error, t, "errors.failedRejectClaim"));
      return;
    }
    setPendingClaims((prev) => prev.filter((c) => c.id !== claimId));
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <p className="text-sm text-zinc-500">{t("common.loading")}</p>
      </div>
    );
  }

  if (error || !artwork) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-zinc-700">{error ? String(error) : t("artwork.notFound")}</p>
      </div>
    );
  }

  const images = artwork.artwork_images ?? [];
  const sortedImages = [...images].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  );
  const artist = artwork.profiles;
  const { label: artistLabel, profileUsername } = getArtworkArtistLabel(artwork);
  const username = profileUsername ?? "";

  const { path: backPath, labelKey: backLabelKey } = getArtworkBack();
  const sizeDisplay =
    artwork.size != null
      ? formatSizeForLocale(artwork.size, locale, artwork.size_unit ?? undefined)
      : null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <ArtworkPassportHeader
        fromRoom={fromRoom}
        backPath={backPath}
        backLabelKey={backLabelKey}
      />

      <div className="space-y-6">
        <div className="grid gap-6 sm:grid-cols-2">
          <ArtworkImageStage
            sortedImages={sortedImages}
            title={artwork.title}
            isDesktop={isDesktop}
            fullSizeOpen={fullSizeOpen}
            onOpenFullSize={() => setFullSizeOpen(true)}
            onCloseFullSize={() => setFullSizeOpen(false)}
          />

          <div>
            <h1 className="text-xl font-semibold text-zinc-900">
              {artwork.title ?? t("common.untitled")}
            </h1>
            {(() => {
              const identity = formatIdentityPair(artist ?? null);
              const chips = formatRoleChips(artist ?? null, t, { max: 2 });
              if (!artistLabel && !identity.primary) return null;
              return (
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                  {username ? (
                    <Link
                      href={`/u/${username}`}
                      className="text-sm font-semibold text-zinc-900 hover:underline"
                    >
                      {identity.primary || artistLabel}
                    </Link>
                  ) : (
                    <span className="text-sm font-semibold text-zinc-900">
                      {identity.primary || artistLabel}
                    </span>
                  )}
                  {identity.secondary && (
                    <span className="text-xs text-zinc-500">{identity.secondary}</span>
                  )}
                  {chips.map((chip) => (
                    <span
                      key={chip.key}
                      className={`rounded-full px-1.5 py-0.5 text-[10px] ${chip.isPrimary ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700"}`}
                    >
                      {chip.label}
                    </span>
                  ))}
                  {userId && userId !== artwork.artist_id && username && (
                    <FollowButton
                      targetProfileId={artwork.artist_id}
                      initialFollowing={following}
                      size="sm"
                    />
                  )}
                </div>
              );
            })()}
            <p className="mt-3 text-sm text-zinc-600">
              {[artwork.year, artwork.medium].filter(Boolean).join(" · ")}
            </p>
            {sizeDisplay && (
              <p className="mt-1 text-sm text-zinc-600">{sizeDisplay}</p>
            )}
            {(() => {
              const label = ownershipStatusLabel(artwork.ownership_status, t);
              if (!label) return null;
              const wrapped = (
                <p className="mt-2 font-medium text-zinc-700">{label}</p>
              );
              if (!availabilityResolution || availabilityResolution.canView) {
                return wrapped;
              }
              return (
                <div className="mt-2">
                  <GatedField
                    ownerProfileId={artwork.artist_id}
                    subjectType="artwork"
                    subjectId={artwork.id}
                    fieldKey="availability"
                    resolution={availabilityResolution}
                    viewerRelationship={viewerRelationship}
                    ownerLabel={getArtworkArtistLabel(artwork).label}
                    surface="artwork_passport"
                  >
                    {wrapped}
                  </GatedField>
                </div>
              );
            })()}
            {(() => {
              const wrapped = (
                <p className="mt-2 text-sm text-zinc-600">
                  {getArtworkPriceDisplay(artwork, t)}
                </p>
              );
              if (!priceResolution || priceResolution.canView) {
                return wrapped;
              }
              return (
                <div className="mt-2">
                  <GatedField
                    ownerProfileId={artwork.artist_id}
                    subjectType="artwork"
                    subjectId={artwork.id}
                    fieldKey="price"
                    resolution={priceResolution}
                    viewerRelationship={viewerRelationship}
                    ownerLabel={getArtworkArtistLabel(artwork).label}
                    surface="artwork_passport"
                    onAskAboutWork={() => setShowInquiryForm(true)}
                  >
                    {wrapped}
                  </GatedField>
                </div>
              );
            })()}
            {showPriceInquiryBlock && (
              <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50/70 p-3">
                {priceInquiryLoading ? (
                  <p className="text-sm text-zinc-500">{t("common.loading")}</p>
                ) : myPriceInquiry ? (
                  <div className="text-sm text-zinc-700">
                    {myInquiryMessages.length > 0 ? (
                      <ul className="mb-3 space-y-2">
                        {myInquiryMessages.map((m) => (
                          <li key={m.id} className="rounded bg-zinc-100 px-3 py-2">
                            <span className="text-xs text-zinc-500">{new Date(m.created_at).toLocaleString()}</span>
                            <p className="mt-0.5 whitespace-pre-wrap">{m.body}</p>
                          </li>
                        ))}
                      </ul>
                    ) : myPriceInquiry.message ? (
                      <p className="mb-3 text-zinc-600">{myPriceInquiry.message}</p>
                    ) : (
                      <p className="mb-3 text-zinc-600">{t("priceInquiry.sent")}</p>
                    )}
                    {!myPriceInquiry.artist_reply && myInquiryMessages.length === 0 && (
                      <div className="mb-2">
                        <button
                          type="button"
                          onClick={() => handleResendNotification(myPriceInquiry.id)}
                          disabled={resendingNotificationInquiryId === myPriceInquiry.id}
                          className="text-sm font-medium text-zinc-600 underline hover:text-zinc-800 disabled:opacity-50"
                        >
                          {resendingNotificationInquiryId === myPriceInquiry.id ? "..." : t("priceInquiry.resendNotification")}
                        </button>
                        {successMessage && <p className="mt-1 text-sm text-green-600">{successMessage}</p>}
                      </div>
                    )}
                    {!artistHasRepliedToMyInquiry ? (
                      <p className="mt-2 text-xs text-zinc-500">{t("priceInquiry.waitingForArtistReply")}</p>
                    ) : (
                      <div className="mt-2">
                        <textarea
                          value={inquirerReplyText}
                          onChange={(e) => setInquirerReplyText(e.target.value)}
                          placeholder={t("priceInquiry.followUpToArtistPlaceholder")}
                          rows={2}
                          className="w-full rounded border border-zinc-200 px-3 py-2 text-sm"
                        />
                        <button
                          type="button"
                          disabled={!inquirerReplyText.trim() || inquirerReplying}
                          onClick={handleInquirerFollowUp}
                          className="mt-1 rounded bg-zinc-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-900 disabled:opacity-50"
                        >
                          {inquirerReplying ? "..." : t("priceInquiry.followUpToArtistSend")}
                        </button>
                      </div>
                    )}
                  </div>
                ) : showInquiryForm ? (
                  <div className="space-y-2">
                    <textarea
                      value={priceInquiryMessage}
                      onChange={(e) => setPriceInquiryMessage(e.target.value)}
                      placeholder={t("priceInquiry.messagePlaceholder")}
                      rows={2}
                      className="w-full rounded border border-zinc-200 px-3 py-2 text-sm"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleAskPrice}
                        disabled={priceInquirySubmitting}
                        className="rounded bg-zinc-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-900 disabled:opacity-50"
                      >
                        {priceInquirySubmitting ? "..." : t("priceInquiry.submit")}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowInquiryForm(false); setPriceInquiryMessage(""); }}
                        className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100"
                      >
                        {t("common.cancel")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      // Attribute the click back to feed when the visit
                      // originated there. peek (not consume) so that a
                      // later `inquiry_created` can still consult source
                      // — single click → single feed_item_inquiry_click.
                      const source = peekFeedSource();
                      if (
                        source &&
                        source.item_kind === "artwork" &&
                        source.item_id === id
                      ) {
                        logFeedEvent("feed_item_inquiry_click", {
                          tab: source.tab,
                          sort: source.sort,
                          item_kind: "artwork",
                          item_id: id,
                          position: source.position,
                          stage: "open_form",
                        });
                      }
                      setShowInquiryForm(true);
                    }}
                    className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                  >
                    {t("priceInquiry.ask")}
                  </button>
                )}
              </div>
            )}
            {showArtistInquiryBlock && (
              <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50/70 p-3">
                <p className="mb-2 text-sm font-medium text-zinc-800">{t("priceInquiry.title")}</p>
                {artistInquiriesLoading ? (
                  <p className="text-sm text-zinc-500">{t("common.loading")}</p>
                ) : artistInquiries.length === 0 ? (
                  <p className="text-sm text-zinc-500">{t("priceInquiry.empty")}</p>
                ) : (
                  <ul className="space-y-3">
                    {artistInquiries.map((row) => (
                      <li key={row.id} className="rounded border border-zinc-200 bg-white p-3">
                        <div className="mb-1 flex flex-wrap items-center gap-2 text-sm">
                          {(() => {
                            const pair = formatIdentityPair(row.inquirer);
                            return (
                              <span className="font-medium text-zinc-700">
                                {pair.primary}
                                {pair.secondary && (
                                  <span className="font-normal text-zinc-500"> {pair.secondary}</span>
                                )}
                              </span>
                            );
                          })()}
                          <span className="text-xs text-zinc-400">
                            {new Date(row.created_at).toLocaleString()}
                          </span>
                        </div>
                        {(artistInquiryMessages[row.id]?.length ?? 0) > 0 ? (
                          <ul className="mb-2 space-y-2">
                            {artistInquiryMessages[row.id].map((m) => (
                              <li key={m.id} className="rounded bg-zinc-100 px-3 py-2 text-sm text-zinc-800">
                                <span className="text-xs text-zinc-500">{new Date(m.created_at).toLocaleString()}</span>
                                <p className="mt-0.5 whitespace-pre-wrap">{m.body}</p>
                              </li>
                            ))}
                          </ul>
                        ) : row.message ? (
                          <p className="mb-2 text-sm text-zinc-600">{row.message}</p>
                        ) : null}
                        {row.inquiry_status !== "closed" && (
                          <div>
                            <textarea
                              placeholder={t("priceInquiry.replyPlaceholder")}
                              value={artistReplyText[row.id] ?? ""}
                              onChange={(e) => {
                                const next = e.target.value;
                                setArtistReplyText((prev) => ({ ...prev, [row.id]: next }));
                                if (!next.trim()) {
                                  setArtistReplyAiEventId((prev) => {
                                    const copy = { ...prev };
                                    delete copy[row.id];
                                    return copy;
                                  });
                                }
                              }}
                              rows={2}
                              className="w-full rounded border border-zinc-200 px-3 py-2 text-sm"
                            />
                            <button
                              type="button"
                              disabled={!artistReplyText[row.id]?.trim() || replyingInquiryId === row.id}
                              onClick={() => handleArtistReply(row.id)}
                              className="mt-2 rounded bg-zinc-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-900 disabled:opacity-50"
                            >
                              {replyingInquiryId === row.id ? t("common.loading") : t("priceInquiry.reply")}
                            </button>
                            <InquiryReplyAssist
                              artwork={{
                                title: artwork.title ?? null,
                                artistName:
                                  formatIdentityPair(artist ?? null).primary,
                              }}
                              thread={(artistInquiryMessages[row.id] ?? [])
                                .slice(-3)
                                .map((m) => ({
                                  from: (m.sender_id === row.inquirer_id
                                    ? "inquirer"
                                    : "owner") as "inquirer" | "owner",
                                  text: m.body ?? "",
                                }))}
                              currentReply={artistReplyText[row.id] ?? ""}
                              onApply={(text, aiEventId) => {
                                setArtistReplyText((prev) => ({
                                  ...prev,
                                  [row.id]: text,
                                }));
                                setArtistReplyAiEventId((prev) => {
                                  const next = { ...prev };
                                  if (aiEventId) next[row.id] = aiEventId;
                                  else delete next[row.id];
                                  return next;
                                });
                              }}
                            />
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="mt-2 flex items-center gap-3">
              <LikeButton
                artworkId={artwork.id}
                likesCount={Number(artwork.likes_count) || 0}
                isLiked={liked}
                onUpdate={(newLiked, newCount) => {
                  setLiked(newLiked);
                  setArtwork((prev) =>
                    prev ? { ...prev, likes_count: newCount } : null
                  );
                }}
                showLoginCta={!userId}
              />
              {userId && (
                <button
                  type="button"
                  onClick={() => setShortlistOpen(true)}
                  className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
                >
                  {t("boards.save.cta")}
                </button>
              )}
            </div>
            {showProvenance && (
              <div className="mt-4">
                <ArtworkProvenanceBlock artwork={artwork} viewerId={userId} variant="full" />
                {hasProvenanceHistory && (
                  <button
                    type="button"
                    onClick={() => setShowProvenanceHistory((v) => !v)}
                    className="mt-2 text-xs text-zinc-500 underline hover:text-zinc-700"
                  >
                    {showProvenanceHistory ? t("artwork.hideHistory") : t("artwork.viewHistory")}
                  </button>
                )}
                {showProvenanceHistory && provenanceClaims.length > 0 && (
                  <ul className="mt-2 space-y-1 border-t border-zinc-200 pt-2 text-sm text-zinc-600">
                    {provenanceClaims.map((c, i) => {
                      const byPhrase = claimTypeToByPhrase(c.claim_type as ClaimType);
                      const label = byPhrase
                        ? `${byPhrase} ${formatIdentityPair(c.profiles).primary}`
                        : (c.claim_type === "CREATED" && artwork?.profiles?.display_name) || "—";
                      const date = c.created_at
                        ? new Date(c.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
                        : "";
                      return (
                        <li key={c.id ?? i} className="flex justify-between gap-2">
                          <span>{c.claim_type === "CREATED" ? `by ${artistLabel ?? t("artwork.artistFallback")}` : label}</span>
                          {date && <span className="text-zinc-400">{date}</span>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
            {exhibitionsForWork.length > 0 && (
              <div className="mt-4 border-t border-zinc-200 pt-3">
                <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                  {t("artwork.partOfExhibitions")}
                </p>
                <ul className="mt-2 space-y-1.5 text-sm text-zinc-700">
                  {exhibitionsForWork.map((ex) => {
                    const dates =
                      ex.start_date && ex.end_date
                        ? `${ex.start_date} – ${ex.end_date}`
                        : ex.start_date ?? ex.status;
                    const isMyExhibition =
                      userId &&
                      (ex.curator_id === userId ||
                        ex.host_profile_id === userId ||
                        delegatedProjectIds.has(ex.id));
                    return (
                      <li key={ex.id}>
                        {isMyExhibition ? (
                          <Link
                            href={`/my/exhibitions/${ex.id}`}
                            className="font-medium text-zinc-900 underline hover:text-zinc-700"
                          >
                            {ex.title}
                            {dates && ` · ${dates}`}
                          </Link>
                        ) : (
                          <span>
                            {ex.title}
                            {dates && ` · ${dates}`}
                            {" · "}
                            {getExhibitionHostCuratorLabel(ex, t)}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {canRequestClaim && (
              <div className="mt-4" ref={claimDropdownRef}>
                <div className="relative inline-block">
                  <button
                    type="button"
                    onClick={() => setClaimDropdownOpen((open) => !open)}
                    disabled={requestingClaim !== null}
                    className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 inline-flex items-center gap-1"
                  >
                    {requestingClaim ? "..." : t("artwork.thisArtworkIs")}
                    <span className="text-zinc-400" aria-hidden>{claimDropdownOpen ? " ▲" : " ▼"}</span>
                  </button>
                  {claimDropdownOpen && (
                    <div className="absolute left-0 top-full z-10 mt-1 min-w-[12rem] rounded-md border border-zinc-200 bg-white py-1 shadow-lg">
                      {!hasOwnsClaim && (
                        <button
                          type="button"
                          onClick={() => handleRequestClaimClick("OWNS")}
                          disabled={requestingClaim !== null}
                          className="w-full px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
                        >
                          {t("artwork.ownedByMe")}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRequestClaimClick("CURATED")}
                        disabled={requestingClaim !== null}
                        className="w-full px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
                      >
                        {t("artwork.curatedByMe")}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRequestClaimClick("EXHIBITED")}
                        disabled={requestingClaim !== null}
                        className="w-full px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
                      >
                        {t("artwork.exhibitedByMe")}
                      </button>
                    </div>
                  )}
                </div>
                {claimTypeToRequest && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-zinc-200 bg-zinc-50/70 px-3 py-2">
                    <label className="text-sm text-zinc-600">
                      {t("artwork.periodLabel")}:
                      <select
                        value={requestPeriodStatus}
                        onChange={(e) => setRequestPeriodStatus(e.target.value as "past" | "current" | "future")}
                        className="ml-1 rounded border border-zinc-300 bg-white px-2 py-1 text-sm"
                      >
                        <option value="past">{t("artwork.periodPast")}</option>
                        <option value="current">{t("artwork.periodCurrent")}</option>
                        <option value="future">{t("artwork.periodFuture")}</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={() => handleRequestClaim(claimTypeToRequest, requestPeriodStatus)}
                      disabled={requestingClaim !== null}
                      className="rounded bg-zinc-800 px-2 py-1 text-sm font-medium text-white hover:bg-zinc-900 disabled:opacity-50"
                    >
                      {t("artwork.sendRequest")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setClaimTypeToRequest(null)}
                      className="rounded border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-100"
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                )}
                {hasPendingRequest && (
                  <p className="mt-2 text-sm text-zinc-500">{t("artwork.requestPending")}</p>
                )}
              </div>
            )}
            {isOwner && pendingClaims.length > 0 && (
              <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50/70 p-3">
                <p className="mb-2 text-sm font-medium text-zinc-700">{t("artwork.pendingRequests")}</p>
                <ul className="space-y-2">
                  {pendingClaims.map((row) => {
                    const name = formatIdentityPair(row.profiles).primary;
                    const typeLabel =
                      row.claim_type === "OWNS"
                        ? t("artwork.ownedByMe")
                        : row.claim_type === "CURATED"
                          ? t("artwork.curatedByMe")
                          : row.claim_type === "EXHIBITED"
                            ? t("artwork.exhibitedByMe")
                            : row.claim_type;
                    const showConfirmForm =
                      confirmingClaimId === row.id &&
                      (row.claim_type === "CURATED" || row.claim_type === "EXHIBITED");
                    return (
                      <li key={row.id} className="flex flex-col gap-2 text-sm text-zinc-600">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span>{name} — {typeLabel}</span>
                          {!showConfirmForm && (
                            <span className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => handleApproveClick(row)}
                                disabled={confirmingId !== null}
                                className="rounded bg-zinc-800 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-900 disabled:opacity-50"
                              >
                                {t("artwork.approve")}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleReject(row.id)}
                                disabled={confirmingId !== null}
                                className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 disabled:opacity-50"
                              >
                                {t("artwork.reject")}
                              </button>
                            </span>
                          )}
                        </div>
                        {showConfirmForm && (
                          <div className="flex flex-wrap items-center gap-2 rounded border border-zinc-200 bg-white p-2">
                            <label className="text-zinc-600">
                              {t("artwork.periodLabel")}:
                              <select
                                value={confirmPeriodStatus}
                                onChange={(e) =>
                                  setConfirmPeriodStatus(e.target.value as "past" | "current" | "future")
                                }
                                className="ml-1 rounded border border-zinc-300 px-2 py-1 text-sm"
                              >
                                <option value="past">{t("artwork.periodPast")}</option>
                                <option value="current">{t("artwork.periodCurrent")}</option>
                                <option value="future">{t("artwork.periodFuture")}</option>
                              </select>
                            </label>
                            <button
                              type="button"
                              onClick={() => handleConfirm(row.id, { period_status: confirmPeriodStatus })}
                              disabled={confirmingId !== null}
                              className="rounded bg-zinc-800 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-900 disabled:opacity-50"
                            >
                              {t("artwork.confirmWithPeriod")}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingClaimId(null)}
                              className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100"
                            >
                              {t("common.cancel")}
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {(canEdit || canDelete) && (
              <div className="mt-4 flex items-center gap-4">
                {canEdit && (
                  <Link
                    href={`/artwork/${id}/edit`}
                    className="text-sm font-medium text-zinc-700 hover:text-zinc-900"
                  >
                    {t("common.edit")}
                  </Link>
                )}
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={deleting}
                    className="text-sm text-red-600 hover:text-red-800"
                  >
                    {t("common.delete")}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        <ConfirmActionDialog
          open={showDeleteConfirm}
          title={t("common.confirmDeleteShort")}
          description={t("common.confirmDelete")}
          confirmLabel={t("common.delete")}
          cancelLabel={t("common.cancel")}
          tone="destructive"
          busy={deleting}
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
        {artwork.story &&
          (() => {
            const wrapped = (
              <p className="text-sm text-zinc-600">{artwork.story}</p>
            );
            if (!descriptionResolution || descriptionResolution.canView) {
              return wrapped;
            }
            return (
              <GatedField
                ownerProfileId={artwork.artist_id}
                subjectType="artwork"
                subjectId={artwork.id}
                fieldKey="description"
                resolution={descriptionResolution}
                viewerRelationship={viewerRelationship}
                ownerLabel={getArtworkArtistLabel(artwork).label}
                surface="artwork_passport"
              >
                {wrapped}
              </GatedField>
            );
          })()}
      </div>
      <SaveToShortlistModal artworkId={artwork.id} open={shortlistOpen} onClose={() => setShortlistOpen(false)} />
    </main>
  );
}

export default function ArtworkDetailPage() {
  return <ArtworkDetailContent />;
}
