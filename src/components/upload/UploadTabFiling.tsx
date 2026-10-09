"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/useT";
import { getMyProfile, getProfileById, lookupPublicProfileByUsername } from "@/lib/supabase/profiles";
import {
  canCreateArtistProfileTab,
  filingChannel,
  type KnownProfileTab,
  type UploadFilingChannel,
} from "@/lib/studio/profileContentKind";
import { parseActiveTabParam, parseStudioPortfolio } from "@/lib/studio/studioPortfolioConfig";

const KIND_LABEL: Record<string, string> = {
  artwork: "profile.kind.artwork",
  print_edition: "profile.kind.printEdition",
  art_goods: "profile.kind.artGoods",
  collected: "profile.kind.collected",
};

export type UploadTabSelection = {
  channel: UploadFilingChannel;
  actorProfileId: string;
  actorRoles: string[];
  entryTab: KnownProfileTab | null;
  sharedTab: KnownProfileTab | null;
  collectorTab: KnownProfileTab | null;
  artistTab: KnownProfileTab | null;
  cardChoices: KnownProfileTab[];
  canCreateOnArtist: boolean;
};

type ArtistRef = {
  id: string;
  username?: string | null;
} | null;

type Props = {
  tabParam: string | null;
  intent: string | null;
  actingAsProfileId: string | null;
  selectedArtist: ArtistRef;
  mode: "all" | "each";
  onMode: (mode: "all" | "each") => void;
  onSelection: (selection: UploadTabSelection) => void;
  /** Single upload has one work, so the per-card choice stays hidden. */
  allowEach?: boolean;
};

function tabsOf(
  profileId: string,
  details: Record<string, unknown> | null | undefined,
  portfolioRaw?: Record<string, unknown> | null,
): KnownProfileTab[] {
  const portfolio = portfolioRaw
    ? parseStudioPortfolio({ studio_portfolio: portfolioRaw })
    : parseStudioPortfolio(details ?? null);
  return (portfolio.custom_tabs ?? []).map((tab) => ({
    id: tab.id,
    kind: tab.kind ?? "artwork",
    ownerProfileId: profileId,
    label: tab.label,
  }));
}

