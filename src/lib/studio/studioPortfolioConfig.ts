/**
 * Studio portfolio tabs: optional renames, per-tab public visibility, custom tabs,
 * and strip order. Stored under profiles.profile_details.studio_portfolio (merged atomically).
 */
import type { ArtworkWithLikes } from "@/lib/supabase/artworks";
import {
  getOrderedPersonaTabs,
  getPersonaCounts,
  type PersonaTab,
  type PersonaTabItem,
} from "@/lib/provenance/personaTabs";

export const STUDIO_PORTFOLIO_KEY = "studio_portfolio";
export const CUSTOM_TAB_STRIP_PREFIX = "c:";

export const MAX_CUSTOM_TABS = 24;
export const MAX_TAB_LABEL_LEN = 48;
export const MAX_ARTWORK_IDS_PER_CUSTOM_TAB = 300;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const KNOWN_PERSONA: ReadonlySet<PersonaTab> = new Set([
  "all",
  "exhibitions",
  "CREATED",
  "OWNS",
  "INVENTORY",
  "CURATED",
]);

export type StudioCustomTabV1 = {
  id: string;
  label: string;
  public: boolean;
  artwork_ids: string[];
};

export type StudioPortfolioV1 = {
  version: 1;
  /** Ordered strip: PersonaTab values and `c:<uuid>` for custom tabs */
  tab_strip_order?: string[];
  tab_labels?: Partial<Record<PersonaTab, string>>;
  /** When omitted or key missing, tab is public on profile */
  tab_public?: Partial<Record<PersonaTab, boolean>>;
  custom_tabs?: StudioCustomTabV1[];
};

export type StudioStripTab = {
  kind: "persona" | "custom";
  /** Stable key: persona tab id or `custom:<uuid>` */
  key: string;
  personaTab?: PersonaTab;
  customId?: string;
  label: string;
  count: number;
  publicOnProfile: boolean;
};

function isPersonaTab(x: string): x is PersonaTab {
  return KNOWN_PERSONA.has(x as PersonaTab);
}

function parseUuid(s: string): string | null {
  const t = s.trim();
  return UUID_RE.test(t) ? t.toLowerCase() : null;
}

function stripCustomPrefix(entry: string): string | null {
  const e = entry.trim();
  if (!e.startsWith(CUSTOM_TAB_STRIP_PREFIX)) return null;
  return parseUuid(e.slice(CUSTOM_TAB_STRIP_PREFIX.length));
}

export function customTabStripToken(id: string): string {
  return `${CUSTOM_TAB_STRIP_PREFIX}${id}`;
}

function dedupeStrings(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** First occurrence of each artwork id wins (earlier tabs in array order). */
export function dedupeCustomTabMemberships(tabs: StudioCustomTabV1[]): StudioCustomTabV1[] {
  const claimed = new Set<string>();
  return tabs.map((tab) => {
    const next: string[] = [];
    for (const aid of tab.artwork_ids) {
      if (claimed.has(aid)) continue;
      claimed.add(aid);
      next.push(aid);
    }
    return { ...tab, artwork_ids: next };
  });
}

function normalizeLabel(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback.slice(0, MAX_TAB_LABEL_LEN);
  const t = raw.trim().slice(0, MAX_TAB_LABEL_LEN);
  return t.length > 0 ? t : fallback.slice(0, MAX_TAB_LABEL_LEN);
}

function normalizeCustomTabs(raw: unknown): StudioCustomTabV1[] {
  if (!Array.isArray(raw)) return [];
  const out: StudioCustomTabV1[] = [];
  const seenIds = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const o = row as Record<string, unknown>;
    const id = parseUuid(String(o.id ?? ""));
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    const label = normalizeLabel(o.label, "Tab");
    const pub = o.public !== false;
    const idsRaw = Array.isArray(o.artwork_ids) ? o.artwork_ids : [];
    const artwork_ids = dedupeStrings(
      idsRaw.filter((x): x is string => typeof x === "string" && x.length > 0)
    ).slice(0, MAX_ARTWORK_IDS_PER_CUSTOM_TAB);
    out.push({ id, label, public: pub, artwork_ids });
    if (out.length >= MAX_CUSTOM_TABS) break;
  }
  return dedupeCustomTabMemberships(out);
}

function normalizeTabLabels(raw: unknown): Partial<Record<PersonaTab, string>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: Partial<Record<PersonaTab, string>> = {};
  for (const k of Object.keys(o)) {
    if (!isPersonaTab(k)) continue;
    const v = o[k];
    if (typeof v !== "string") continue;
    const t = v.trim().slice(0, MAX_TAB_LABEL_LEN);
    if (t.length > 0) out[k as PersonaTab] = t;
  }
  return out;
}

