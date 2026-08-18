"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { setExhibitionBack } from "@/lib/exhibitionBack";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { useT } from "@/lib/i18n/useT";
import {
  pickLocalizedBio,
  pickLocalizedTitle,
} from "@/lib/i18n/pickLocalized";
import { getSession } from "@/lib/supabase/auth";
import { getMyProfile } from "@/lib/supabase/profiles";
import type { ProfilePublic } from "@/lib/supabase/profiles";
import type { ArtworkWithLikes } from "@/lib/supabase/artworks";
import { canEditArtwork, getArtworkImageUrl, updateMyArtworkOrder, getProfileArtworkOrders, applyProfileOrdering } from "@/lib/supabase/artworks";
import { getExhibitionHostCuratorLabel, type ExhibitionWithCredits } from "@/lib/exhibitionCredits";
import {
  updateMyProfileExhibitionOrder,
  clearMyProfileExhibitionOrder,
} from "@/lib/supabase/exhibitions";
import {
  defaultExhibitionSortMode,
  sortExhibitions,
  type ExhibitionSortMode,
} from "@/lib/exhibitions/sort";
import { getLikedArtworkIds } from "@/lib/supabase/likes";
import { ProfileActions } from "./ProfileActions";
import { ProfileViewTracker } from "./ProfileViewTracker";
import { ArtworkCard } from "./ArtworkCard";
import { SortableArtworkCard } from "./SortableArtworkCard";
import { SortableExhibitionRow } from "./SortableExhibitionRow";
import { ExhibitionSortDropdown } from "@/components/exhibitions/ExhibitionSortDropdown";
import { TourTrigger, TourHelpButton } from "@/components/tour";
import { TOUR_IDS } from "@/lib/tours/tourRegistry";
import { formatErrorMessage } from "@/lib/errors/format";
import { Chip, EmptyState, PageShell } from "@/components/ds";
import { ProfileTabManager } from "@/components/profile/ProfileTabManager";
import { formatIdentityPair, formatRoleChips } from "@/lib/identity/format";
import { ProfileCoverBand } from "@/components/profile/ProfileCoverBand";
import { ProfileInlineCards } from "@/components/profile/ProfileInlineCards";
import { InlineAuthGate } from "@/components/auth/InlineAuthGate";
import { isArtistRole } from "@/lib/identity/roles";
import { BilingualContextualNudge } from "@/components/bilingual/BilingualContextualNudge";

const PROFILE_UPDATED_KEY = "profile_updated";

import {
  filterArtworksByPersona,
  type PersonaTab,
} from "@/lib/provenance/personaTabs";
import { persistStudioPortfolio } from "@/lib/studio/persistStudioPortfolio";
import {
  type ActiveStudioTab,
  assignArtworksToCustomTab,
  buildStudioStripTabs,
  filterStripForPublicView,
  parseActiveTabParam,
  parseStudioPortfolio,
} from "@/lib/studio/studioPortfolioConfig";

type Props = {
  profile: ProfilePublic;
  artworks: ArtworkWithLikes[];
  exhibitions?: ExhibitionWithCredits[];
  /**
   * Profile-specific manual exhibition order, serialized as `[id, sort_order]`
   * tuples (Maps don't survive RSC -> client serialization). When non-empty
   * we honor it as the default sort.
   */
  exhibitionOrderEntries?: Array<[string, number]>;
  initialReorderMode?: boolean;
  /** Raw `?tab=` (e.g. `exhibitions`, `all`, `CREATED`, `custom-<uuid>`) */
  initialTabParam?: string | null;
};

function getAvatarUrl(avatarUrl: string | null): string | null {
  if (!avatarUrl) return null;
  if (avatarUrl.startsWith("http")) return avatarUrl;
  return getArtworkImageUrl(avatarUrl, "avatar");
}