function TabSelect({
  label,
  tabs,
  value,
  onChange,
  emptyLabel,
}: {
  label: string;
  tabs: KnownProfileTab[];
  value: string;
  onChange: (id: string) => void;
  emptyLabel: string;
}) {
  const { t } = useT();
  return (
    <label className="block text-sm text-zinc-800">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-2 text-sm"
      >
        <option value="">{emptyLabel}</option>
        {tabs.map((tab) => (
          <option key={tab.id} value={tab.id}>
            {tab.label} · {t(KIND_LABEL[tab.kind] ?? KIND_LABEL.artwork)}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Tab choice at the start of upload.
 * A gallery or curator only sees tabs that already exist on the artist.
 * A collector picks one of their collected tabs and one existing artist tab.
 */
export function UploadTabFiling({
  tabParam,
  intent,
  actingAsProfileId,
  selectedArtist,
  mode,
  onMode,
  onSelection,
  allowEach = true,
}: Props) {
  const { t } = useT();
  const [actorProfileId, setActorProfileId] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [ownTabs, setOwnTabs] = useState<KnownProfileTab[]>([]);
  const [artistTabs, setArtistTabs] = useState<KnownProfileTab[]>([]);
  const [sharedId, setSharedId] = useState("");
  const [collectorId, setCollectorId] = useState("");
  const [artistTabId, setArtistTabId] = useState("");
  const onSelectionRef = useRef(onSelection);
  onSelectionRef.current = onSelection;

  useEffect(() => {
    let cancelled = false;
    const load = actingAsProfileId
      ? getProfileById(actingAsProfileId)
      : getMyProfile();
    void load.then(({ data }) => {
      if (cancelled || !data) return;
      const id = data.id;
      const nextRoles = [
        ...(data.roles ?? []),
        ...(data.main_role ? [data.main_role] : []),
      ];
      const tabs = tabsOf(id, data.profile_details ?? null);
      setActorProfileId(id);
      setRoles(nextRoles);
      setOwnTabs(tabs);
      const active = parseActiveTabParam(tabParam);
      if (active?.kind === "custom") {
        const entry = tabs.find((tab) => tab.id === active.id);
        if (entry) setSharedId(entry.id);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [actingAsProfileId, tabParam]);

  useEffect(() => {
    const username = selectedArtist?.username?.trim();
    const artistId = selectedArtist?.id?.trim();
    if (!username || !artistId) {
      setArtistTabs([]);
      return;
    }
    let cancelled = false;
    void lookupPublicProfileByUsername(username).then(({ data }) => {
      if (cancelled || !data || data.id !== artistId) return;
      setArtistTabs(tabsOf(data.id, null, data.studio_portfolio ?? null));
    });
    return () => {
      cancelled = true;
    };
  }, [selectedArtist?.id, selectedArtist?.username]);

  const uploadingForOther = !!selectedArtist?.id && selectedArtist.id !== actorProfileId;
  const channel = filingChannel({
    uploadingForOther,
    intent,
    roles,
  });
  const collectedTabs = ownTabs.filter((tab) => tab.kind === "collected");
  const sharedTab =
    channel === "own" ? ownTabs.find((tab) => tab.id === sharedId) ?? null : null;
  const collectorTab = collectedTabs.find((tab) => tab.id === collectorId) ?? null;
  const artistTab = artistTabs.find((tab) => tab.id === artistTabId) ?? null;
  const canCreateOnArtist = selectedArtist?.id
    ? canCreateArtistProfileTab({
        actorRoles: roles,
        targetProfileId: selectedArtist.id,
        actorProfileId,
      })
    : false;

  useEffect(() => {
    if (!actorProfileId) return;
    onSelectionRef.current({
      channel,
      actorProfileId,
      actorRoles: roles,
      entryTab: null,
      sharedTab,
      collectorTab,
      artistTab,
      cardChoices: channel === "own" ? ownTabs : artistTabs,
      canCreateOnArtist,
    });
  }, [
    actorProfileId,
    channel,
    roles,
    sharedTab,
    collectorTab,
    artistTab,
    ownTabs,
    artistTabs,
    canCreateOnArtist,
  ]);

  return (
    <div className="mb-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <p className="text-sm font-medium text-zinc-900">{t("profile.tabs.uploadHeading")}</p>
      {allowEach && (
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onMode("all")}
          className={`rounded-full px-3 py-1.5 text-xs ${
            mode === "all" ? "bg-zinc-900 text-white" : "border border-zinc-300 bg-white text-zinc-700"
          }`}
        >
          {t("profile.tabs.uploadAllOne")}
        </button>
        <button
          type="button"
          onClick={() => onMode("each")}
          className={`rounded-full px-3 py-1.5 text-xs ${
            mode === "each" ? "bg-zinc-900 text-white" : "border border-zinc-300 bg-white text-zinc-700"
          }`}
        >
          {t("profile.tabs.uploadEach")}
        </button>
      </div>
      )}
      {channel === "own" && mode === "all" && (
        <div className="mt-3">
          <TabSelect
            label={t("profile.tabs.uploadPick")}
            tabs={ownTabs}
            value={sharedId}
            onChange={setSharedId}
            emptyLabel={t("profile.tabs.uploadNone")}
          />
        </div>
      )}
      {channel === "gallery" && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-zinc-500">{t("profile.tabs.galleryExistingOnly")}</p>
          {mode === "all" && (
            <TabSelect
              label={t("profile.tabs.uploadArtistTab")}
              tabs={artistTabs}
              value={artistTabId}
              onChange={setArtistTabId}
              emptyLabel={t("profile.tabs.uploadNone")}
            />
          )}
        </div>
      )}
      {channel === "collector" && (
        <div className="mt-3 space-y-3">
          <TabSelect
            label={t("profile.tabs.uploadCollectorTab")}
            tabs={collectedTabs}
            value={collectorId}
            onChange={setCollectorId}
            emptyLabel={t("profile.tabs.uploadNone")}
          />
          {mode === "all" && (
            <TabSelect
              label={t("profile.tabs.uploadArtistTab")}
              tabs={artistTabs}
              value={artistTabId}
              onChange={setArtistTabId}
              emptyLabel={t("profile.tabs.uploadNone")}
            />
          )}
          <p className="text-xs text-zinc-500">{t("profile.tabs.collectorBoth")}</p>
        </div>
      )}
    </div>
  );
}
