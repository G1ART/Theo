// Sprint 6 Phase A — Persona Action Grammar.
//
// This module is intentionally light. It is *not* a permission system,
// not a CRM pipeline, and not a marketing funnel. It exists so the rest
// of the product can translate ambiguous art-world relationships into a
// small, respectful, repeatable vocabulary of actions.
//
// Core principle (mirrored in docs/product/PERSONA_ACTION_GRAMMAR.md):
//
//   Theo should not standardize the art world into a rigid CRM
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

// ─── Sprint 7 Phase A — First-Value Action selector ──────────────────
//
// `ActionPath` (above) is the static per-persona catalog used by the
// docs and the original Sprint 6 persona surface. Sprint 7 introduces
// a deterministic *selector* — `getFirstValueActions` — that picks ≤3
// actions for the `/my` FirstValuePathPanel using the current acting
// context and a small set of count signals. The selector is additive:
// the catalog above is preserved unchanged so any existing call sites
// (e.g. tests/persona-grammar.test.ts) keep passing byte-for-byte.
//
// Selection principles (work order §3 + Addendum §3):
//   - Deterministic priority — no AI ranking, no scoring.
//   - Max 3 returned.
//   - Never a dead "all clear" — if every basic is done, fall back to
//     a deeper-value action (visibility / room / relationship), never
//     an empty array.
//   - All hrefs land on existing routes (no new wizards).
//   - `actionKind` is allowlisted so telemetry can pin a stable label
//     without leaking action ids that contain user-meaningful nouns.

export type FirstValueActionKind =
  | "complete_profile"
  | "upload_artwork"
  | "add_artwork_context"
  | "review_visibility"
  | "create_room"
  | "review_access_requests"
  | "open_relationships"
  | "save_or_follow"
  | "request_access"
  | "review_inquiries";

export const FIRST_VALUE_ACTION_KINDS: readonly FirstValueActionKind[] = [
  "complete_profile",
  "upload_artwork",
  "add_artwork_context",
  "review_visibility",
  "create_room",
  "review_access_requests",
  "open_relationships",
  "save_or_follow",
  "request_access",
  "review_inquiries",
] as const;

export type FirstValueAction = {
  id: string;
  persona: PersonaMode;
  actionKind: FirstValueActionKind;
  titleKey: string;
  descriptionKey: string;
  href: string;
  /** Lower number = surfaced earlier. Stable across renders. */
  priority: number;
  /** Telemetry / analytics signal name (privacy-safe; no nouns). */
  completionSignal: string;
  /** Compile-time witness that this entry is safe to log. */
  telemetrySafe: true;
};

export type FirstValueSelectorInput = {
  personaMode: PersonaMode;
  actingAs: boolean;
  profileCompleteness?: number | null;
  artworkCount?: number | null;
  publicArtworkCount?: number | null;
  missingArtworkContextCount?: number | null;
  roomCount?: number | null;
  pendingAccessRequestCount?: number | null;
  relationshipCount?: number | null;
  hasPrivateNote?: boolean | null;
  savedOrFollowedCount?: number | null;
};

