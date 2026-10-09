/**
 * Persona tab filtering for profile/My artworks.
 * CREATED (내 작품) = works this profile owns as the artist (`artist_id`),
 * even when a gallery or delegated account uploaded them.
 * A CREATED claim counts only when the work has no different owner.
 * OWNS/INVENTORY/CURATED = works where the profile has that claim type (lister).
 */
import type { ArtworkWithLikes } from "@/lib/supabase/artworks";
import {
  isProfileAllKind,
  normalizeProfileContentKind,
} from "@/lib/studio/profileContentKind";

export type PersonaTab = "all" | "exhibitions" | "CREATED" | "OWNS" | "INVENTORY" | "CURATED";

type ArtistWorkRef = {
  artist_id?: string | null;
  claims?: Array<{
    claim_type?: string | null;
    subject_profile_id?: string | null;
    artist_profile_id?: string | null;
  }> | null;
};

/**
 * 내 작품. The owner is the artist on the work, not the account that
 * uploaded it. Uploader and curator claims stay on the wider list.
 */
export function isOwnArtistWork(artwork: ArtistWorkRef, profileId: string): boolean {
  if (artwork.artist_id != null && artwork.artist_id === profileId) return true;
  if (artwork.artist_id != null) return false;
  return (artwork.claims ?? []).some(
    (claim) =>
      claim.claim_type === "CREATED" &&
      (claim.subject_profile_id === profileId || claim.artist_profile_id === profileId),
  );
}

function kindOf(artwork: ArtworkWithLikes) {
  return normalizeProfileContentKind(
    (artwork as ArtworkWithLikes & { work_kind?: string | null }).work_kind,
  );
}

export function filterArtworksByPersona(
  artworks: ArtworkWithLikes[],
  profileId: string,
  tab: PersonaTab
): ArtworkWithLikes[] {
  if (tab === "exhibitions") return artworks;
  if (tab === "all") return artworks.filter((a) => isProfileAllKind(kindOf(a)));
  if (tab === "CREATED") {
    return artworks.filter(
      (a) => isOwnArtistWork(a, profileId) && isProfileAllKind(kindOf(a)),
    );
  }
  return artworks.filter((a) => {
    const claims = a.claims ?? [];
    return claims.some(
      (c) => c.subject_profile_id === profileId && c.claim_type === tab
    );
  });
}

export function getPersonaCounts(artworks: ArtworkWithLikes[], profileId: string) {
  const all = artworks.filter((a) => isProfileAllKind(kindOf(a))).length;
  const created = artworks.filter(
    (a) => isOwnArtistWork(a, profileId) && isProfileAllKind(kindOf(a)),
  ).length;
  const owns = artworks.filter((a) =>
    (a.claims ?? []).some(
      (c) => c.subject_profile_id === profileId && c.claim_type === "OWNS"
    )
  ).length;
  const inventory = artworks.filter((a) =>
    (a.claims ?? []).some(
      (c) => c.subject_profile_id === profileId && c.claim_type === "INVENTORY"
    )
  ).length;
  const curated = artworks.filter((a) =>
    (a.claims ?? []).some(
      (c) => c.subject_profile_id === profileId && c.claim_type === "CURATED"
    )
  ).length;
  const exhibited = artworks.filter((a) =>
    (a.claims ?? []).some(
      (c) =>
        c.subject_profile_id === profileId &&
        (c.claim_type === "INVENTORY" || c.claim_type === "EXHIBITED")
    )
  ).length;
  return { all, created, owns, inventory, curated, exhibited };
}

export type AllBuckets = {
  created: ArtworkWithLikes[];
  curated: ArtworkWithLikes[];
  exhibited: ArtworkWithLikes[];
  owns: ArtworkWithLikes[];
};

