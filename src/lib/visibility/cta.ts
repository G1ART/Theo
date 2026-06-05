// Sprint 5 — Gated CTA resolution.
//
// Given a server-resolved VisibilityResolution and the viewer's coarse
// relationship to the owner, decide which call-to-action the GatedField
// should render. Pure function — no side effects, no i18n (UI handles
// label translation via the returned `kind`).

import type {
  VisibilityResolution,
  ViewerRelationshipContext,
} from "./types";

export type GateCtaKind = "follow" | "inquiry" | "access_request" | "none";

export type GateCtaInput = {
  resolution: VisibilityResolution;
  fieldKey: string;
  viewerRelationship: ViewerRelationshipContext | null;
};

export type GateCtaResult = {
  kind: GateCtaKind;
  // For 'follow', whether the viewer already has a pending request
  // (so the UI can show "Requested" instead of "Follow").
  followStatus?: "none" | "pending" | "accepted";
  // For 'inquiry' / 'access_request', surface the request_mode that
  // produced this decision (for telemetry).
  resolvedFrom: "owner_override" | "audience_default" | "price_addon";
};

const PRICE_FIELDS = new Set(["price", "availability", "price_availability"]);

// Default rule (audience-based) when owner did not override request_mode:
//   public/signed_in     → none (already visible; should not gate)
//   followers            → follow
//   following            → none (viewer can't make owner follow them)
//   mutuals              → follow (then mutual will be reached organically)
//   approved             → access_request
//   owner_only           → none
//   delegates            → none
function audienceDefault(audience: string): GateCtaKind {
  switch (audience) {
    case "followers":
    case "mutuals":
      return "follow";
    case "approved":
      return "access_request";
    default:
      return "none";
  }
}

export function resolveGateCta(input: GateCtaInput): GateCtaResult {
  const { resolution, fieldKey, viewerRelationship } = input;

  // If viewer already passes, no CTA at all.
  if (resolution.canView) {
    return { kind: "none", resolvedFrom: "audience_default" };
  }

  // Owner override takes precedence.
  if (resolution.requestMode === "none") {
    return { kind: "none", resolvedFrom: "owner_override" };
  }
  if (resolution.requestMode === "inquiry") {
    return { kind: "inquiry", resolvedFrom: "owner_override" };
  }
  if (resolution.requestMode === "access_request") {
    return { kind: "access_request", resolvedFrom: "owner_override" };
  }

  // Audience-based default with the price-field add-on.
  let kind = audienceDefault(resolution.requiredAudience);

  // Price/availability fields always offer the inquiry path even when
  // the audience-based default would be "follow", so viewers always have
  // a respectful way to ask.
  if (PRICE_FIELDS.has(fieldKey) && kind === "none") {
    kind = "inquiry";
  } else if (PRICE_FIELDS.has(fieldKey) && kind === "follow") {
    // Keep follow as the primary CTA but the UI can additionally render
    // "Ask about this work" (handled in GatedField).
  }

  const followStatus =
    viewerRelationship?.follow_status ?? "none";

  return {
    kind,
    followStatus,
    resolvedFrom:
      PRICE_FIELDS.has(fieldKey) && kind === "inquiry"
        ? "price_addon"
        : "audience_default",
  };
}

// Companion helper: when kind === 'follow' for a price/availability field,
// the UI may want a secondary inquiry CTA. This returns true in that case.
export function shouldShowSecondaryInquiryCta(
  result: GateCtaResult,
  fieldKey: string
): boolean {
  return result.kind === "follow" && PRICE_FIELDS.has(fieldKey);
}