function n(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function build(
  persona: PersonaMode,
  partial: Omit<FirstValueAction, "persona" | "telemetrySafe">
): FirstValueAction {
  return { ...partial, persona, telemetrySafe: true };
}

// Per-persona catalogs. Each catalog is *unbounded* — the selector
// trims to 3 below based on signal-driven priority. Each entry uses
// existing routes; no new wizards required.

function artistCatalog(): FirstValueAction[] {
  return [
    build("artist", {
      id: "artist.complete_profile",
      actionKind: "complete_profile",
      titleKey: "firstValue.artist.completeProfile.title",
      descriptionKey: "firstValue.artist.completeProfile.desc",
      href: "/settings",
      priority: 10,
      completionSignal: "artist_profile_started",
    }),
    build("artist", {
      id: "artist.upload_artwork",
      actionKind: "upload_artwork",
      titleKey: "firstValue.artist.uploadArtwork.title",
      descriptionKey: "firstValue.artist.uploadArtwork.desc",
      href: "/upload",
      priority: 20,
      completionSignal: "artist_three_works_uploaded",
    }),
    build("artist", {
      id: "artist.add_artwork_context",
      actionKind: "add_artwork_context",
      titleKey: "firstValue.artist.addContext.title",
      descriptionKey: "firstValue.artist.addContext.desc",
      href: "/my/library",
      priority: 30,
      completionSignal: "artist_artwork_context_added",
    }),
    build("artist", {
      id: "artist.review_visibility",
      actionKind: "review_visibility",
      titleKey: "firstValue.artist.reviewVisibility.title",
      descriptionKey: "firstValue.artist.reviewVisibility.desc",
      href: "/my/visibility",
      priority: 40,
      completionSignal: "artist_first_visibility_set",
    }),
    build("artist", {
      id: "artist.create_room",
      actionKind: "create_room",
      titleKey: "firstValue.artist.createRoom.title",
      descriptionKey: "firstValue.artist.createRoom.desc",
      href: "/my/shortlists",
      priority: 50,
      completionSignal: "artist_first_room_created",
    }),
    build("artist", {
      id: "artist.open_relationships",
      actionKind: "open_relationships",
      titleKey: "firstValue.artist.openRelationships.title",
      descriptionKey: "firstValue.artist.openRelationships.desc",
      href: "/my/network?tab=relationships",
      priority: 60,
      completionSignal: "artist_relationship_desk_opened",
    }),
  ];
}

function galleryCatalog(): FirstValueAction[] {
  return [
    build("gallery", {
      id: "gallery.complete_profile",
      actionKind: "complete_profile",
      titleKey: "firstValue.gallery.completeProfile.title",
      descriptionKey: "firstValue.gallery.completeProfile.desc",
      href: "/settings",
      priority: 10,
      completionSignal: "gallery_profile_started",
    }),
    build("gallery", {
      id: "gallery.upload_artwork",
      actionKind: "upload_artwork",
      titleKey: "firstValue.gallery.uploadArtwork.title",
      descriptionKey: "firstValue.gallery.uploadArtwork.desc",
      href: "/upload",
      priority: 15,
      completionSignal: "gallery_inventory_started",
    }),
    build("gallery", {
      id: "gallery.create_room",
      actionKind: "create_room",
      titleKey: "firstValue.gallery.createRoom.title",
      descriptionKey: "firstValue.gallery.createRoom.desc",
      href: "/my/shortlists",
      priority: 20,
      completionSignal: "gallery_first_room_created",
    }),
    build("gallery", {
      id: "gallery.review_access_requests",
      actionKind: "review_access_requests",
      titleKey: "firstValue.gallery.reviewRequests.title",
      descriptionKey: "firstValue.gallery.reviewRequests.desc",
      href: "/my/network?tab=requests",
      priority: 25,
      completionSignal: "gallery_first_request_reviewed",
    }),
    build("gallery", {
      id: "gallery.open_relationships",
      actionKind: "open_relationships",
      titleKey: "firstValue.gallery.openRelationships.title",
      descriptionKey: "firstValue.gallery.openRelationships.desc",
      href: "/my/network?tab=relationships",
      priority: 30,
      completionSignal: "gallery_relationship_desk_opened",
    }),
    build("gallery", {
      id: "gallery.review_inquiries",
      actionKind: "review_inquiries",
      titleKey: "firstValue.gallery.reviewInquiries.title",
      descriptionKey: "firstValue.gallery.reviewInquiries.desc",
      href: "/my/inquiries",
      priority: 35,
      completionSignal: "gallery_inquiry_reviewed",
    }),
  ];
}

function curatorCatalog(): FirstValueAction[] {
  return [
    build("curator", {
      id: "curator.save_or_follow",
      actionKind: "save_or_follow",
      titleKey: "firstValue.curator.saveOrFollow.title",
      descriptionKey: "firstValue.curator.saveOrFollow.desc",
      href: "/people",
      priority: 10,
      completionSignal: "curator_first_save_or_follow",
    }),
    build("curator", {
      id: "curator.create_room",
      actionKind: "create_room",
      titleKey: "firstValue.curator.createRoom.title",
      descriptionKey: "firstValue.curator.createRoom.desc",
      href: "/my/shortlists",
      priority: 20,
      completionSignal: "curator_first_shortlist_created",
    }),
    build("curator", {
      // Sprint 7.1 Phase C — request_access is a *requester-side* action.
      // It is initiated from artwork / artist context, never from the
      // owner inbox. Route to /feed so the curator can surface a work
      // that earns the request.
      id: "curator.request_access",
      actionKind: "request_access",
      titleKey: "firstValue.curator.requestAccess.title",
      descriptionKey: "firstValue.curator.requestAccess.desc",
      href: "/feed",
      priority: 30,
      completionSignal: "curator_first_access_request_sent",
    }),
    build("curator", {
      id: "curator.open_relationships",
      actionKind: "open_relationships",
      titleKey: "firstValue.curator.openRelationships.title",
      descriptionKey: "firstValue.curator.openRelationships.desc",
      href: "/my/network?tab=relationships",
      priority: 40,
      completionSignal: "curator_relationship_desk_opened",
    }),
  ];
}

function collectorCatalog(): FirstValueAction[] {
  return [
    build("collector", {
      id: "collector.save_or_follow",
      actionKind: "save_or_follow",
      titleKey: "firstValue.collector.saveOrFollow.title",
      descriptionKey: "firstValue.collector.saveOrFollow.desc",
      href: "/",
      priority: 10,
      completionSignal: "collector_first_save_or_follow",
    }),
    build("collector", {
      id: "collector.review_inquiries",
      actionKind: "review_inquiries",
      titleKey: "firstValue.collector.reviewInquiries.title",
      descriptionKey: "firstValue.collector.reviewInquiries.desc",
      href: "/my/inquiries",
      priority: 20,
      completionSignal: "collector_inquiry_reviewed",
    }),
    build("collector", {
      // Sprint 7.1 Phase C — collectors request access from a saved
      // work or an artist surface, not from an owner inbox. Route to
      // /my/library so an existing save becomes the natural entry.
      id: "collector.request_access",
      actionKind: "request_access",
      titleKey: "firstValue.collector.requestAccess.title",
      descriptionKey: "firstValue.collector.requestAccess.desc",
      href: "/my/library",
      priority: 30,
      completionSignal: "collector_access_request_sent",
    }),
    build("collector", {
      id: "collector.open_relationships",
      actionKind: "open_relationships",
      titleKey: "firstValue.collector.openRelationships.title",
      descriptionKey: "firstValue.collector.openRelationships.desc",
      href: "/my/network?tab=relationships",
      priority: 40,
      completionSignal: "collector_relationship_desk_opened",
    }),
  ];
}

function multiCatalog(): FirstValueAction[] {
  return [
    build("multi_persona", {
      id: "multi.upload_artwork",
      actionKind: "upload_artwork",
      titleKey: "firstValue.multi.uploadArtwork.title",
      descriptionKey: "firstValue.multi.uploadArtwork.desc",
      href: "/upload",
      priority: 10,
      completionSignal: "multi_artwork_uploaded",
    }),
    build("multi_persona", {
      id: "multi.save_or_follow",
      actionKind: "save_or_follow",
      titleKey: "firstValue.multi.saveOrFollow.title",
      descriptionKey: "firstValue.multi.saveOrFollow.desc",
      href: "/",
      priority: 20,
      completionSignal: "multi_first_save_or_follow",
    }),
    build("multi_persona", {
      id: "multi.create_room",
      actionKind: "create_room",
      titleKey: "firstValue.multi.createRoom.title",
      descriptionKey: "firstValue.multi.createRoom.desc",
      href: "/my/shortlists",
      priority: 30,
      completionSignal: "multi_room_created",
    }),
    build("multi_persona", {
      id: "multi.open_relationships",
      actionKind: "open_relationships",
      titleKey: "firstValue.multi.openRelationships.title",
      descriptionKey: "firstValue.multi.openRelationships.desc",
      href: "/my/network?tab=relationships",
      priority: 40,
      completionSignal: "multi_relationship_desk_opened",
    }),
  ];
}

function catalogFor(persona: PersonaMode): FirstValueAction[] {
  switch (persona) {
    case "artist":
      return artistCatalog();
    case "gallery":
      return galleryCatalog();
    case "curator":
      return curatorCatalog();
    case "collector":
      return collectorCatalog();
    case "multi_persona":
      return multiCatalog();
  }
}

/**
 * Decide whether to drop an action because it represents work the
 * user has already done. We err on the side of *keeping* an action
 * if signals are missing (returns false), so a brand-new account
 * with all-zero counts still sees a guided panel rather than a
 * blank state.
 */
function isAlreadyDone(
  action: FirstValueAction,
  input: FirstValueSelectorInput
): boolean {
  switch (action.actionKind) {
    case "complete_profile":
      return n(input.profileCompleteness) >= 70;
    case "upload_artwork":
      return n(input.artworkCount) >= 3;
    case "add_artwork_context":
      // Only suppress if we know context was filled for *all* works.
      if (n(input.artworkCount) === 0) return true; // nothing to add to yet
      return n(input.missingArtworkContextCount) === 0;
    case "review_visibility":
      return n(input.publicArtworkCount) >= 1;
    case "create_room":
      return n(input.roomCount) >= 1;
    case "review_access_requests":
      // Always actionable when there's something pending; otherwise
      // suppress because there's nothing to review *right now*.
      return n(input.pendingAccessRequestCount) === 0;
    case "open_relationships":
      // Suppress when there are zero relationships — relationship
      // desk first becomes meaningful once at least one party has
      // engaged. Keep this as a "deeper" fallback rather than the
      // primary action for empty accounts.
      return n(input.relationshipCount) === 0 && !input.hasPrivateNote;
    case "save_or_follow":
      return n(input.savedOrFollowedCount) >= 3;
    case "request_access":
      return false;
    case "review_inquiries":
      return false;
  }
}

/**
 * Boost ordering for actions whose underlying signal is *active right
 * now* (e.g. there's a pending access request to review). Keeps the
 * panel responsive to today's context without breaking deterministic
 * priority.
 */
function urgencyBoost(
  action: FirstValueAction,
  input: FirstValueSelectorInput
): number {
  if (
    action.actionKind === "review_access_requests" &&
    n(input.pendingAccessRequestCount) > 0
  ) {
    return -100;
  }
  return 0;
}

/**
 * Deterministic selector. Returns at most 3 actions, never empty for
 * a known persona — falls back to deeper-value actions if the user
 * has cleared all early-stage work.
 */
export function getFirstValueActions(
  input: FirstValueSelectorInput
): FirstValueAction[] {
  const catalog = catalogFor(input.personaMode);

  const ranked = catalog
    .map((a) => ({
      a,
      done: isAlreadyDone(a, input),
      effective: a.priority + urgencyBoost(a, input),
    }))
    .sort((x, y) => x.effective - y.effective);

  // Pass 1: take up to 3 actions that are NOT already done.
  const fresh = ranked.filter((r) => !r.done).map((r) => r.a);
  if (fresh.length >= 3) return fresh.slice(0, 3);

  // Pass 2: top up with already-done actions only if there's literally
  // nothing else — but prefer to fall through to multi-persona deep
  // actions first (relationships / room / visibility) so we never end
  // in the dead "all clear" state. The multi catalog has open_relationships
  // / create_room / save_or_follow — re-emit those as deeper fallbacks
  // while keeping persona attribution.
  const fallbacks = catalogFor("multi_persona").filter(
    (a) =>
      a.actionKind === "open_relationships" ||
      a.actionKind === "create_room" ||
      a.actionKind === "save_or_follow"
  );

  const seen = new Set(fresh.map((a) => a.actionKind));
  const padded = [...fresh];
  for (const fb of fallbacks) {
    if (padded.length >= 3) break;
    if (!seen.has(fb.actionKind)) {
      padded.push({ ...fb, persona: input.personaMode });
      seen.add(fb.actionKind);
    }
  }

  // Pass 3: as a final defence, if we somehow still have <3, append
  // the highest-priority done actions just so the panel is never empty.
  if (padded.length < 3) {
    for (const r of ranked) {
      if (padded.length >= 3) break;
      if (!seen.has(r.a.actionKind)) {
        padded.push(r.a);
        seen.add(r.a.actionKind);
      }
    }
  }

  return padded.slice(0, 3);
}

/**
 * Helper for telemetry — strips the persona-action down to the
 * allowlisted, telemetry-safe shape. Source of truth for what may
 * cross the activation log boundary.
 */
export function toTelemetryActionPayload(action: FirstValueAction): {
  action_id: string;
  action_kind: FirstValueActionKind;
  persona_mode: PersonaMode;
} {
  return {
    action_id: action.id,
    action_kind: action.actionKind,
    persona_mode: action.persona,
  };
}
