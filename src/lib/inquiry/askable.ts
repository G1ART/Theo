/**
 * Whether this viewer can start a new price inquiry. The inquiry form exists
 * only while the price is on request, kept private, or held back from this
 * viewer; someone who is shown the price gets no new-inquiry button
 * (대표님 결정 public_price_inquire = hide_button). Takes the server's
 * per-viewer fields, never the stored price.
 */
export function inquiryFormOpens(view: {
  priceGated: boolean;
  pricingMode: string | null | undefined;
  isPricePublic: boolean | null | undefined;
}): boolean {
  return view.priceGated || view.pricingMode === "inquire" || view.isPricePublic === false;
}

/** The same rule on the per-viewer fields the server returns for a card. */
export function inquiryFormOpensForFields(fields: {
  price_gate?: unknown;
  pricing_mode?: unknown;
  is_price_public?: unknown;
}): boolean {
  return inquiryFormOpens({
    priceGated: Boolean(fields.price_gate),
    pricingMode: typeof fields.pricing_mode === "string" ? fields.pricing_mode : null,
    isPricePublic: typeof fields.is_price_public === "boolean" ? fields.is_price_public : null,
  });
}