function normalizeTabPublic(raw: unknown): Partial<Record<PersonaTab, boolean>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: Partial<Record<PersonaTab, boolean>> = {};
  for (const k of Object.keys(o)) {
    if (!isPersonaTab(k)) continue;
    if (typeof o[k] === "boolean") out[k as PersonaTab] = o[k] as boolean;
  }
  return out;
}

function normalizeStripOrder(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== "string") continue;
    const s = x.trim();
    if (isPersonaTab(s)) {
      out.push(s);
      continue;
    }
    const cid = stripCustomPrefix(s);
    if (cid) out.push(customTabStripToken(cid));
  }
  return out.length > 0 ? out : undefined;
}

export function parseStudioPortfolio(
  profileDetails: Record<string, unknown> | null | undefined
): StudioPortfolioV1 {
  const root = profileDetails ?? null;
  const raw = root?.[STUDIO_PORTFOLIO_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      version: 1,
      tab_strip_order: undefined,
      tab_labels: {},
      tab_public: {},
      custom_tabs: [],
    };
  }
  const o = raw as Record<string, unknown>;
  const version = o.version === 1 ? 1 : 1;
  return {
    version,
    tab_strip_order: normalizeStripOrder(o.tab_strip_order),
    tab_labels: normalizeTabLabels(o.tab_labels),
    tab_public: normalizeTabPublic(o.tab_public),
    custom_tabs: normalizeCustomTabs(o.custom_tabs),
  };
}

function personaOrderFromRoot(profileDetails: Record<string, unknown> | null | undefined): PersonaTab[] | undefined {
  const raw = profileDetails?.tab_order;
  if (!Array.isArray(raw)) return undefined;
  const out = raw.filter((x): x is PersonaTab => typeof x === "string" && isPersonaTab(x));
  return out.length > 0 ? out : undefined;
}

function personaSetFromItems(items: PersonaTabItem[]): Set<PersonaTab> {
  return new Set(items.map((i) => i.tab));
}

/**
 * Resolve full strip order: saved strip + legacy tab_order + defaults, with dedupe and append-missing.
 */
export function resolveTabStripOrderStrings(params: {
  portfolio: StudioPortfolioV1;
  personaItems: PersonaTabItem[];
  rootProfileDetails?: Record<string, unknown> | null;
}): string[] {
  const { portfolio, personaItems, rootProfileDetails } = params;
  const personaSet = personaSetFromItems(personaItems);
  const customById = new Map((portfolio.custom_tabs ?? []).map((t) => [t.id, t]));

  const fromSaved = (portfolio.tab_strip_order ?? []).filter((entry) => {
    if (isPersonaTab(entry)) return personaSet.has(entry);
    const cid = stripCustomPrefix(entry);
    return !!cid && customById.has(cid);
  });

  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const e of fromSaved) {
    if (seen.has(e)) continue;
    seen.add(e);
    ordered.push(e);
  }

  const legacyPersona = personaOrderFromRoot(rootProfileDetails ?? null);
  if (ordered.filter((e) => isPersonaTab(e)).length === 0 && legacyPersona?.length) {
    for (const tab of legacyPersona) {
      if (!personaSet.has(tab)) continue;
      const e = tab;
      if (seen.has(e)) continue;
      seen.add(e);
      ordered.push(e);
    }
  }

  for (const { tab } of personaItems) {
    if (seen.has(tab)) continue;
    seen.add(tab);
    ordered.push(tab);
  }
  for (const ct of portfolio.custom_tabs ?? []) {
    const e = customTabStripToken(ct.id);
    if (seen.has(e)) continue;
    seen.add(e);
    ordered.push(e);
  }
  return ordered;
}

function countForPersonaTab(tab: PersonaTab, personaItems: PersonaTabItem[]): number {
  return personaItems.find((i) => i.tab === tab)?.count ?? 0;
}

function countArtworksInCustomTab(
  tab: StudioCustomTabV1,
  artworkIds: Set<string>
): number {
  let n = 0;
  for (const id of tab.artwork_ids) {
    if (artworkIds.has(id)) n += 1;
  }
  return n;
}

