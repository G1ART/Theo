"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { useT } from "@/lib/i18n/useT";
import {
  getMyProfile,
  getMyStats,
  getStatsForProfile,
  getMyPendingClaimsCount,
  listMyArtworks,
  type MyStats,
} from "@/lib/supabase/me";
import { getMyPriceInquiryCount } from "@/lib/supabase/priceInquiries";
import { getUnreadConnectionMessageCount } from "@/lib/supabase/connectionMessages";
import {
  listPublicArtworksForProfile,
  listPublicArtworksListedByProfileId,
  type ArtworkWithLikes,
} from "@/lib/supabase/artworks";
import {
  computeProfileCompleteness,
  resolveDisplayedProfileCompleteness,
} from "@/lib/profile/completeness";
import { getProfileSurface, type ProfileSurface } from "@/lib/profile/surface";
import type { Profile as FullProfile } from "@/lib/supabase/profiles";
import { getProfileViewsCount } from "@/lib/supabase/profileViews";
import { resolveEntitlementFor } from "@/lib/entitlements";
import { supabase } from "@/lib/supabase/client";
import { useActingAs } from "@/context/ActingAsContext";
import {
  listExhibitionsForProfile,
  listMyExhibitions,
  type ExhibitionWithCredits,
} from "@/lib/supabase/exhibitions";
import { getProfileById } from "@/lib/supabase/profiles";
import {
  getBoardSaveSignals,
  listMyShortlists,
  type BoardSaveSignal,
} from "@/lib/supabase/shortlists";
import { listMyDelegations } from "@/lib/supabase/delegations";
import { getRelationshipDeskForOwner } from "@/lib/supabase/relationshipAccess";
import type { RelationshipDeskRow } from "@/lib/visibility/types";
import {
  FirstValuePathPanel,
  StudioHero,
  StudioHeroPanel,
  StudioMaterialsPanel,
  StudioNextStepsRail,
  StudioOperationGrid,
  StudioPortfolioPanel,
  StudioIntelligenceSurface,
  type OperationTile,
} from "@/components/studio";
import { computeStudioNextActions } from "@/lib/studio/priority";
import { resolvePersonaMode } from "@/lib/persona/resolvePersonaMode";
import type { FirstValueSelectorInput } from "@/lib/persona/actionGrammar";
import { TourTrigger, TourHelpButton } from "@/components/tour";
import { BetaFeedbackPrompt } from "@/components/beta";
import { TOUR_IDS } from "@/lib/tours/tourRegistry";
import { hasAnyRole, isArtistRole } from "@/lib/identity/roles";
import { DelegationBriefPanel } from "@/components/delegation/DelegationBriefPanel";
import { PageShell } from "@/components/ds/PageShell";
import { PageHeader } from "@/components/ds/PageHeader";
import { FloorPanel } from "@/components/ds/FloorPanel";

type Profile = FullProfile;

