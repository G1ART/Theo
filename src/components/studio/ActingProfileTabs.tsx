"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ProfileTabManager } from "@/components/profile/ProfileTabManager";
import { useT } from "@/lib/i18n/useT";
import { pickLocalizedArtworkTitle } from "@/lib/i18n/pickLocalized";
import type { PersonaTab } from "@/lib/provenance/personaTabs";
import { listPublicArtworksByArtistId } from "@/lib/supabase/artworks";
import { listMyExhibitions } from "@/lib/supabase/exhibitions";
import { getProfileById, type Profile } from "@/lib/supabase/profiles";
import { probeCanManageProfileTabs } from "@/lib/studio/persistStudioPortfolio";
import {
  type ActiveStudioTab,
  buildStudioStripTabs,
  filterStripForPublicView,
  parseStudioPortfolio,
} from "@/lib/studio/studioPortfolioConfig";

/**
 * Tab management for an account the operator is acting as.
 * Mounted on the workspace only. The public profile does not use this.
 */
export function ActingProfileTabs({ profileId }: { profileId: string }) {
  const { t, locale } = useT();
  const [allowed, setAllowed] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [artworks, setArtworks] = useState<
    Awaited<ReturnType<typeof listPublicArtworksByArtistId>>["data"]
  >([]);
  const [exhibitionsCount, setExhibitionsCount] = useState(0);
  const [active, setActive] = useState<ActiveStudioTab>({ kind: "persona", tab: "all" });
  const [toast, setToast] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    const ok = await probeCanManageProfileTabs(profileId, profileId);
    if (!ok) return { ok: false as const };
    const [profileRes, artRes, exRes] = await Promise.all([
      getProfileById(profileId),
      listPublicArtworksByArtistId(profileId, { limit: null }),
      listMyExhibitions({ forProfileId: profileId }),
    ]);
    if (!profileRes.data) return { ok: false as const };
    return {
      ok: true as const,
      profile: profileRes.data,
      artworks: artRes.data ?? [],
      exhibitionsCount: exRes.data?.length ?? 0,
    };
  }, [profileId]);

  useEffect(() => {
    setAllowed(false);
    setProfile(null);
  }, [profileId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await load();
      if (cancelled) return;
      if (!next.ok) {
        setAllowed(false);
        setProfile(null);
        return;
      }
      setAllowed(true);
      setProfile(next.profile);
      setArtworks(next.artworks);
      setExhibitionsCount(next.exhibitionsCount);
    })();
    return () => {
      cancelled = true;
    };
  }, [load, reloadKey]);

  const portfolio = useMemo(
    () => parseStudioPortfolio(profile?.profile_details ?? null),
    [profile?.profile_details],
  );
  const roles = (profile?.roles ?? []) as string[];
  const defaultTabLabels: Record<PersonaTab, string> = useMemo(
    () => ({
      all: t("profile.personaAll"),
      exhibitions: t("exhibition.myExhibitions"),
      CREATED: t("profile.personaWork"),
      OWNS: t("profile.personaCollected"),
      INVENTORY: t("profile.personaGallery"),
      CURATED: t("profile.personaCurated"),
    }),
    [t],
  );
  const stripRows = useMemo(() => {
    if (!profile) return [];
    return buildStudioStripTabs({
      profileId: profile.id,
      artworks,
      exhibitionsCount,
      mainRole: profile.main_role ?? null,
      roles,
      portfolio,
      rootProfileDetails: profile.profile_details,
      defaultTabLabels,
    });
  }, [artworks, defaultTabLabels, exhibitionsCount, portfolio, profile, roles]);
  const stripPublic = useMemo(() => filterStripForPublicView(stripRows), [stripRows]);

  if (!allowed || !profile) return null;

  return (
    <section className="mb-6 rounded-2xl border border-zinc-200 bg-white px-4 py-3">
      <h2 className="mb-2 text-sm font-semibold text-zinc-900">
        {t("studio.portfolio.manageTabs")}
      </h2>
      <ProfileTabManager
        canManage
        actingProfileId={profileId}
        stripPublic={stripPublic}
        stripRows={stripRows}
        active={active}
        onActiveChange={setActive}
        portfolio={portfolio}
        defaultTabLabels={defaultTabLabels}
        profileId={profile.id}
        works={artworks.map((artwork) => ({
          id: artwork.id,
          title: pickLocalizedArtworkTitle(artwork, locale) || artwork.title || artwork.id,
          artistId: artwork.artist_id,
        }))}
        onPersisted={() => setReloadKey((n) => n + 1)}
        onToast={(msg) => setToast(msg)}
      />
      {toast && (
        <p role="status" className="mt-2 text-xs text-zinc-600">
          {toast}
        </p>
      )}
    </section>
  );
}
