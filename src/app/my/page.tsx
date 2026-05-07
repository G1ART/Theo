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
import { getBoardSaveSignals, type BoardSaveSignal } from "@/lib/supabase/shortlists";
import { listMyDelegations } from "@/lib/supabase/delegations";
import {
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
        ] = await Promise.all([
          getProfileViewsCount(profileData.id, 7),
          getMyPriceInquiryCount(effectiveProfileId ?? undefined),
          getMyPendingClaimsCount(effectiveProfileId ?? undefined),
          effectiveProfileId ? Promise.resolve(0) : getUnreadConnectionMessageCount(),
          // Only meaningful for the authenticated user's own artwork set.
          // When acting-as a gallery, suppress to avoid leaking wrong
          // scope; the signal is scoped to auth.uid()'s works regardless.
          effectiveProfileId
            ? Promise.resolve({ data: { boards_count: 0, savers_count: 0 }, error: null })
            : getBoardSaveSignals(),
          // Pending inbound count only for the real user; when acting-as,
          // delegate-side context belongs to the original session, not the
          // managed account. RPC scopes by auth.uid() either way.
          effectiveProfileId
            ? Promise.resolve({ data: { sent: [], received: [] }, error: null })
            : listMyDelegations(),
        ]);
        setProfileViewsCount(countRes.data);
        setPriceInquiryCount(inquiryCountRes.data ?? 0);
        setPendingClaimsCount(claimsCountRes.data ?? 0);
        setUnreadMessagesCount(messagesUnread ?? 0);
        setBoardSaveSignal(boardSignalRes.data ?? null);
        const received = delegationsRes.data?.received ?? [];
        setPendingInboundDelegations(
          received.filter((d) => d.status === "pending").length
        );
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
                />
              }
              rail={<StudioNextStepsRail actions={studioActions} />}
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
            <a
              href="/my/library"
              className="shrink-0 text-xs font-medium text-zinc-700 underline-offset-2 hover:text-zinc-900 hover:underline"
            >
              {t("studio.portfolioHelper.workshopLink")}
            </a>
          </FloorPanel>
        )}

        {profile && actingAsProfileId && (
          <DelegationBriefPanel
            actingAsProfileId={actingAsProfileId}
            principalName={profile.display_name ?? profile.username ?? null}
          />
        )}

        {/* Sprint 5 — quiet entry to the access-requests inbox. The
            visibility hub itself is now anchored on the StudioHero
            action row (`studio-visibility-hub`); the inbox stays here
            as a one-line link so it doesn't compete with the inquiries
            tile but remains discoverable.
            Sprint 6.1 — the same strip is also rendered in acting-as
            mode (a delegate-writer can review and respond to the
            principal's access requests / relationships). The Studio
            hero/operation-grid stay hidden in acting-as because they
            were built around the signed-in user's own role context;
            this strip is purely action-oriented and works either way. */}
        {profile && (
          <div className="-mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
            <a
              href="/my/access-requests"
              className="rounded-full px-2 py-1 hover:bg-zinc-100 hover:text-zinc-700"
            >
              {t("nav.accessRequests")}
            </a>
            <a
              href="/my/relationships"
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