export function UserProfileContent({
  profile,
  artworks,
  exhibitions = [],
  exhibitionOrderEntries,
  initialReorderMode = false,
  initialTabParam = null,
}: Props) {
  const { t, locale } = useT();
  const router = useRouter();
  const pathname = usePathname();
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [showUpdatedBanner, setShowUpdatedBanner] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [viewerId, setViewerId] = useState<string | null>(null);
  // "Session resolved" latch so the anonymous Statement/CV gate never
  // flashes for a signed-in viewer during the initial client session read.
  const [sessionChecked, setSessionChecked] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);
  const [active, setActive] = useState<ActiveStudioTab>({ kind: "persona", tab: "all" });
  const [localArtworks, setLocalArtworks] = useState<ArtworkWithLikes[]>(artworks);
  const [saving, setSaving] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [savedToastMsg, setSavedToastMsg] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Wireframe redesign: top-of-profile role tab (Artist(main) / Collector).
  // Purely a UI filter — the underlying persona strip / reorder / permission
  // logic keeps its own state (`active`) and stays authoritative.
  const [roleTab, setRoleTab] = useState<"artist" | "collector">("artist");
  const [tabAssignMode, setTabAssignMode] = useState(false);
  const [tabAssignIds, setTabAssignIds] = useState<Set<string>>(new Set());
  const [tabAssignSaving, setTabAssignSaving] = useState(false);

  // Exhibition manual order map (rebuilt only when the prop changes).
  const initialExhibitionOrderMap = useMemo(
    () => new Map<string, number>(exhibitionOrderEntries ?? []),
    [exhibitionOrderEntries]
  );
  const [exhibitionOrderMap, setExhibitionOrderMap] = useState<Map<string, number>>(
    initialExhibitionOrderMap
  );
  useEffect(() => {
    setExhibitionOrderMap(initialExhibitionOrderMap);
  }, [initialExhibitionOrderMap]);

  // Exhibition sort + reorder UI state.
  const [exhibitionSortMode, setExhibitionSortMode] = useState<ExhibitionSortMode>(() =>
    defaultExhibitionSortMode(initialExhibitionOrderMap)
  );
  const [exhibitionReorderMode, setExhibitionReorderMode] = useState(false);
  const [exhibitionDraft, setExhibitionDraft] = useState<ExhibitionWithCredits[]>([]);
  const [exhibitionSaving, setExhibitionSaving] = useState(false);
  const [exhibitionSaveError, setExhibitionSaveError] = useState<string | null>(null);

  useEffect(() => {
    setLocalArtworks(artworks);
  }, [artworks]);

  useEffect(() => {
    const fromUrl = parseActiveTabParam(initialTabParam);
    if (fromUrl) {
      setActive(fromUrl);
      return;
    }
    if (exhibitions.length > 0 && artworks.length === 0) {
      setActive({ kind: "persona", tab: "exhibitions" });
    }
  }, [initialTabParam, exhibitions.length, artworks.length]);

  /**
   * One-shot auto-activation for `?mode=reorder` URLs. Without the ref
   * gate this effect re-fires after every save (router.refresh changes
   * the artwork/exhibition prop reference) and snaps the user back into
   * reorder mode right after they leave it.
   */
  const autoReorderActivatedRef = useRef(false);
  useEffect(() => {
    if (autoReorderActivatedRef.current) return;
    if (!initialReorderMode || !isOwner) return;
    if (active.kind === "persona" && active.tab === "exhibitions") {
      if (exhibitions.length < 2) return;
      autoReorderActivatedRef.current = true;
      setExhibitionDraft(
        sortExhibitions(exhibitions, exhibitionSortMode, exhibitionOrderMap)
      );
      setExhibitionReorderMode(true);
      return;
    }
    if (artworks.length > 0) {
      autoReorderActivatedRef.current = true;
      setReorderMode(true);
    }
  }, [
    initialReorderMode,
    isOwner,
    artworks.length,
    active,
    exhibitions,
    exhibitionSortMode,
    exhibitionOrderMap,
  ]);

  useEffect(() => {
    function resolveOwner(sessionUserId: string | undefined): void {
      if (!sessionUserId) {
        setIsOwner(false);
        return;
      }
      const idMatch = !!profile?.id && profile.id === sessionUserId;
      if (idMatch) {
        setIsOwner(true);
        return;
      }
      getMyProfile().then(({ data: myProfile }) => {
        if (!myProfile) {
          setIsOwner(idMatch);
          return;
        }
        const usernameMatch =
          profile?.username &&
          (myProfile as { username?: string | null }).username &&
          String(profile.username).trim().toLowerCase() ===
            String((myProfile as { username?: string | null }).username).trim().toLowerCase();
        setIsOwner(idMatch || (!!sessionUserId && !!usernameMatch));
      });
    }

    getSession().then(({ data: { session } }) => {
      const uid = session?.user?.id;
      setViewerId(uid ?? null);
      setSessionChecked(true);
      if (uid) {
        resolveOwner(uid);
        return;
      }
      setTimeout(() => {
        getSession().then(({ data: { session: retrySession } }) => {
          const retryUid = retrySession?.user?.id;
          setViewerId(retryUid ?? null);
          resolveOwner(retryUid);
        });
      }, 400);
    });
  }, [profile?.id, profile?.username]);

  useEffect(() => {
    const ids = artworks.map((a) => a.id);
    getLikedArtworkIds(ids).then(setLikedIds);
  }, [artworks]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      setLocalArtworks((prev) => {
        // Include artworks where user is artist OR has a claim
        const reorderableIds = prev.filter((a) => {
          const isArtist = a.artist_id === profile.id;
          const hasClaim = (a.claims ?? []).some((c) => c.subject_profile_id === profile.id);
          return isArtist || hasClaim;
        }).map((a) => a.id);
        const oldIndex = reorderableIds.indexOf(active.id as string);
        const newIndex = reorderableIds.indexOf(over.id as string);
        if (oldIndex === -1 || newIndex === -1) return prev;
        const reorderable = prev.filter((a) => {
          const isArtist = a.artist_id === profile.id;
          const hasClaim = (a.claims ?? []).some((c) => c.subject_profile_id === profile.id);
          return isArtist || hasClaim;
        });
        const others = prev.filter((a) => {
          const isArtist = a.artist_id === profile.id;
          const hasClaim = (a.claims ?? []).some((c) => c.subject_profile_id === profile.id);
          return !isArtist && !hasClaim;
        });
        const nextReorderable = [...reorderable];
        const [removed] = nextReorderable.splice(oldIndex, 1);
        nextReorderable.splice(newIndex, 0, removed);
        return [...nextReorderable, ...others];
      });
    },
    [profile.id]
  );

  const handleSaveReorder = useCallback(async () => {
    setSaveError(null);
    setSaving(true);
    const orderedIds = localArtworks
      .filter((a) => {
        const isArtist = a.artist_id === profile.id;
        const hasClaim = (a.claims ?? []).some((c) => c.subject_profile_id === profile.id);
        return isArtist || hasClaim;
      })
      .map((a) => a.id);
    const { error } = await updateMyArtworkOrder(orderedIds, profile.id);
    setSaving(false);
    if (error) {
      setSaveError(formatErrorMessage(error));
      return;
    }
    setReorderMode(false);
    setSavedToastMsg(null);
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2000);
    router.refresh();
  }, [localArtworks, profile.id, router]);

  const handleCancelReorder = useCallback(() => {
    setReorderMode(false);
    setLocalArtworks(artworks);
    setSaveError(null);
  }, [artworks]);

  const sortedExhibitions = useMemo(
    () => sortExhibitions(exhibitions, exhibitionSortMode, exhibitionOrderMap),
    [exhibitions, exhibitionSortMode, exhibitionOrderMap]
  );

  const handleExhibitionDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active: a, over } = event;
      if (!over || a.id === over.id) return;
      setExhibitionDraft((prev) => {
        const oldIdx = prev.findIndex((e) => e.id === a.id);
        const newIdx = prev.findIndex((e) => e.id === over.id);
        if (oldIdx === -1 || newIdx === -1) return prev;
        const next = [...prev];
        const [removed] = next.splice(oldIdx, 1);
        next.splice(newIdx, 0, removed);
        return next;
      });
    },
    []
  );

  const handleExhibitionReorderStart = useCallback(() => {
    if (exhibitions.length < 2) return;
    setExhibitionDraft(sortedExhibitions);
    setExhibitionReorderMode(true);
    setExhibitionSaveError(null);
  }, [exhibitions.length, sortedExhibitions]);

  const handleExhibitionReorderCancel = useCallback(() => {
    setExhibitionReorderMode(false);
    setExhibitionDraft([]);
    setExhibitionSaveError(null);
  }, []);

  const handleExhibitionReorderSave = useCallback(async () => {
    if (!isOwner) return;
    setExhibitionSaving(true);
    setExhibitionSaveError(null);
    const orderedIds = exhibitionDraft.map((e) => e.id);
    const { error } = await updateMyProfileExhibitionOrder(orderedIds, profile.id);
    setExhibitionSaving(false);
    if (error) {
      setExhibitionSaveError(formatErrorMessage(error));
      return;
    }
    const nextMap = new Map<string, number>();
    orderedIds.forEach((id, idx) => nextMap.set(id, idx));
    setExhibitionOrderMap(nextMap);
    setExhibitionSortMode("manual");
    setExhibitionReorderMode(false);
    setExhibitionDraft([]);
    setSavedToastMsg(t("exhibition.reorder.saved"));
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2000);
    router.refresh();
  }, [exhibitionDraft, isOwner, profile.id, router, t]);

  const handleExhibitionClearManual = useCallback(async () => {
    if (!isOwner) return;
    setExhibitionSaving(true);
    setExhibitionSaveError(null);
    const { error } = await clearMyProfileExhibitionOrder(profile.id);
    setExhibitionSaving(false);
    if (error) {
      setExhibitionSaveError(formatErrorMessage(error));
      return;
    }
    setExhibitionOrderMap(new Map());
    setExhibitionSortMode("registered_desc");
    router.refresh();
  }, [isOwner, profile.id, router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.sessionStorage.getItem(PROFILE_UPDATED_KEY) === "true") {
      window.sessionStorage.removeItem(PROFILE_UPDATED_KEY);
      setShowUpdatedBanner(true);
      const t = setTimeout(() => setShowUpdatedBanner(false), 2000);
      return () => clearTimeout(t);
    }
  }, []);

  const { primary: displayName, secondary: usernameHandle } = formatIdentityPair(profile, t, locale);
  const avatarUrl = getAvatarUrl(profile.avatar_url);
  const roleChips = formatRoleChips(profile, t, { max: 6 });

  const portfolio = useMemo(
    () =>
      parseStudioPortfolio(
        profile.studio_portfolio != null
          ? { studio_portfolio: profile.studio_portfolio }
          : null
      ),
    [profile.studio_portfolio]
  );

  const roles = (profile.roles ?? []) as string[];

  const defaultTabLabels: Record<PersonaTab, string> = useMemo(
    () => ({
      all: t("profile.personaAll"),
      exhibitions: t("exhibition.myExhibitions"),
      CREATED: t("profile.personaWork"),
      OWNS: t("profile.personaCollected"),
      INVENTORY: t("profile.personaGallery"),
      CURATED: t("profile.personaCurated"),
    }),
    [t]
  );

  const stripRows = useMemo(
    () =>
      buildStudioStripTabs({
        profileId: profile.id,
        artworks,
        exhibitionsCount: exhibitions.length,
        mainRole: profile.main_role ?? null,
        roles,
        portfolio,
        rootProfileDetails: null,
        defaultTabLabels,
      }),
    [
      profile.id,
      profile.main_role,
      artworks,
      exhibitions.length,
      roles,
      portfolio,
      defaultTabLabels,
    ]
  );

  const stripPublic = useMemo(() => filterStripForPublicView(stripRows), [stripRows]);

  useEffect(() => {
    if (active.kind === "custom") {
      const ok = stripPublic.some((r) => r.kind === "custom" && r.customId === active.id);
      if (!ok) setActive({ kind: "persona", tab: "all" });
    } else if (active.kind === "persona") {
      const ok = stripPublic.some((r) => r.kind === "persona" && r.personaTab === active.tab);
      if (!ok) setActive({ kind: "persona", tab: "all" });
    }
  }, [active, stripPublic]);

  const displayedArtworks = useMemo(() => {
    if (active.kind === "persona") {
      return filterArtworksByPersona(artworks, profile.id, active.tab);
    }
    const tab = (portfolio.custom_tabs ?? []).find((c) => c.id === active.id);
    if (!tab) return [];
    const byId = new Map(artworks.map((a) => [a.id, a]));
    const out: ArtworkWithLikes[] = [];
    for (const id of tab.artwork_ids) {
      const a = byId.get(id);
      if (a) out.push(a);
    }
    return out;
  }, [active, artworks, profile.id, portfolio.custom_tabs]);
  // Reorderable artworks: user is artist OR has any claim (not just CREATED)
  const reorderableArtworks = useMemo(
    () => localArtworks.filter((a) => {
      const isArtist = a.artist_id === profile.id;
      const hasClaim = (a.claims ?? []).some((c) => c.subject_profile_id === profile.id);
      return isArtist || hasClaim;
    }),
    [localArtworks, profile.id]
  );

  const isExhibitionsView = active.kind === "persona" && active.tab === "exhibitions";
  const customTabs = portfolio.custom_tabs ?? [];

  async function handleAssignToCustomTab(targetCustomId: string | null) {
    const ids = Array.from(tabAssignIds);
    if (ids.length === 0) return;
    setTabAssignSaving(true);
    const next = assignArtworksToCustomTab({
      portfolio,
      artworkIds: ids,
      targetCustomId,
    });
    const { ok } = await persistStudioPortfolio(next);
    setTabAssignSaving(false);
    if (!ok) {
      setSavedToastMsg(t("common.tryAgain"));
      setSavedToast(true);
      return;
    }
    setTabAssignIds(new Set());
    setTabAssignMode(false);
    setSavedToastMsg(t("common.saved"));
    setSavedToast(true);
    router.refresh();
  }

  // Derived role-tab set. We only surface the Artist tab if the profile
  // actually claims artist-hood (main_role=artist or artist in roles[]),
  // and only surface the Collector tab if the profile has any collected
  // works OR explicitly declares the collector role. Solo-role profiles
  // never render the tab strip.
  const isArtistProfile = isArtistRole({ main_role: profile.main_role ?? null, roles });
  const collectorFromRoles =
    profile.main_role === "collector" || roles.includes("collector");
  // Any OWNS-typed claim naming this profile — including self-owned works
  // — surfaces the Collector tab. Self-ownership counts as collection in
  // Theo's model (kept works, unsold), and the persona strip already
  // exposes it as `Collected (n)`; making the top tab reflect that keeps
  // the two navigations in sync.
  const collectorFromArtworks = artworks.some((a) =>
    (a.claims ?? []).some(
      (c) => c.subject_profile_id === profile.id && c.claim_type === "OWNS"
    )
  );
  const hasCollectorTab = collectorFromRoles || collectorFromArtworks;
  const showRoleTabs = isArtistProfile && hasCollectorTab;

  // Keep the underlying persona `active` in sync with the chosen role tab.
  // Collector → force `OWNS`; Artist → if we came from OWNS reset to `all`.
  useEffect(() => {
    if (!showRoleTabs) return;
    if (roleTab === "collector") {
      if (!(active.kind === "persona" && active.tab === "OWNS")) {
        setActive({ kind: "persona", tab: "OWNS" });
      }
    } else if (roleTab === "artist") {
      if (active.kind === "persona" && active.tab === "OWNS") {
        setActive({ kind: "persona", tab: "all" });
      }
    }
  }, [roleTab, showRoleTabs, active]);

  const worksHeading = useMemo(() => {
    if (isExhibitionsView) return t("exhibition.myExhibitions");
    if (active.kind === "custom") {
      const row = stripPublic.find((r) => r.kind === "custom" && r.customId === active.id);
      return row?.label ?? t("profile.works");
    }
    return t("profile.works");
  }, [active, isExhibitionsView, stripPublic, t]);

  return (
    <>
      <ProfileViewTracker profileId={profile.id} />
      <PageShell variant="default">
        {showUpdatedBanner && (
        <div
          role="status"
          className="mb-4 rounded bg-green-100 px-4 py-2 text-sm font-medium text-green-800"
        >
          {t("profile.updatedBanner")}
        </div>
      )}
      <ProfileCoverBand
        coverImagePath={profile.cover_image_url ?? null}
        positionY={profile.cover_image_position_y ?? 50}
      />
      <div className="mb-8 flex flex-col gap-4">
        <div className="flex items-start gap-4">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full bg-zinc-200">
            {avatarUrl ? (
              <Image
                src={avatarUrl}
                alt=""
                width={80}
                height={80}
                sizes="80px"
                priority
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-2xl font-medium text-zinc-500">
                {displayName.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
              {displayName}
            </h1>
            {usernameHandle && (
              <p className="text-sm text-zinc-500">{usernameHandle}</p>
            )}
            {/*
              QA 2026-07-29 — Layer 3 이중언어 컨텍스트 넛지. 오너 본인이
              자기 프로필을 볼 때, 현재 UI 로케일에 해당하는 이름 슬롯이
              비어 있으면 조용히 안내 chip. `viewerIsOwner={isOwner}` 로
              방문자에게는 절대 노출되지 않는다.
            */}
            <div className="mt-1">
              <BilingualContextualNudge
                field="display_name"
                sourceValue={
                  locale === "ko" ? profile.display_name_en : profile.display_name_ko
                }
                currentValue={
                  locale === "ko" ? profile.display_name_ko : profile.display_name_en
                }
                uiLocale={locale}
                viewerIsOwner={isOwner}
                editHref="/settings#displayName"
                scope="profile"
                sessionScopeHint={profile.id}
              />
            </div>
            <div className="mt-2">
              <ProfileActions profileId={profile.id} />
            </div>
          </div>
          {isOwner && (
            <Link
              href="/settings"
              className="inline-flex shrink-0 items-center justify-center rounded-full border border-zinc-300 bg-white px-4 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 hover:border-zinc-500"
            >
              {t("profile.editProfile")}
            </Link>
          )}
        </div>

        {(() => {
          const localizedBio = pickLocalizedBio(profile, locale);
          const bioCurrentSlot =
            locale === "ko" ? profile.bio_ko ?? "" : profile.bio_en ?? "";
          const bioSourceSlot =
            locale === "ko" ? profile.bio_en ?? "" : profile.bio_ko ?? "";
          return (
            <div className="space-y-1">
              {localizedBio ? (
                <p className="whitespace-pre-line text-sm text-zinc-700">{localizedBio}</p>
              ) : isOwner ? (
                <Link
                  href="/settings#bio"
                  className="text-sm text-zinc-500 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-800"
                >
                  {t("profile.addBio")}
                </Link>
              ) : (
                <p className="text-sm text-zinc-400">{t("profile.noBio")}</p>
              )}
              <BilingualContextualNudge
                field="bio"
                sourceValue={bioSourceSlot}
                currentValue={bioCurrentSlot}
                uiLocale={locale}
                viewerIsOwner={isOwner}
                editHref="/settings#bio"
                scope="profile"
                sessionScopeHint={`${profile.id}:bio`}
              />
            </div>
          );
        })()}

        {roleChips.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {roleChips.map((chip) => (
              <Chip key={chip.key} tone={chip.isPrimary ? "accent" : "neutral"}>
                {chip.label}
              </Chip>
            ))}
          </div>
        )}

        {(profile.website || profile.location) && (
          <p className="text-sm text-zinc-600">
            {profile.website && (
              <a
                href={
                  /^https?:\/\//i.test(profile.website)
                    ? profile.website
                    : `https://${profile.website}`
                }
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="break-all underline-offset-2 hover:text-zinc-900 hover:underline"
              >
                {/* Strip scheme for compact display while keeping the
                    full URL on the href so users land on the right site. */}
                {profile.website.replace(/^https?:\/\//i, "").replace(/\/$/, "")}
              </a>
            )}
            {profile.website && profile.location ? (
              <span className="mx-1 text-zinc-400">·</span>
            ) : null}
            {profile.location && <span>{profile.location}</span>}
          </p>
        )}
      </div>

      {/* Wireframe role tabs (Artist / Collector). Only rendered when
          both apply — a solo-artist profile keeps the previous layout.
          Sprint C.M (2026-08-03): each tab now surfaces the `(main)`
          suffix next to the primary role instead of relying on an
          all-caps micro-label; matches the 2026-08-03 wireframe. */}
      {showRoleTabs && (() => {
        const artistIsMain = profile.main_role === "artist";
        const collectorIsMain = profile.main_role === "collector";
        return (
          <div className="mb-6 flex items-center gap-6 border-b border-zinc-200 text-sm">
            <button
              type="button"
              onClick={() => setRoleTab("artist")}
              aria-pressed={roleTab === "artist"}
              className={`-mb-px border-b-2 pb-2 transition-colors ${
                roleTab === "artist"
                  ? "border-zinc-900 font-semibold text-zinc-900"
                  : "border-transparent text-zinc-500 hover:text-zinc-800"
              }`}
            >
              {t("profile.tab.artist")}
              {artistIsMain && (
                <span className="ml-1 text-[11px] text-zinc-500">
                  {t("profile.role.mainSuffix")}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setRoleTab("collector")}
              aria-pressed={roleTab === "collector"}
              className={`-mb-px border-b-2 pb-2 transition-colors ${
                roleTab === "collector"
                  ? "border-zinc-900 font-semibold text-zinc-900"
                  : "border-transparent text-zinc-500 hover:text-zinc-800"
              }`}
            >
              {t("profile.tab.collector")}
              {collectorIsMain && (
                <span className="ml-1 text-[11px] text-zinc-500">
                  {t("profile.role.mainSuffix")}
                </span>
              )}
            </button>
          </div>
        );
      })()}

      {/* Profile Statement + CV. Sprint C.M (2026-08-03): moved from
          the modal-triggered `ProfileSurfaceCards` to the inline
          expand-in-place `ProfileInlineCards`, per the 2026-08-03
          wireframe. Persona gating is unchanged — both surfaces stay
          artist-only, and both are suppressed when the visitor picks
          the Collector role tab. */}
      {roleTab === "artist" && isArtistRole({ main_role: profile.main_role ?? null, roles }) && (
        sessionChecked && !viewerId ? (
          // Feed-first cold front door: anonymous visitors see the public
          // profile (name, avatar, bio, works grid) but the deeper
          // Statement / CV section is replaced by the "Join now to explore
          // more" inline gate (wireframe image 2). Returning members reach
          // it via the gate's Log in link; the full section renders
          // unchanged for signed-in viewers below.
          <section className="mb-6">
            <InlineAuthGate
              variant="card"
              title={t("authGate.profile.title")}
              description={t("authGate.profile.description")}
              nextPath={pathname}
            />
          </section>
        ) : (
        <>
          <ProfileInlineCards
            statementKo={profile.artist_statement_ko ?? null}
            statementEn={profile.artist_statement_en ?? null}
            statementLegacy={profile.artist_statement ?? null}
            heroImagePath={profile.artist_statement_hero_image_url ?? null}
            education={profile.education ?? null}
            exhibitionsCv={profile.exhibitions_cv ?? null}
            awards={profile.awards ?? null}
            residencies={profile.residencies ?? null}
            cvPdfPath={profile.cv_pdf_path ?? null}
            isOwner={isOwner}
            ownerStatementHref="/settings#statement"
            ownerCvHref="/my/profile/cv"
          />
          {/*
            QA 2026-07-29 — 오너 전용 statement 컨텍스트 넛지. 현재 UI 로케
            일의 statement 슬롯이 비어 있을 때만 노출된다. `#statement`
            앵커는 /settings 페이지의 statement 섹션에 존재한다.
          */}
          <div className="mt-2">
            <BilingualContextualNudge
              field="statement"
              sourceValue={
                locale === "ko"
                  ? profile.artist_statement_en
                  : profile.artist_statement_ko
              }
              currentValue={
                locale === "ko"
                  ? profile.artist_statement_ko
                  : profile.artist_statement_en
              }
              uiLocale={locale}
              viewerIsOwner={isOwner}
              editHref="/settings#statement"
              scope="profile"
              sessionScopeHint={`${profile.id}:statement`}
            />
          </div>
        </>
        )
      )}

      {isOwner && (
        <div className="mb-3 flex items-center justify-end gap-2">
          <TourTrigger tourId={TOUR_IDS.publicProfile} />
          <TourHelpButton tourId={TOUR_IDS.publicProfile} />
        </div>
      )}

      {roleTab === "artist" && (stripPublic.length > 0 || isOwner) && (
        <ProfileTabManager
          isOwner={isOwner}
          stripPublic={stripPublic}
          stripRows={stripRows}
          active={active}
          onActiveChange={setActive}
          portfolio={portfolio}
          defaultTabLabels={defaultTabLabels}
          onPersisted={() => router.refresh()}
          onToast={(msg) => {
            setSavedToastMsg(msg);
            setSavedToast(true);
          }}
        />
      )}

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-900">{worksHeading}</h2>
        {!isExhibitionsView && isOwner && !reorderMode && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {customTabs.length > 0 && displayedArtworks.length > 0 && (
              tabAssignMode ? (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    disabled={tabAssignIds.size === 0 || tabAssignSaving}
                    defaultValue=""
                    onChange={(e) => {
                      const v = e.target.value;
                      e.target.value = "";
                      if (v === "__noop") return;
                      void handleAssignToCustomTab(v === "" ? null : v);
                    }}
                    className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700"
                  >
                    <option value="__noop">{t("studio.portfolio.moveToTabPlaceholder")}</option>
                    <option value="">{t("studio.portfolio.clearCustomTab")}</option>
                    {customTabs.map((ct) => (
                      <option key={ct.id} value={ct.id}>
                        {ct.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      setTabAssignMode(false);
                      setTabAssignIds(new Set());
                    }}
                    className="text-xs text-zinc-500 hover:text-zinc-800"
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setTabAssignMode(true)}
                  className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-500"
                >
                  {t("studio.portfolio.moveToTab")}
                </button>
              )
            )}
        {!isExhibitionsView && isOwner && reorderableArtworks.length > 0 && !reorderMode && (
          <button
            type="button"
            onClick={() => { setReorderMode(true); setSaveError(null); setTabAssignMode(false); setTabAssignIds(new Set()); }}
            aria-label={t("profile.reorder")}
            data-tour="public-profile-reorder-button"
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-300 bg-white px-4 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            <svg
              aria-hidden
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 5h8M4 8h8M4 11h8" />
              <path d="M2 3l1.2 1.2M14 3l-1.2 1.2M2 13l1.2-1.2M14 13l-1.2-1.2" />
            </svg>
            {t("profile.reorder")}
          </button>
        )}
          </div>
        )}
        {!isExhibitionsView && reorderMode && isOwner && reorderableArtworks.length > 0 && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSaveReorder}
              disabled={saving}
              className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {t("profile.reorderSave")}
            </button>
            <button
              type="button"
              onClick={handleCancelReorder}
              disabled={saving}
              className="rounded-full border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            >
              {t("profile.reorderCancel")}
            </button>
          </div>
        )}
        {isExhibitionsView && exhibitions.length > 0 && !exhibitionReorderMode && (
          <div
            className="flex flex-wrap items-center gap-2"
            data-tour="public-profile-exhibitions-controls"
          >
            <ExhibitionSortDropdown
              value={exhibitionSortMode}
              onChange={setExhibitionSortMode}
              showManual={exhibitionOrderMap.size > 0}
            />
            {isOwner && exhibitions.length >= 2 && (
              <button
                type="button"
                onClick={handleExhibitionReorderStart}
                aria-label={t("exhibition.reorder.start")}
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-300 bg-white px-4 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                <svg
                  aria-hidden
                  viewBox="0 0 16 16"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 5h8M4 8h8M4 11h8" />
                  <path d="M2 3l1.2 1.2M14 3l-1.2 1.2M2 13l1.2-1.2M14 13l-1.2-1.2" />
                </svg>
                {t("exhibition.reorder.start")}
              </button>
            )}
            {isOwner && exhibitionOrderMap.size > 0 && (
              <button
                type="button"
                onClick={handleExhibitionClearManual}
                disabled={exhibitionSaving}
                className="text-xs text-zinc-500 underline hover:text-zinc-700 disabled:opacity-50"
              >
                {t("exhibition.reorder.clear")}
              </button>
            )}
          </div>
        )}
        {isExhibitionsView && exhibitionReorderMode && isOwner && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleExhibitionReorderSave}
              disabled={exhibitionSaving}
              className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {t("exhibition.reorder.save")}
            </button>
            <button
              type="button"
              onClick={handleExhibitionReorderCancel}
              disabled={exhibitionSaving}
              className="rounded-full border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            >
              {t("exhibition.reorder.cancel")}
            </button>
          </div>
        )}
      </div>
      {!isExhibitionsView && reorderMode && isOwner && (
        <p className="mb-4 text-sm text-zinc-500">{t("profile.reorderHint")}</p>
      )}
      {isExhibitionsView && exhibitionReorderMode && isOwner && (
        <p className="mb-4 text-sm text-zinc-500">{t("exhibition.reorder.hint")}</p>
      )}
      {isExhibitionsView ? (
        exhibitions.length === 0 ? (
          isOwner ? (
            <Link
              href="/my/exhibitions/new"
              className="flex min-h-[8.5rem] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-zinc-300 bg-white text-zinc-500 transition-colors hover:border-zinc-400 hover:text-zinc-800"
            >
              <span aria-hidden className="text-2xl leading-none">+</span>
              <span className="text-sm font-medium">
                {t("profile.section.uploadExhibition")}
              </span>
            </Link>
          ) : (
            <EmptyState title={t("exhibition.emptyList")} size="sm" />
          )
        ) : exhibitionReorderMode && isOwner ? (
          <>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleExhibitionDragEnd}
            >
              <SortableContext
                items={exhibitionDraft.map((e) => e.id)}
                strategy={rectSortingStrategy}
              >
                <ul className="space-y-2">
                  {exhibitionDraft.map((ex) => (
                    <SortableExhibitionRow key={ex.id} exhibition={ex} />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
            {exhibitionSaveError && (
              <div className="mt-4 flex items-center gap-3 rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
                <span>
                  {t("exhibition.reorder.failed")}: {exhibitionSaveError}
                </span>
                <button
                  type="button"
                  onClick={handleExhibitionReorderSave}
                  disabled={exhibitionSaving}
                  className="rounded bg-red-600 px-3 py-1 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {t("common.retry")}
                </button>
              </div>
            )}
          </>
        ) : (
          <ul className="space-y-2">
            {sortedExhibitions.map((ex) => {
              const firstCover = (ex.cover_image_paths ?? [])[0];
              return (
                <li key={ex.id}>
                  <Link
                    href={`/e/${ex.id}`}
                    onClick={() => setExhibitionBack()}
                    className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-2.5 shadow-sm transition hover:border-zinc-300 hover:shadow-md"
                  >
                    <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-zinc-100">
                      {firstCover ? (
                        <Image
                          src={getArtworkImageUrl(firstCover, "thumb")}
                          alt=""
                          fill
                          className="object-cover"
                          sizes="56px"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-zinc-400">·</div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-zinc-900">{pickLocalizedTitle(ex, locale) || ex.title}</p>
                      <p className="truncate text-xs text-zinc-500">
                        {ex.start_date && ex.end_date ? `${ex.start_date} – ${ex.end_date}` : ex.start_date ?? ex.status}
                        {" · "}
                        {getExhibitionHostCuratorLabel(ex, t, locale)}
                      </p>
                      <p className="text-[11px] text-zinc-400">{t("exhibition.works")} →</p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )
      ) : reorderMode && isOwner && artworks.length > 0 ? (
        <>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={reorderableArtworks.map((a) => a.id)} strategy={rectSortingStrategy}>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {reorderableArtworks.map((artwork) => (
                  <SortableArtworkCard
                    key={artwork.id}
                    artwork={artwork}
                    likesCount={artwork.likes_count ?? 0}
                    isLiked={likedIds.has(artwork.id)}
                    viewerId={viewerId}
                    onLikeUpdate={(id, liked, count) => {
                      setLikedIds((prev) => {
                        const next = new Set(prev);
                        if (liked) next.add(id);
                        else next.delete(id);
                        return next;
                      });
                    }}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          {saveError && (
            <div className="mt-4 flex items-center gap-3 rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
              <span>{t("profile.reorderSaveFailed")}: {saveError}</span>
              <button
                type="button"
                onClick={handleSaveReorder}
                disabled={saving}
                className="rounded bg-red-600 px-3 py-1 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {t("common.retry")}
              </button>
            </div>
          )}
        </>
      ) : displayedArtworks.length === 0 ? (
        roleTab === "collector" ? (
          <EmptyState title={t("profile.collectorEmpty")} size="sm" />
        ) : isOwner && !isExhibitionsView ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <UploadYourWorkTile label={t("profile.section.uploadYourWork")} />
          </div>
        ) : (
          <EmptyState title={t("profile.noWorks")} size="sm" />
        )
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {roleTab === "artist" &&
            isOwner &&
            !isExhibitionsView &&
            active.kind === "persona" &&
            (active.tab === "all" || active.tab === "CREATED") && (
              <UploadYourWorkTile label={t("profile.section.uploadYourWork")} />
            )}
          {displayedArtworks.map((artwork) => (
            <div key={artwork.id} className="relative">
              {tabAssignMode && (
                <div className="absolute left-2 top-2 z-10">
                  <input
                    type="checkbox"
                    checked={tabAssignIds.has(artwork.id)}
                    onChange={() => {
                      setTabAssignIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(artwork.id)) next.delete(artwork.id);
                        else next.add(artwork.id);
                        return next;
                      });
                    }}
                    className="h-5 w-5 rounded border-zinc-300"
                    aria-label={t("my.bulkSelect.select")}
                  />
                </div>
              )}
              <ArtworkCard
                artwork={artwork}
                likesCount={artwork.likes_count ?? 0}
                isLiked={likedIds.has(artwork.id)}
                showEdit={
                  !tabAssignMode &&
                  isOwner &&
                  !!profile?.id &&
                  canEditArtwork(artwork, profile.id)
                }
                viewerId={viewerId}
                onLikeUpdate={(id, liked, count) => {
                  setLikedIds((prev) => {
                    const next = new Set(prev);
                    if (liked) next.add(id);
                    else next.delete(id);
                    return next;
                  });
                }}
              />
            </div>
          ))}
        </div>
      )}
      {savedToast && (
        <div className="fixed bottom-4 right-4 rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg">
          {savedToastMsg ?? t("common.saved")}
        </div>
      )}
      </PageShell>
    </>
  );
}

function UploadYourWorkTile({ label }: { label: string }) {
  return (
    <Link
      href="/upload"
      className="flex aspect-square w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-zinc-300 bg-white text-zinc-500 transition-colors hover:border-zinc-400 hover:text-zinc-800"
    >
      <span aria-hidden className="text-3xl leading-none">+</span>
      <span className="text-sm font-medium">{label}</span>
    </Link>
  );
}