export function buildStudioStripTabs(params: {
  profileId: string;
  artworks: ArtworkWithLikes[];
  exhibitionsCount: number;
  mainRole: string | null;
  roles: string[];
  portfolio: StudioPortfolioV1;
  rootProfileDetails?: Record<string, unknown> | null;
  defaultTabLabels: Record<PersonaTab, string>;
}): StudioStripTab[] {
  const {
    profileId,
    artworks,
    exhibitionsCount,
    mainRole,
    roles,
    portfolio,
    rootProfileDetails,
    defaultTabLabels,
  } = params;

  const counts = getPersonaCounts(artworks, profileId);
  const stripPersonaOrder = (() => {
    const fromStrip = (portfolio.tab_strip_order ?? []).filter((e) => isPersonaTab(e)) as PersonaTab[];
    if (fromStrip.length > 0) return fromStrip;
    return personaOrderFromRoot(rootProfileDetails ?? null);
  })();

  const personaItems = getOrderedPersonaTabs(
    counts,
    exhibitionsCount,
    { main_role: mainRole, roles },
    stripPersonaOrder
  );

  const stripStrings = resolveTabStripOrderStrings({
    portfolio,
    personaItems,
    rootProfileDetails,
  });

  const artworkIdSet = new Set(artworks.map((a) => a.id));
  const customById = new Map((portfolio.custom_tabs ?? []).map((t) => [t.id, t]));
  const tabLabels = portfolio.tab_labels ?? {};
  const tabPublic = portfolio.tab_public ?? {};

  const rows: StudioStripTab[] = [];
  for (const entry of stripStrings) {
    if (isPersonaTab(entry)) {
      const personaTab = entry;
      if (!personaItems.some((i) => i.tab === personaTab)) continue;
      const count = countForPersonaTab(personaTab, personaItems);
      rows.push({
        kind: "persona",
        key: personaTab,
        personaTab,
        label: tabLabels[personaTab] ?? defaultTabLabels[personaTab],
        count,
        publicOnProfile: tabPublic[personaTab] !== false,
      });
      continue;
    }
    const cid = stripCustomPrefix(entry);
    if (!cid) continue;
    const ct = customById.get(cid);
    if (!ct) continue;
    const count = countArtworksInCustomTab(ct, artworkIdSet);
    rows.push({
      kind: "custom",
      key: `custom:${cid}`,
      customId: cid,
      label: ct.label,
      count,
      publicOnProfile: ct.public !== false,
    });
  }
  return rows;
}

/** Visitor-facing strip: hide tabs the owner marked non-public. If all were hidden, fall back to "all" when it has works. */
export function filterStripForPublicView(strip: StudioStripTab[]): StudioStripTab[] {
  const pub = strip.filter((r) => r.publicOnProfile !== false);
  if (pub.length > 0) return pub;
  const allRow = strip.find((r) => r.kind === "persona" && r.personaTab === "all");
  if (allRow && allRow.count > 0) return [{ ...allRow, publicOnProfile: true }];
  const anyWorks = strip.find((r) => r.count > 0);
  return anyWorks ? [{ ...anyWorks, publicOnProfile: true }] : strip;
}

export function personaOrderForLegacySave(stripStrings: string[]): PersonaTab[] {
  return stripStrings.filter((e): e is PersonaTab => isPersonaTab(e));
}

export function buildSavePayload(portfolio: StudioPortfolioV1): Record<string, unknown> {
  const custom_tabs = dedupeCustomTabMemberships(portfolio.custom_tabs ?? []);
  const tab_strip_order = portfolio.tab_strip_order ?? [];
  const tab_order = personaOrderForLegacySave(tab_strip_order);
  return {
    [STUDIO_PORTFOLIO_KEY]: {
      version: 1,
      tab_strip_order,
      tab_labels: portfolio.tab_labels ?? {},
      tab_public: portfolio.tab_public ?? {},
      custom_tabs,
    },
    tab_order,
  };
}

export function newCustomTabId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function assignArtworksToCustomTab(params: {
  portfolio: StudioPortfolioV1;
  artworkIds: string[];
  targetCustomId: string | null;
}): StudioPortfolioV1 {
  const { portfolio, artworkIds, targetCustomId } = params;
  const idSet = new Set(artworkIds.filter(Boolean));
  let custom_tabs = (portfolio.custom_tabs ?? []).map((t) => ({
    ...t,
    artwork_ids: t.artwork_ids.filter((id) => !idSet.has(id)),
  }));
  if (targetCustomId) {
    custom_tabs = custom_tabs.map((t) => {
      if (t.id !== targetCustomId) return t;
      const next = dedupeStrings([...t.artwork_ids, ...Array.from(idSet)]);
      return { ...t, artwork_ids: next.slice(0, MAX_ARTWORK_IDS_PER_CUSTOM_TAB) };
    });
  }
  return { ...portfolio, custom_tabs: dedupeCustomTabMemberships(custom_tabs) };
}

