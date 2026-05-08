// Sprint 6 Phase A — Persona Action Grammar.
//
// This module is intentionally light. It is *not* a permission system,
// not a CRM pipeline, and not a marketing funnel. It exists so the rest
// of the product can translate ambiguous art-world relationships into a
// small, respectful, repeatable vocabulary of actions.
//
// Core principle (mirrored in docs/product/PERSONA_ACTION_GRAMMAR.md):
//
//   Abstract should not standardize the art world into a rigid CRM
//   pipeline. It should translate ambiguous art-world relationships
//   into small, respectful, repeatable product actions.
//
// Persona ≠ account type:
//   - The same operator can be an artist on Monday, a curator on Tuesday,
//     and a collector at the weekend. We model `PersonaMode` as a
//     *current intent context* the user can opt into for a session, NOT
//     as a permanent user category.
//   - There is no forced selection. If a user never picks a mode, the
//     product still works — it just doesn't show persona-targeted
//     copy.

export type PersonaMode =
  | "artist"
  | "gallery"
  | "curator"
  | "collector"
  | "multi_persona";

export const PERSONA_MODES: readonly PersonaMode[] = [
  "artist",
  "gallery",
  "curator",
  "collector",
  "multi_persona",
] as const;

// Action verbs — kept small. New verbs require a corresponding product
// surface; this is not a wishlist. Forbidden language (lead, prospect,
// pipeline, conversion, hot collector) is enforced both here (no such
// verbs exist) and via tests (see tests/persona-grammar.test.ts).
export type AbstractActionVerb =
  | "record_artwork"
  | "complete_profile"
  | "publish_work"
  | "create_room"
  | "share_room"
  | "request_access"
  | "ask_about_work"
  | "approve_access"
  | "decline_access"
  | "grant_access"
  | "save_work"
  | "follow_profile"
  | "open_relationship"
  | "add_private_note"
  | "follow_up";

export const ACTION_VERBS: readonly AbstractActionVerb[] = [
  "record_artwork",
  "complete_profile",
  "publish_work",
  "create_room",
  "share_room",
  "request_access",
  "ask_about_work",
  "approve_access",
  "decline_access",
  "grant_access",
  "save_work",
  "follow_profile",
  "open_relationship",
  "add_private_note",
  "follow_up",
] as const;

export type ActionPath = {
  /** Stable id for telemetry + i18n keying. */
  id: string;
  /** i18n key that resolves to a calm card title. */
  titleKey: string;
  /** i18n key that resolves to a one-line description. */
  descriptionKey: string;
  /** The primary product action (links to a route or opens a flow). */
  primary: {
    verb: AbstractActionVerb;
    /** Route or `modal:<id>` sentinel. */
    href: string;
    /** Telemetry event name fired on click. */
    event: string;
  };
  /** Optional secondary action — same shape, kept calm. */
  secondary?: {
    verb: AbstractActionVerb;
    href: string;
    event: string;
  };
  /** What "first value" looks like for this path. Used in onboarding
   *  copy and in success toasts. */
  successSignal: string;
};

/**
 * First-value paths per persona mode.
 *
 * "First value" = the smallest, most specific thing this persona could
 * do today that would feel meaningful in the art world (NOT the most
 * monetizable thing). Each path is intentionally deterministic — no
 * AI ranking, no scoring.
 */