/** Partition artworks into buckets for "전체" (all) tab. Each work appears in exactly one bucket (priority: created > curated > exhibited > owns). */
export function getArtworksByAllBuckets(
  artworks: ArtworkWithLikes[],
  profileId: string
): AllBuckets {
  const created: ArtworkWithLikes[] = [];
  const curated: ArtworkWithLikes[] = [];
  const exhibited: ArtworkWithLikes[] = [];
  const owns: ArtworkWithLikes[] = [];
  for (const a of artworks) {
    if (!isProfileAllKind(kindOf(a))) continue;
    if (isOwnArtistWork(a, profileId)) {
      created.push(a);
      continue;
    }
    const claims = a.claims ?? [];
    const types = new Set(claims.filter((c) => c.subject_profile_id === profileId).map((c) => c.claim_type));
    if (types.has("CURATED")) curated.push(a);
    else if (types.has("INVENTORY") || types.has("EXHIBITED")) exhibited.push(a);
    else if (types.has("OWNS")) owns.push(a);
  }
  return { created, curated, exhibited, owns };
}

export type PersonaTabItem = { tab: PersonaTab; count: number };

type Counts = { all: number; created: number; owns: number; inventory: number; curated: number; exhibited: number };
type RoleOptions = { main_role: string | null; roles: string[] };

const VALID_PERSONA_TABS: PersonaTab[] = ["all", "exhibitions", "CREATED", "OWNS", "INVENTORY", "CURATED"];

function isValidPersonaTab(x: unknown): x is PersonaTab {
  return typeof x === "string" && VALID_PERSONA_TABS.includes(x as PersonaTab);
}

/**
 * Returns persona tabs in role-based default order, optionally reordered by savedOrder.
 * savedOrder: optional array from profile_details.tab_order; only tabs present in default order are reordered.
 */
export function getOrderedPersonaTabs(
  counts: Counts,
  exhibitionsCount: number,
  options: RoleOptions,
  savedOrder?: PersonaTab[] | null
): PersonaTabItem[] {
  const defaultOrder = getOrderedPersonaTabsDefault(counts, exhibitionsCount, options);
  if (!savedOrder || !Array.isArray(savedOrder) || savedOrder.length === 0) {
    return defaultOrder;
  }
  const validSaved = savedOrder.filter(isValidPersonaTab);
  const defaultTabs = new Set(defaultOrder.map((o) => o.tab));
  const byTab = new Map(defaultOrder.map((o) => [o.tab, o]));
  const orderFromSaved = validSaved.filter((t) => defaultTabs.has(t));
  const rest = defaultOrder.filter((o) => !orderFromSaved.includes(o.tab));
  return orderFromSaved.map((tab) => byTab.get(tab)!).filter(Boolean).concat(rest);
}

function getOrderedPersonaTabsDefault(
  counts: Counts,
  exhibitionsCount: number,
  options: RoleOptions
): PersonaTabItem[] {
  const { main_role, roles } = options;
  const has = (r: string) => roles.includes(r) || main_role === r;
  const isArtist = counts.created > 0;
  const isCollector = counts.owns > 0 || has("collector");

  const exhibitionItem: PersonaTabItem | null =
    exhibitionsCount > 0 ? { tab: "exhibitions", count: exhibitionsCount } : null;
  const allItem: PersonaTabItem = { tab: "all", count: counts.all };
  const createdItem = counts.created > 0 ? { tab: "CREATED" as PersonaTab, count: counts.created } : null;
  const ownsItem = counts.owns > 0 ? { tab: "OWNS" as PersonaTab, count: counts.owns } : null;

  const filt = <T,>(arr: (T | null)[]): T[] => arr.filter((x): x is T => x != null);

  if (main_role === "collector" && isCollector) {
    return filt([ownsItem, exhibitionItem, allItem]);
  }

  if (main_role === "curator" || main_role === "gallerist") {
    return filt([exhibitionItem, allItem]);
  }

  if (isArtist) {
    return filt([allItem, exhibitionItem, createdItem, ownsItem]);
  }

  return filt([exhibitionItem, allItem]);
}