export function removeCustomTab(portfolio: StudioPortfolioV1, customId: string): StudioPortfolioV1 {
  const custom_tabs = (portfolio.custom_tabs ?? []).filter((t) => t.id !== customId);
  const tab_strip_order = (portfolio.tab_strip_order ?? []).filter((e) => {
    const cid = stripCustomPrefix(e);
    return !cid || cid !== customId;
  });
  return { ...portfolio, custom_tabs, tab_strip_order };
}

export function addCustomTab(portfolio: StudioPortfolioV1, label: string): StudioPortfolioV1 {
  const tabs = portfolio.custom_tabs ?? [];
  if (tabs.length >= MAX_CUSTOM_TABS) return portfolio;
  const id = newCustomTabId();
  const tab: StudioCustomTabV1 = {
    id,
    label: normalizeLabel(label, "Tab"),
    public: true,
    artwork_ids: [],
  };
  const tab_strip_order = [...(portfolio.tab_strip_order ?? []), customTabStripToken(id)];
  return {
    ...portfolio,
    custom_tabs: [...tabs, tab],
    tab_strip_order,
  };
}

export type ActiveStudioTab =
  | { kind: "persona"; tab: PersonaTab }
  | { kind: "custom"; id: string };

export function parseActiveTabParam(raw: string | null): ActiveStudioTab | null {
  if (!raw) return null;
  const s = raw.trim();
  if (s === "exhibitions") return { kind: "persona", tab: "exhibitions" };
  if (s === "all") return { kind: "persona", tab: "all" };
  if (isPersonaTab(s)) return { kind: "persona", tab: s };
  if (s.startsWith("custom-")) {
    const id = parseUuid(s.slice("custom-".length));
    if (id) return { kind: "custom", id };
  }
  return null;
}

export function serializeActiveTabParam(active: ActiveStudioTab): string {
  if (active.kind === "persona") return active.tab;
  return `custom-${active.id}`;
}

export type ProfileTabAttachResult = {
  portfolio: StudioPortfolioV1;
  /** True when every new id is stored on the named custom tab. */
  attached: boolean;
  tabId: string | null;
  label: string | null;
};

/**
 * File new works into the custom tab the upload was started from.
 * 전체 and the other persona tabs are filters over the artist's works,
 * not membership lists, so they leave `custom_tabs` unchanged.
 * An unknown tab id does not create a tab and does not file anywhere.
 */
export function attachCreatedWorksToProfileTab(params: {
  portfolio: StudioPortfolioV1;
  artworkIds: string[];
  tabParam: string | null | undefined;
}): ProfileTabAttachResult {
  const unchanged: ProfileTabAttachResult = {
    portfolio: params.portfolio,
    attached: false,
    tabId: null,
    label: null,
  };
  const active = parseActiveTabParam(params.tabParam ?? null);
  if (!active || active.kind !== "custom") return unchanged;
  const tab = (params.portfolio.custom_tabs ?? []).find((t) => t.id === active.id);
  if (!tab) return unchanged;
  const ids = params.artworkIds.map((id) => id.trim()).filter((id) => id.length > 0);
  if (ids.length === 0) {
    return {
      portfolio: params.portfolio,
      attached: false,
      tabId: tab.id,
      label: tab.label,
    };
  }
  const portfolio = assignArtworksToCustomTab({
    portfolio: params.portfolio,
    artworkIds: ids,
    targetCustomId: tab.id,
  });
  const next = (portfolio.custom_tabs ?? []).find((t) => t.id === tab.id);
  const landed = ids.every((id) => (next?.artwork_ids ?? []).includes(id));
  return {
    portfolio,
    attached: landed,
    tabId: tab.id,
    label: tab.label,
  };
}

/** Profile "add work" entry. Persona tabs, including 전체, do not file into a custom tab. */
export function uploadHrefForActiveTab(active: ActiveStudioTab): string {
  if (active.kind !== "custom") return "/upload";
  return `/upload?tab=${encodeURIComponent(serializeActiveTabParam(active))}`;
}

/** After publish, own-profile return. Other-artist and exhibition returns stay with their callers. */
export function profileReturnPath(username: string, tabParam: string | null | undefined): string {
  const base = `/u/${username}`;
  const active = parseActiveTabParam(tabParam ?? null);
  if (!active || active.kind !== "custom") return base;
  return `${base}?tab=${encodeURIComponent(serializeActiveTabParam(active))}`;
}
