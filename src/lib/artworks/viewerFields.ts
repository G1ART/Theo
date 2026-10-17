/**
 * Price and availability as the current viewer may see them.
 *
 * Reads go through `public.artwork_cards`, whose `viewer_fields` jsonb is
 * built by `artwork_viewer_fields(id)` on the server: sold is public,
 * price and other availability follow the owner's visibility policy,
 * editors see stored values. This module only copies that judged object
 * onto the familiar row keys so card, search and price helpers keep
 * reading `ownership_status`, `pricing_mode`, `price_*`.
 */

export const ARTWORK_CARDS_VIEW = "artwork_cards";

export type ArtworkVisibilityGate = {
  required_audience: string | null;
  request_mode: string | null;
};

export const VIEWER_FIELD_KEYS = [
  "ownership_status",
  "pricing_mode",
  "is_price_public",
  "price_usd",
  "price_input_amount",
  "price_input_currency",
  "fx_rate_to_usd",
  "fx_date",
] as const;

export type ViewerFieldKey = (typeof VIEWER_FIELD_KEYS)[number];

export type ViewerFields = Partial<Record<ViewerFieldKey, unknown>> & {
  price_gate?: ArtworkVisibilityGate | null;
  availability_gate?: ArtworkVisibilityGate | null;
};

function asGate(value: unknown): ArtworkVisibilityGate | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { required_audience?: unknown; request_mode?: unknown };
  return {
    required_audience: typeof v.required_audience === "string" ? v.required_audience : null,
    request_mode: typeof v.request_mode === "string" ? v.request_mode : null,
  };
}

function asNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Judged fields only. A missing object means the viewer may not see the row's values. */
export function readViewerFields(value: unknown): ViewerFields {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    ownership_status: typeof raw.ownership_status === "string" ? raw.ownership_status : null,
    pricing_mode: typeof raw.pricing_mode === "string" ? raw.pricing_mode : null,
    is_price_public: typeof raw.is_price_public === "boolean" ? raw.is_price_public : null,
    price_usd: asNumber(raw.price_usd),
    price_input_amount: asNumber(raw.price_input_amount),
    price_input_currency: typeof raw.price_input_currency === "string" ? raw.price_input_currency : null,
    fx_rate_to_usd: asNumber(raw.fx_rate_to_usd),
    fx_date: typeof raw.fx_date === "string" ? raw.fx_date : null,
    price_gate: asGate(raw.price_gate),
    availability_gate: asGate(raw.availability_gate),
  };
}

/**
 * Copy `viewer_fields` onto the row and drop the jsonb. Rows read without
 * `viewer_fields` are returned unchanged.
 */
export function applyViewerFields<T extends Record<string, unknown>>(row: T): T {
  if (!row || !("viewer_fields" in row)) return row;
  const { viewer_fields: vf, ...rest } = row as T & { viewer_fields?: unknown };
  return { ...rest, ...readViewerFields(vf) } as unknown as T;
}

/** Replace judged fields on rows that already exist (e.g. server-rendered lists refreshed for the signed-in viewer). */
export function mergeViewerFields<T extends { id: string }>(
  rows: T[],
  byId: ReadonlyMap<string, ViewerFields>,
): T[] {
  if (byId.size === 0) return rows;
  let changed = false;
  const out = rows.map((row) => {
    const fields = byId.get(row.id);
    if (!fields) return row;
    changed = true;
    return { ...row, ...fields };
  });
  return changed ? out : rows;
}
