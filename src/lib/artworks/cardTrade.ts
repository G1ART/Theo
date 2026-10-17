import type { ArtworkVisibilityGate } from "@/lib/artworks/viewerFields";
import type { CardGateField } from "@/lib/visibility/copy";
import type { RelationshipAudience } from "@/lib/visibility/types";

const AUDIENCES: readonly RelationshipAudience[] = [
  "public",
  "signed_in",
  "followers",
  "following",
  "mutuals",
  "approved",
  "delegates",
  "owner_only",
];

export function asAudience(value: string | null | undefined): RelationshipAudience {
  return (AUDIENCES as readonly string[]).includes(value ?? "")
    ? (value as RelationshipAudience)
    : "owner_only";
}

export type CardTradeView = {
  /** Show `ownership_status` (judged; sold is always visible). */
  showStatus: boolean;
  /** Show the price line from `getArtworkPriceDisplay`. */
  showPrice: boolean;
  /** One muted line when something is held back for this viewer. */
  gate: { fieldKey: CardGateField; audience: RelationshipAudience } | null;
};

/**
 * What an artwork card shows under the title for this viewer. A sold
 * work shows "sold" alone: a held-back price on something that is no
 * longer for sale is not worth a line.
 */
export function cardTradeView(artwork: {
  ownership_status?: string | null;
  price_gate?: ArtworkVisibilityGate | null;
  availability_gate?: ArtworkVisibilityGate | null;
}): CardTradeView {
  const priceGated = Boolean(artwork.price_gate);
  const availGated = Boolean(artwork.availability_gate);
  const view: CardTradeView = { showStatus: !availGated, showPrice: !priceGated, gate: null };
  if (priceGated && availGated) {
    view.gate = {
      fieldKey: "price_availability",
      audience: asAudience(artwork.price_gate?.required_audience),
    };
  } else if (priceGated) {
    if (artwork.ownership_status !== "sold") {
      view.gate = { fieldKey: "price", audience: asAudience(artwork.price_gate?.required_audience) };
    }
  } else if (availGated) {
    view.gate = {
      fieldKey: "availability",
      audience: asAudience(artwork.availability_gate?.required_audience),
    };
  }
  return view;
}