export const FIRST_VALUE_PATHS: Record<PersonaMode, ActionPath[]> = {
  artist: [
    {
      id: "artist.record_first_work",
      titleKey: "persona.artist.recordFirstWork.title",
      descriptionKey: "persona.artist.recordFirstWork.desc",
      primary: {
        verb: "record_artwork",
        href: "/upload",
        event: "persona_action_card_clicked",
      },
      secondary: {
        verb: "complete_profile",
        href: "/my/edit",
        event: "persona_action_card_secondary_clicked",
      },
      successSignal: "first_artwork_recorded",
    },
    {
      id: "artist.prepare_private_viewing",
      titleKey: "persona.artist.preparePrivateViewing.title",
      descriptionKey: "persona.artist.preparePrivateViewing.desc",
      primary: {
        verb: "create_room",
        href: "/my/shortlists",
        event: "persona_action_card_clicked",
      },
      successSignal: "first_room_created",
    },
    {
      id: "artist.review_relationships",
      titleKey: "persona.artist.reviewRelationships.title",
      descriptionKey: "persona.artist.reviewRelationships.desc",
      primary: {
        verb: "open_relationship",
        href: "/my/network?tab=relationships",
        event: "persona_action_card_clicked",
      },
      successSignal: "relationship_desk_opened",
    },
  ],
  gallery: [
    {
      id: "gallery.organize_inventory",
      titleKey: "persona.gallery.organizeInventory.title",
      descriptionKey: "persona.gallery.organizeInventory.desc",
      primary: {
        verb: "record_artwork",
        href: "/my",
        event: "persona_action_card_clicked",
      },
      successSignal: "inventory_organized",
    },
    {
      id: "gallery.share_private_room",
      titleKey: "persona.gallery.sharePrivateRoom.title",
      descriptionKey: "persona.gallery.sharePrivateRoom.desc",
      primary: {
        verb: "share_room",
        href: "/my/shortlists",
        event: "persona_action_card_clicked",
      },
      successSignal: "first_room_shared",
    },
    {
      id: "gallery.review_requests",
      titleKey: "persona.gallery.reviewRequests.title",
      descriptionKey: "persona.gallery.reviewRequests.desc",
      primary: {
        verb: "approve_access",
        href: "/my/network?tab=requests",
        event: "persona_action_card_clicked",
      },
      secondary: {
        verb: "open_relationship",
        href: "/my/network?tab=relationships",
        event: "persona_action_card_secondary_clicked",
      },
      successSignal: "first_request_resolved",
    },
  ],
  curator: [
    {
      id: "curator.assemble_viewing",
      titleKey: "persona.curator.assembleViewing.title",
      descriptionKey: "persona.curator.assembleViewing.desc",
      primary: {
        verb: "create_room",
        href: "/my/shortlists",
        event: "persona_action_card_clicked",
      },
      successSignal: "viewing_assembled",
    },
    {
      id: "curator.continue_relationship",
      titleKey: "persona.curator.continueRelationship.title",
      descriptionKey: "persona.curator.continueRelationship.desc",
      primary: {
        verb: "open_relationship",
        href: "/my/network?tab=relationships",
        event: "persona_action_card_clicked",
      },
      secondary: {
        verb: "add_private_note",
        href: "/my/network?tab=relationships",
        event: "persona_action_card_secondary_clicked",
      },
      successSignal: "relationship_continued",
    },
  ],
  collector: [
    {
      id: "collector.discover_and_save",
      titleKey: "persona.collector.discoverAndSave.title",
      descriptionKey: "persona.collector.discoverAndSave.desc",
      primary: {
        verb: "save_work",
        href: "/",
        event: "persona_action_card_clicked",
      },
      successSignal: "first_work_saved",
    },
    {
      id: "collector.ask_about_work",
      titleKey: "persona.collector.askAboutWork.title",
      descriptionKey: "persona.collector.askAboutWork.desc",
      primary: {
        verb: "ask_about_work",
        href: "/my/inquiries",
        event: "persona_action_card_clicked",
      },
      successSignal: "first_inquiry_sent",
    },
    {
      id: "collector.follow_artist",
      titleKey: "persona.collector.followArtist.title",
      descriptionKey: "persona.collector.followArtist.desc",
      primary: {
        verb: "follow_profile",
        href: "/people",
        event: "persona_action_card_clicked",
      },
      successSignal: "first_artist_followed",
    },
  ],
  multi_persona: [
    {
      id: "multi.continue_recent_relationship",
      titleKey: "persona.multi.continueRecentRelationship.title",
      descriptionKey: "persona.multi.continueRecentRelationship.desc",
      primary: {
        verb: "open_relationship",
        href: "/my/network?tab=relationships",
        event: "persona_action_card_clicked",
      },
      successSignal: "relationship_continued",
    },
    {
      id: "multi.organize_works",
      titleKey: "persona.multi.organizeWorks.title",
      descriptionKey: "persona.multi.organizeWorks.desc",
      primary: {
        verb: "record_artwork",
        href: "/my",
        event: "persona_action_card_clicked",
      },
      successSignal: "works_organized",
    },
    {
      id: "multi.discover_and_save",
      titleKey: "persona.multi.discoverAndSave.title",
      descriptionKey: "persona.multi.discoverAndSave.desc",
      primary: {
        verb: "save_work",
        href: "/",
        event: "persona_action_card_clicked",
      },
      successSignal: "first_work_saved",
    },
  ],
};

/** Defensive helper for surfaces that don't know which persona they
 *  are looking at. Returns the multi-persona path so we never crash
 *  on a missing mode. */
export function getFirstValuePaths(mode: PersonaMode | null | undefined): ActionPath[] {
  if (mode && FIRST_VALUE_PATHS[mode]) return FIRST_VALUE_PATHS[mode];
  return FIRST_VALUE_PATHS.multi_persona;
}

// Forbidden vocabulary — mirrored in tests/persona-grammar.test.ts to
// guarantee we never accidentally introduce CRM/scoring language into
// persona copy or telemetry payloads.
export const FORBIDDEN_PERSONA_TERMS: readonly string[] = [
  "lead",
  "prospect",
  "high-value buyer",
  "high value buyer",
  "conversion",
  "pipeline velocity",
  "buyer intent score",
  "surveillance",
  "tracked viewer",
  "hot collector",
] as const;
