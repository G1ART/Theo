/**
 * Guided tour registry.
 *
 * This is the single source of truth for all onboarding tours. Each tour
 * is keyed by `id`, renders copy via i18n keys, and is rebroadcast to
 * returning users only when its numeric `version` is bumped.
 *
 * Guidelines for adding / editing tours:
 *   - keep steps short (ideally 4–7)
 *   - put all copy behind i18n keys so KR/EN stay natural
 *   - use stable `data-tour` anchors, not CSS/text selectors
 *   - bump `version` when copy or step list changes in a way returning
 *     users should see again
 */

import type { TourDefinition } from "./tourTypes";

export const TOUR_IDS = {
  studio: "studio.main",
  upload: "upload.main",
  exhibitionCreate: "exhibition.create",
  exhibitionDetail: "exhibition.detail",
  boardDetail: "board.detail",
  profileIdentity: "profile.identity",
  people: "people.main",
  delegation: "delegation.main",
  network: "network.main",
  publicProfile: "profile.public",
} as const;

export type TourId = (typeof TOUR_IDS)[keyof typeof TOUR_IDS];

export const TOURS: Record<TourId, TourDefinition> = {
  [TOUR_IDS.studio]: {
    id: TOUR_IDS.studio,
    // v10: surface the Sprint 6.2 Network Hub pill on the hero action
    // row so returning users learn that the former /my/relationships
    // and /my/access-requests pages now live as tabs inside
    // /my/network. The dot on the pill is a calm presence signal —
    // never a numeric count — and the tour explains exactly that.
    version: 10,
    titleKey: "tour.studio.title",
    introKey: "tour.studio.intro",
    requiredAnchors: ["studio-hero", "studio-operating-grid"],
    steps: [
      {
        id: "hero",
        target: "studio-hero",
        titleKey: "tour.studio.hero.title",
        bodyKey: "tour.studio.hero.body",
        placement: "bottom",
      },
      {
        id: "network",
        target: "studio-network",
        titleKey: "tour.studio.network.title",
        bodyKey: "tour.studio.network.body",
        placement: "bottom",
      },
      {
        id: "visibility",
        target: "studio-visibility-hub",
        titleKey: "tour.studio.visibility.title",
        bodyKey: "tour.studio.visibility.body",
        placement: "bottom",
      },
      {
        id: "next-steps",
        target: "studio-next-steps",
        titleKey: "tour.studio.nextSteps.title",
        bodyKey: "tour.studio.nextSteps.body",
        placement: "left",
      },
      {
        id: "grid",
        target: "studio-operating-grid",
        titleKey: "tour.studio.grid.title",
        bodyKey: "tour.studio.grid.body",
        placement: "top",
      },
      {
        id: "workshop",
        target: "studio-card-workshop",
        titleKey: "tour.studio.workshop.title",
        bodyKey: "tour.studio.workshop.body",
        placement: "right",
      },
      {
        id: "boards",
        target: "studio-card-boards",
        titleKey: "tour.studio.boards.title",
        bodyKey: "tour.studio.boards.body",
        placement: "right",
      },
      {
        id: "exhibitions",
        target: "studio-card-exhibitions",
        titleKey: "tour.studio.exhibitions.title",
        bodyKey: "tour.studio.exhibitions.body",
        placement: "right",
      },
      {
        id: "public-works",
        target: "studio-portfolio-tab-strip",
        titleKey: "tour.studio.publicWorks.title",
        bodyKey: "tour.studio.publicWorks.body",
        placement: "bottom",
      },
      {
        id: "portfolio-tabs",
        target: "studio-portfolio-tab-strip",
        titleKey: "tour.studio.portfolioTabs.title",
        bodyKey: "tour.studio.portfolioTabs.body",
        placement: "bottom",
      },
      // v8: surface AI helpers explicitly so users learn that nothing
      // auto-publishes/edits and the cards are review-first companions.
      // Anchor only renders for non-acting-as principals; framework will
      // silently skip it when the section is not mounted.
      {
        id: "ai-helpers",
        target: "studio-ai-helpers",
        titleKey: "tour.studio.aiHelpers.title",
        bodyKey: "tour.studio.aiHelpers.body",
        placement: "top",
      },
    ],
  },

  [TOUR_IDS.upload]: {
    id: TOUR_IDS.upload,
    version: 3,
    titleKey: "tour.upload.title",
    introKey: "tour.upload.intro",
    requiredAnchors: ["upload-tabs"],
    steps: [
      {
        id: "tabs",
        target: "upload-tabs",
        titleKey: "tour.upload.tabs.title",
        bodyKey: "tour.upload.tabs.body",
        placement: "bottom",
      },
      {
        id: "single",
        target: "upload-tab-single",
        titleKey: "tour.upload.single.title",
        bodyKey: "tour.upload.single.body",
        placement: "bottom",
      },
      {
        id: "bulk",
        target: "upload-tab-bulk",
        titleKey: "tour.upload.bulk.title",
        bodyKey: "tour.upload.bulk.body",
        placement: "bottom",
      },
      {
        id: "exhibition",
        target: "upload-tab-exhibition",
        titleKey: "tour.upload.exhibition.title",
        bodyKey: "tour.upload.exhibition.body",
        placement: "bottom",
      },
      {
        id: "intent",
        target: "upload-intent-selector",
        titleKey: "tour.upload.intent.title",
        bodyKey: "tour.upload.intent.body",
        placement: "top",
      },
      // v3: explain website-assisted matching as a review-first helper.
      // Anchor lives on the bulk page only; framework filters this step
      // out elsewhere so the same tour stays valid across upload variants.
      {
        id: "website-import",
        target: "upload-website-import",
        titleKey: "tour.upload.websiteImport.title",
        bodyKey: "tour.upload.websiteImport.body",
        placement: "top",
      },
    ],
  },

  [TOUR_IDS.exhibitionCreate]: {
    id: TOUR_IDS.exhibitionCreate,
    version: 2,
    titleKey: "tour.exhibition.title",
    introKey: "tour.exhibition.intro",
    requiredAnchors: ["exhibition-form-title"],
    steps: [
      {
        id: "purpose",
        target: "exhibition-form-title",
        titleKey: "tour.exhibition.purpose.title",
        bodyKey: "tour.exhibition.purpose.body",
        placement: "bottom",
      },
      {
        id: "dates",
        target: "exhibition-form-dates",
        titleKey: "tour.exhibition.dates.title",
        bodyKey: "tour.exhibition.dates.body",
        placement: "top",
      },
      {
        id: "status",
        target: "exhibition-form-status",
        titleKey: "tour.exhibition.status.title",
        bodyKey: "tour.exhibition.status.body",
        placement: "top",
      },
      {
        id: "curator",
        target: "exhibition-form-curator",
        titleKey: "tour.exhibition.curator.title",
        bodyKey: "tour.exhibition.curator.body",
        placement: "top",
      },
    ],
  },

  [TOUR_IDS.people]: {
    id: TOUR_IDS.people,
    version: 2,
    titleKey: "tour.people.title",
    introKey: "tour.people.intro",
    requiredAnchors: ["people-search"],
    steps: [
      {
        id: "search",
        target: "people-search",
        titleKey: "tour.people.search.title",
        bodyKey: "tour.people.search.body",
        placement: "bottom",
      },
      {
        id: "lanes",
        target: "people-lane-tabs",
        titleKey: "tour.people.lanes.title",
        bodyKey: "tour.people.lanes.body",
        placement: "bottom",
      },
      {
        id: "roles",
        target: "people-role-filters",
        titleKey: "tour.people.roles.title",
        bodyKey: "tour.people.roles.body",
        placement: "bottom",
      },
      {
        id: "card",
        target: "people-card-actions",
        titleKey: "tour.people.card.title",
        bodyKey: "tour.people.card.body",
        placement: "top",
      },
    ],
  },

  [TOUR_IDS.delegation]: {
    id: TOUR_IDS.delegation,
    // v4: account switcher + per-form acting-as chip steps. Anchors are
    // optional (the framework silently skips a step when its anchor is
    // missing) so the same tour stays valid for users who land on the
    // hub without acting-as active.
    version: 4,
    titleKey: "tour.delegation.title",
    introKey: "tour.delegation.intro",
    requiredAnchors: ["delegation-header"],
    steps: [
      {
        id: "what",
        target: "delegation-header",
        titleKey: "tour.delegation.what.title",
        bodyKey: "tour.delegation.what.body",
        placement: "bottom",
      },
      {
        id: "wizard",
        target: "delegation-wizard-cta",
        titleKey: "tour.delegation.wizard.title",
        bodyKey: "tour.delegation.wizard.body",
        placement: "bottom",
      },
      {
        id: "received",
        target: "delegation-received",
        titleKey: "tour.delegation.received.title",
        bodyKey: "tour.delegation.received.body",
        placement: "bottom",
      },
      {
        id: "sent",
        target: "delegation-sent",
        titleKey: "tour.delegation.sent.title",
        bodyKey: "tour.delegation.sent.body",
        placement: "top",
      },
      {
        id: "acting",
        target: "acting-as-banner",
        titleKey: "tour.delegation.acting.title",
        bodyKey: "tour.delegation.acting.body",
        placement: "bottom",
      },
      {
        id: "account-switcher",
        target: "account-switcher",
        titleKey: "tour.delegation.accountSwitcher.title",
        bodyKey: "tour.delegation.accountSwitcher.body",
        placement: "left",
      },
      {
        id: "acting-as-chip",
        target: "acting-as-chip",
        titleKey: "tour.delegation.actingAsChip.title",
        bodyKey: "tour.delegation.actingAsChip.body",
        placement: "bottom",
      },
    ],
  },

  [TOUR_IDS.boardDetail]: {
    id: TOUR_IDS.boardDetail,
    version: 1,
    titleKey: "tour.boardDetail.title",
    introKey: "tour.boardDetail.intro",
    requiredAnchors: ["board-detail-header"],
    steps: [
      {
        id: "header",
        target: "board-detail-header",
        titleKey: "tour.boardDetail.header.title",
        bodyKey: "tour.boardDetail.header.body",
        placement: "bottom",
      },
      {
        id: "share",
        target: "board-detail-share",
        titleKey: "tour.boardDetail.share.title",
        bodyKey: "tour.boardDetail.share.body",
        placement: "bottom",
      },
      {
        id: "pitch-pack",
        target: "board-detail-pitch-pack",
        titleKey: "tour.boardDetail.pitchPack.title",
        bodyKey: "tour.boardDetail.pitchPack.body",
        placement: "top",
      },
      {
        id: "items",
        target: "board-detail-items",
        titleKey: "tour.boardDetail.items.title",
        bodyKey: "tour.boardDetail.items.body",
        placement: "top",
      },
    ],
  },

  [TOUR_IDS.exhibitionDetail]: {
    id: TOUR_IDS.exhibitionDetail,
    version: 1,
    titleKey: "tour.exhibitionDetail.title",
    introKey: "tour.exhibitionDetail.intro",
    requiredAnchors: ["exhibition-detail-header"],
    steps: [
      {
        id: "header",
        target: "exhibition-detail-header",
        titleKey: "tour.exhibitionDetail.header.title",
        bodyKey: "tour.exhibitionDetail.header.body",
        placement: "bottom",
      },
      {
        id: "review",
        target: "exhibition-detail-review",
        titleKey: "tour.exhibitionDetail.review.title",
        bodyKey: "tour.exhibitionDetail.review.body",
        placement: "top",
      },
      {
        id: "media",
        target: "exhibition-detail-media",
        titleKey: "tour.exhibitionDetail.media.title",
        bodyKey: "tour.exhibitionDetail.media.body",
        placement: "top",
      },
    ],
  },

  [TOUR_IDS.profileIdentity]: {
    id: TOUR_IDS.profileIdentity,
    version: 1,
    titleKey: "tour.profileIdentity.title",
    introKey: "tour.profileIdentity.intro",
    requiredAnchors: ["profile-identity-avatar"],
    steps: [
      {
        id: "avatar",
        target: "profile-identity-avatar",
        titleKey: "tour.profileIdentity.avatar.title",
        bodyKey: "tour.profileIdentity.avatar.body",
        placement: "bottom",
      },
      {
        id: "cover",
        target: "profile-identity-cover",
        titleKey: "tour.profileIdentity.cover.title",
        bodyKey: "tour.profileIdentity.cover.body",
        placement: "top",
      },
      {
        id: "bio",
        target: "profile-identity-bio",
        titleKey: "tour.profileIdentity.bio.title",
        bodyKey: "tour.profileIdentity.bio.body",
        placement: "top",
      },
      {
        id: "statement",
        target: "profile-identity-statement",
        titleKey: "tour.profileIdentity.statement.title",
        bodyKey: "tour.profileIdentity.statement.body",
        placement: "top",
      },
    ],
  },

  [TOUR_IDS.publicProfile]: {
    id: TOUR_IDS.publicProfile,
    version: 1,
    titleKey: "tour.publicProfile.title",
    introKey: "tour.publicProfile.intro",
    requiredAnchors: ["public-profile-tab-strip"],
    steps: [
      {
        id: "tabs",
        target: "public-profile-tab-strip",
        titleKey: "tour.publicProfile.tabs.title",
        bodyKey: "tour.publicProfile.tabs.body",
        placement: "bottom",
      },
      {
        id: "reorder-artworks",
        target: "public-profile-reorder-button",
        titleKey: "tour.publicProfile.reorderArtworks.title",
        bodyKey: "tour.publicProfile.reorderArtworks.body",
        placement: "bottom",
      },
      {
        id: "exhibitions",
        target: "public-profile-exhibitions-controls",
        titleKey: "tour.publicProfile.exhibitions.title",
        bodyKey: "tour.publicProfile.exhibitions.body",
        placement: "bottom",
      },
      {
        id: "studio-link",
        target: "public-profile-back-to-studio",
        titleKey: "tour.publicProfile.studioLink.title",
        bodyKey: "tour.publicProfile.studioLink.body",
        placement: "bottom",
      },
    ],
  },

  [TOUR_IDS.network]: {
    id: TOUR_IDS.network,
    // v3: surface the Sprint 6.2 hub upgrade — Relationships and
    // Access requests are now tabs inside /my/network alongside the
    // legacy Followers / Following tabs.
    // v4: tab order rebalanced to followers → following → requests →
    // relationships so the narrative reads inbound-then-history. The
    // tour step order was swapped (requests first, relationships
    // second) so returning users see the new flow at least once.
    version: 4,
    titleKey: "tour.network.title",
    introKey: "tour.network.intro",
    requiredAnchors: ["network-tabs"],
    steps: [
      {
        id: "tabs",
        target: "network-tabs",
        titleKey: "tour.network.tabs.title",
        bodyKey: "tour.network.tabs.body",
        placement: "bottom",
      },
      // The follow-graph tabs render `network-search` / `network-list`
      // (LaneChips for query + alpha/recent sort, then the rows). The
      // framework silently skips the step when its anchor is not in
      // the DOM, so on the Relationships / Requests tabs these two
      // steps are dropped naturally.
      {
        id: "search",
        target: "network-search",
        titleKey: "tour.network.search.title",
        bodyKey: "tour.network.search.body",
        placement: "bottom",
      },
      {
        id: "list",
        target: "network-list",
        titleKey: "tour.network.list.title",
        bodyKey: "tour.network.list.body",
        placement: "top",
      },
      // Sprint 6.2 — Requests tab first, Relationships tab second.
      // Mirrors the visible tab order (followers → following →
      // requests → relationships) and the narrative ordering in the
      // guide copy: a request is the inbound prompt; an approved
      // request grows into a relationship. The panel anchors below
      // are mounted only when the matching tab is active, so the
      // framework auto-skips the inactive one.
      {
        id: "requests",
        target: "network-requests-panel",
        titleKey: "tour.network.requests.title",
        bodyKey: "tour.network.requests.body",
        placement: "top",
      },
      {
        id: "relationships",
        target: "network-relationships-panel",
        titleKey: "tour.network.relationships.title",
        bodyKey: "tour.network.relationships.body",
        placement: "top",
      },
      // Sprint 6.2 — explain the dot badge on the studio header pill
      // that brings users here. Anchors on `studio-network` which is
      // only rendered on /my; framework skips the step on /my/network.
      {
        id: "activity-dot",
        target: "studio-network",
        titleKey: "tour.network.activityDot.title",
        bodyKey: "tour.network.activityDot.body",
        placement: "bottom",
      },
    ],
  },
};

export function getTour(id: TourId | string): TourDefinition | null {
  return (TOURS as Record<string, TourDefinition>)[id] ?? null;
}