export default function MyPage() {
  const { t } = useT();
  const searchParams = useSearchParams();
  const { actingAsProfileId } = useActingAs();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<MyStats | null>(null);
  const [artworks, setArtworks] = useState<ArtworkWithLikes[]>([]);
  const [exhibitions, setExhibitions] = useState<ExhibitionWithCredits[]>([]);
  const [profileViewsCount, setProfileViewsCount] = useState<number | null>(null);
  const [canViewViewers, setCanViewViewers] = useState(false);
  const [priceInquiryCount, setPriceInquiryCount] = useState(0);
  const [pendingClaimsCount, setPendingClaimsCount] = useState(0);
  const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);
  const [boardSaveSignal, setBoardSaveSignal] = useState<BoardSaveSignal | null>(null);
  const [pendingInboundDelegations, setPendingInboundDelegations] = useState<number>(0);
  // Sprint 6.2 — sum of `pending_access_request_count + open_inquiry_count`
  // across the principal's relationships. Drives the dot badge on the
  // StudioHero "네트워크" pill. Calm presence-only signal — never
  // surfaced as a numeric badge to keep the hero quiet.
  const [pendingNetworkActivityCount, setPendingNetworkActivityCount] = useState<number>(0);
  // Sprint 7.1 Phase D — real signals for the first-value selector.
  // `roomCount` is the principal's actual shortlist count (not the
  // misleading "boards containing this artist's work" proxy).
  // `relationshipDeskRows` lets us derive `relationshipCount` and
  // `hasPrivateNote` from the same desk fetch we already perform for
  // the StudioHero network pill — no extra request, no N+1.
  const [myShortlistsCount, setMyShortlistsCount] = useState<number | null>(null);
  const [relationshipDeskRows, setRelationshipDeskRows] = useState<RelationshipDeskRow[]>([]);
  const [computedCompleteness, setComputedCompleteness] = useState<number | null>(null);
  const [, setLoading] = useState(true);
  const [, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const initialTabParam = searchParams.get("tab");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const effectiveProfileId = actingAsProfileId ?? null;
    try {
      // Resolve `insights.profile_viewer_identity` up-front: it controls
      // whether the studio viewer-identity list is populated at all and is
      // referenced by several downstream queries below.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id ?? null;
      const [profileRes, statsRes, artworksRes, viewerIdentityDecision] = await Promise.all([
        effectiveProfileId ? getProfileById(effectiveProfileId) : getMyProfile(),
        effectiveProfileId ? getStatsForProfile(effectiveProfileId) : getMyStats(),
        effectiveProfileId
          ? listPublicArtworksForProfile(effectiveProfileId, { limit: 50 })
          : listMyArtworks({ limit: 50, publicOnly: true }),
        resolveEntitlementFor({
          featureKey: "insights.profile_viewer_identity",
          userId,
          skipQuotaCheck: true,
        }),
      ]);

      if (profileRes.error) {
        setError(
          profileRes.error instanceof Error ? profileRes.error.message : t("my.errorLoadProfile")
        );
        return;
      }
      if (statsRes.error) {
        setError(
          statsRes.error instanceof Error ? statsRes.error.message : t("my.errorLoadStats")
        );
        return;
      }

      const profileData = profileRes.data as Profile | null;
      setProfile(profileData);
      setStats(statsRes.data ?? null);

      let mergedArtworks = artworksRes.data ?? [];
      if (!effectiveProfileId && profileData?.id) {
        const listedRes = await listPublicArtworksListedByProfileId(profileData.id, {
          limit: 50,
        });
        const listed = listedRes.data ?? [];
        const seen = new Set(mergedArtworks.map((a) => a.id));
        for (const a of listed) {
          if (!seen.has(a.id)) {
            seen.add(a.id);
            mergedArtworks.push(a);
          }
        }
      }
      mergedArtworks = [...mergedArtworks].sort(
        (a, b) =>
          new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
      );
      setArtworks(mergedArtworks);

      const canView = viewerIdentityDecision.allowed;
      setCanViewViewers(canView);

      if (profileData) {
        const surface = getProfileSurface(profileData);
        if (surface) {
          const { score } = computeProfileCompleteness(
            {
              username: surface.username,
              display_name: surface.displayName,
              avatar_url: surface.avatarUrl,
              bio: surface.bio,
              main_role: surface.mainRole,
              roles: [...surface.roles],
              city: surface.details.city,
              region: surface.details.region,
              country: surface.details.country,
              themes: [...surface.details.themes],
              mediums: [...surface.details.mediums],
              styles: [...surface.details.styles],
              keywords: [...surface.details.keywords],
              price_band: surface.details.price_band,
              acquisition_channels: [...surface.details.acquisition_channels],
              affiliation: surface.details.affiliation,
              program_focus: [...surface.details.program_focus],
              education: profileData.education ?? null,
            },
            { hasDetailsLoaded: true }
          );
          setComputedCompleteness(
            resolveDisplayedProfileCompleteness(profileData, score)
          );
        } else {
          setComputedCompleteness(null);
        }
      } else {
        setComputedCompleteness(null);
      }

      if (profileData?.id) {
        const [
          countRes,
          inquiryCountRes,
          claimsCountRes,
          messagesUnread,
          boardSignalRes,
          delegationsRes,
          deskRes,
          shortlistsRes,
        ] = await Promise.all([
          getProfileViewsCount(profileData.id, 7),
          getMyPriceInquiryCount(effectiveProfileId ?? undefined),
          getMyPendingClaimsCount(effectiveProfileId ?? undefined),
          effectiveProfileId ? Promise.resolve(0) : getUnreadConnectionMessageCount(),
          effectiveProfileId
            ? Promise.resolve({ data: { boards_count: 0, savers_count: 0 }, error: null })
            : getBoardSaveSignals(),
          effectiveProfileId
            ? Promise.resolve({ data: { sent: [], received: [] }, error: null })
            : listMyDelegations(),
          getRelationshipDeskForOwner({
            ownerProfileId: effectiveProfileId ?? profileData.id,
            filter: "all",
          }),
          // Sprint 7.1 Phase D — principal-aware shortlist count for
          // first-value `roomCount`. Solo path → forProfileId null
          // (resolved to auth.uid() server-side). Acting-as path → the
          // managed principal id. Replaces the misleading proxy that
          // used `boards_count` (boards containing the user's work).
          listMyShortlists({ forProfileId: effectiveProfileId }),
        ]);
        setProfileViewsCount(countRes.data);
        setPriceInquiryCount(inquiryCountRes.data ?? 0);
        setPendingClaimsCount(claimsCountRes.data ?? 0);
        setUnreadMessagesCount(messagesUnread ?? 0);
        setBoardSaveSignal(boardSignalRes.data ?? null);
        setMyShortlistsCount((shortlistsRes.data ?? []).length);
        const received = delegationsRes.data?.received ?? [];
        setPendingInboundDelegations(
          received.filter((d) => d.status === "pending").length
        );
        const deskRows = deskRes.data ?? [];
        setRelationshipDeskRows(deskRows);
        let networkActivity = 0;
        for (const row of deskRows) {
          networkActivity +=
            (row.pending_access_request_count ?? 0) +
            (row.open_inquiry_count ?? 0);
        }
        setPendingNetworkActivityCount(networkActivity);
        if (effectiveProfileId) {
          const { data: exData } = await listExhibitionsForProfile(profileData.id);
          setExhibitions(
            (exData ?? []).sort(
              (a, b) =>
                new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
            )
          );
        } else {
          const [exProfileRes, exMineRes] = await Promise.all([
            listExhibitionsForProfile(profileData.id),
            listMyExhibitions(),
          ]);
          const fromProfile = exProfileRes.data ?? [];
          const fromMine = exMineRes.data ?? [];
          const byId = new Map<string, ExhibitionWithCredits>();
          for (const e of fromProfile) byId.set(e.id, e);
          for (const e of fromMine) if (!byId.has(e.id)) byId.set(e.id, e);
          const merged = Array.from(byId.values()).sort(
            (a, b) =>
              new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
          );
          setExhibitions(merged);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.errorOccurred"));
    } finally {
      setLoading(false);
    }
  }, [actingAsProfileId, t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    function onFocus() {
      fetchData();
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchData]);

  useEffect(() => {
    if (toast) {
      const tid = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(tid);
    }
  }, [toast]);

  const profileSurface = useMemo<ProfileSurface | null>(
    () => getProfileSurface(profile),
    [profile]
  );

  const studioActions = useMemo(() => {
    if (!profile) return [];
    return computeStudioNextActions({
      profileCompleteness: computedCompleteness,
      artworkCount: artworks.length,
      pendingClaimsCount,
      priceInquiryCount,
      unreadInbox: priceInquiryCount,
      hasAvatar: !!profile.avatar_url,
      hasRoles: hasAnyRole({ main_role: profile.main_role, roles: profile.roles }),
      hasExhibitions: exhibitions.length > 0,
      t,
    });
  }, [
    profile,
    computedCompleteness,
    artworks.length,
    pendingClaimsCount,
    priceInquiryCount,
    exhibitions.length,
    t,
  ]);

  // Sprint 7 Phase B — first-value selector input + persona resolution.
  // The selector is deterministic; counts default to 0 so a fresh
  // account still gets guided actions instead of a blank panel.
  const firstValueSelectorInput = useMemo<FirstValueSelectorInput | null>(() => {
    if (!profile) return null;
    const personaMode = resolvePersonaMode({
      mainRole: profile.main_role ?? null,
      roles: profile.roles ?? null,
      actingAs: !!actingAsProfileId,
      artworkCount: stats?.artworksCount ?? artworks.length ?? 0,
      savedOrFollowedCount: stats?.followingCount ?? 0,
    });

    // Sprint 7.1 Phase D — replace null/proxy signals with real ones.
    // - roomCount: principal's actual shortlists, NOT
    //   `boardSaveSignal.boards_count` (which counts boards
    //   *containing* the user's work — a different concept).
    // - relationshipCount / hasPrivateNote: derived from the desk
    //   rows we already loaded above (no extra request).
    // - missingArtworkContextCount: lightweight heuristic over the
    //   artworks array we already have. Counts works whose
    //   description is empty. This is intentionally narrow to avoid
    //   unbounded data-layer churn; the selector treats `null` as
    //   "unknown" so a small sample still beats no signal.
    const realRoomCount = myShortlistsCount;
    const deskRowsLoaded = relationshipDeskRows.length > 0;
    const realRelationshipCount = deskRowsLoaded
      ? relationshipDeskRows.length
      : null;
    const realHasPrivateNote = deskRowsLoaded
      ? relationshipDeskRows.some((r) => r.has_private_note === true)
      : null;
    const realMissingContext =
      artworks.length === 0
        ? null
        : artworks.filter((a) => {
            const desc = (a as { description?: string | null }).description;
            return !desc || desc.trim().length === 0;
          }).length;

    return {
      personaMode,
      actingAs: !!actingAsProfileId,
      profileCompleteness: computedCompleteness,
      artworkCount: stats?.artworksCount ?? artworks.length ?? 0,
      publicArtworkCount: artworks.length,
      missingArtworkContextCount: realMissingContext,
      roomCount: realRoomCount,
      pendingAccessRequestCount: pendingNetworkActivityCount,
      relationshipCount: realRelationshipCount,
      hasPrivateNote: realHasPrivateNote,
      savedOrFollowedCount: stats?.followingCount ?? 0,
    };
  }, [
    profile,
    actingAsProfileId,
    computedCompleteness,
    artworks,
    stats?.artworksCount,
    stats?.followingCount,
    myShortlistsCount,
    relationshipDeskRows,
    pendingNetworkActivityCount,
  ]);

  // Brief §3 Section 2 — 8 tiles in a strict 2×4 layout.
  //   Row 1 (creation / curation / active operation): 전시 · 작업실 · 보드 · 메시지
  //   Row 2 (relationship / requests / verification / visibility): 문의 · 소유권 · 네트워크 · 프로필 조회
  const operationTiles = useMemo<OperationTile[]>(() => {
    const boardsCount = boardSaveSignal?.boards_count ?? null;
    const tiles: OperationTile[] = [
      {
        key: "exhibitions",
        labelKey: "studio.sections.exhibitions",
        descKey: "studio.sections.exhibitionsDesc",
        href: "/my/exhibitions",
        value: exhibitions.length,
        dataTour: "studio-card-exhibitions",
      },
      {
        key: "workshop",
        // `stats.artworksCount` counts every artwork where the caller is
        // `artist_id` regardless of visibility. This is the same scope
        // /my/library lists (default visibility="all"), so the tile and
        // the page can never disagree. The local `artworks` array is a
        // merged public + claim-listed set used for the portfolio panel
        // and is intentionally not used for this counter.
        labelKey: "studio.sections.workshop",
        descKey: "studio.sections.workshopDesc",
        href: "/my/library",
        value: stats?.artworksCount ?? 0,
        dataTour: "studio-card-workshop",
      },
      {
        key: "boards",
        labelKey: "studio.sections.boards",
        descKey: "studio.sections.boardsDesc",
        href: "/my/shortlists",
        value: boardsCount,
        valueLabel: boardsCount == null ? "—" : undefined,
        dataTour: "studio-card-boards",
      },
      {
        key: "messages",
        labelKey: "studio.sections.messages",
        descKey: "studio.sections.messagesDesc",
        href: "/my/messages",
        value: unreadMessagesCount,
        badge: unreadMessagesCount > 0 ? String(unreadMessagesCount) : null,
        dataTour: "studio-card-messages",
      },
      {
        key: "inbox",
        labelKey: "studio.sections.inbox",
        descKey: "studio.sections.inboxDesc",
        href: "/my/inquiries",
        value: priceInquiryCount,
        badge: priceInquiryCount > 0 ? String(priceInquiryCount) : null,
      },
      {
        key: "operations",
        labelKey: "studio.sections.operations",
        descKey: "studio.sections.operationsDesc",
        href: "/my/claims",
        value: pendingClaimsCount,
        badge: pendingClaimsCount > 0 ? String(pendingClaimsCount) : null,
      },
      {
        key: "network",
        // The network page holds both followers and following in one
        // place, so the tile surfaces a composite "followers · following"
        // glyph (e.g. "9 · 12"). The subtitle already reads "팔로워와
        // 팔로잉" / "Followers and following", so the ordering is
        // self-explanatory without extra copy.
        labelKey: "studio.sections.network",
        descKey: "studio.sections.networkDesc",
        href: "/my/network",
        value: stats?.followersCount ?? 0,
        valueLabel: `${stats?.followersCount ?? 0} · ${stats?.followingCount ?? 0}`,
      },
      {
        key: "views",
        labelKey: "studio.sections.views",
        descKey: "studio.sections.viewsDesc",
        // The settings page hosts the full viewer roster today; keeping
        // the tile clickable preserves the action-oriented intent of the
        // grid even when the viewer identity is entitlement-locked.
        href: "/settings",
        value: canViewViewers ? profileViewsCount : null,
        valueLabel: canViewViewers ? undefined : "—",
        locked: !canViewViewers,
      },
    ];
    return tiles;
  }, [
    exhibitions.length,
    priceInquiryCount,
    unreadMessagesCount,
    stats?.artworksCount,
    stats?.followersCount,
    stats?.followingCount,
    pendingClaimsCount,
    boardSaveSignal,
    canViewViewers,
    profileViewsCount,
  ]);

  // (Quick actions strip removed 2026-04-26: every entry was already
  // reachable in 1–2 clicks from the top nav, the hero card, or the
  // 4×2 operation grid — see HANDOFF.md for the audit.)

  const showOwnerHeader = !!profile && !actingAsProfileId;

  return (
    <AuthGate>
      <PageShell
        variant="studio"
        topAccessory={
          showOwnerHeader ? <TourHelpButton tourId={TOUR_IDS.studio} /> : null
        }
      >
        {showOwnerHeader ? <TourTrigger tourId={TOUR_IDS.studio} /> : null}
        {showOwnerHeader && (
          <PageHeader
            variant="plain"
            title={t("studio.title")}
            lead={t("studio.lead")}
          />
        )}
        {showOwnerHeader && (
          <>
            <StudioHeroPanel
              hero={
                <StudioHero
                  profile={profile}
                  completeness={computedCompleteness}
                  publicHref={profile.username ? `/u/${profile.username}` : null}
                  followersCount={stats?.followersCount ?? 0}
                  followingCount={stats?.followingCount ?? 0}
                  pendingInboundDelegations={pendingInboundDelegations}
                  pendingNetworkActivityCount={pendingNetworkActivityCount}
                />
              }
              rail={
                firstValueSelectorInput ? (
                  <FirstValuePathPanel
                    selectorInput={firstValueSelectorInput}
                    delegateDisplayName={
                      actingAsProfileId ? profile?.display_name ?? null : null
                    }
                    fallback={<StudioNextStepsRail actions={studioActions} />}
                  />
                ) : (
                  <StudioNextStepsRail actions={studioActions} />
                )
              }
            />
            <StudioOperationGrid tiles={operationTiles} />
            {/* Profile materials — Statement + CV. Artist persona only;
                non-artist studios stay calm without the panel. The two
                cards back the public-profile surface modals (P5). */}
            {isArtistRole({ main_role: profile.main_role ?? null, roles: profile.roles ?? null }) && (
              <StudioMaterialsPanel
                hasStatement={(profile.artist_statement ?? "").trim().length > 0}
                statementCharCount={(profile.artist_statement ?? "").trim().length}
                cvEntryCount={
                  (Array.isArray(profile.education) ? profile.education.length : 0) +
                  (Array.isArray(profile.exhibitions) ? (profile.exhibitions as unknown[]).length : 0) +
                  (Array.isArray(profile.awards) ? (profile.awards as unknown[]).length : 0) +
                  (Array.isArray(profile.residencies) ? (profile.residencies as unknown[]).length : 0)
                }
              />
            )}
          </>
        )}

        {showOwnerHeader && (
          <FloorPanel
            as="div"
            padding="sm"
            className="mb-3 flex flex-wrap items-baseline justify-between gap-2"
          >
            <div data-tour="studio-public-works" className="min-w-0">
              <p className="text-sm font-medium text-zinc-800">
                {t("studio.portfolioHelper.title")}
              </p>
              <p className="mt-0.5 text-xs text-zinc-500">
                {t("studio.portfolioHelper.desc")}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <a
                href="/my/artists"
                className="text-xs font-medium text-zinc-700 underline-offset-2 hover:text-zinc-900 hover:underline"
              >
                {t("myArtists.navLabel")}
              </a>
              <a
                href="/my/library"
                className="text-xs font-medium text-zinc-700 underline-offset-2 hover:text-zinc-900 hover:underline"
              >
                {t("studio.portfolioHelper.workshopLink")}
              </a>
            </div>
          </FloorPanel>
        )}

        {profile && actingAsProfileId && (
          <DelegationBriefPanel
            actingAsProfileId={actingAsProfileId}
            principalName={profile.display_name ?? profile.username ?? null}
          />
        )}

        {/* Sprint 6.2 — the owner-mode entry to network surfaces is
            now the calm "네트워크" pill on the StudioHero action row.
            This text strip is therefore acting-as only: when a delegate
            is operating on behalf of a principal the StudioHero is
            hidden (it was built around the signed-in user's own role),
            so this strip becomes the only quiet path into the principal
            owner's network hub from the studio shell. */}
        {profile && actingAsProfileId && (
          <div className="-mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
            <a
              href="/my/network?tab=requests"
              className="rounded-full px-2 py-1 hover:bg-zinc-100 hover:text-zinc-700"
            >
              {t("nav.accessRequests")}
            </a>
            <a
              href="/my/network?tab=relationships"
              className="rounded-full px-2 py-1 hover:bg-zinc-100 hover:text-zinc-700"
            >
              {t("nav.relationships")}
            </a>
          </div>
        )}

        {profile && (
          <StudioPortfolioPanel
            profile={profile}
            artworks={artworks}
            exhibitions={exhibitions}
            initialTabParam={initialTabParam}
            canSaveTabOrder={!actingAsProfileId}
            onRefresh={fetchData}
            onToast={setToast}
          />
        )}

        {profileSurface && !actingAsProfileId && (
          <StudioIntelligenceSurface
            profileSurface={profileSurface}
            completeness={computedCompleteness}
            artworks={artworks}
            exhibitions={exhibitions}
            stats={stats}
            viewsCount7d={profileViewsCount}
            inquiries7d={priceInquiryCount}
          />
        )}

        {profile && !actingAsProfileId ? (
          <BetaFeedbackPrompt pageKey="studio.main" />
        ) : null}

        {toast && (
          <div className="fixed bottom-4 right-4 rounded-2xl bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg">
            {toast}
          </div>
        )}
      </PageShell>
    </AuthGate>
  );
}
