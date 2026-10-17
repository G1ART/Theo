/**
 * Natural-language filters for artwork search.
 *
 * Title, material, and story stay on the existing text search
 * (`findArtworkIdsForQuery` / `artworkMatchesSearch`). This module only
 * pulls size, price, sale, and goods/collected hints out of the same
 * line so those tokens are not required to appear in the title.
 * Numbers come from the query and from stored `width_cm` / `height_cm`
 * / `size` / `size_unit`. Price and sale use the values the server judged
 * for this viewer (`artwork_cards.viewer_fields`): a hidden price or
 * availability is null and never matches. A missing dimension is not filled in.
 */

import { hasPublicLinkableUsername } from "@/lib/identity/format";
import { parseSizeToDimensionsCm } from "@/lib/size/format";

export type SizeOp = "lt" | "lte" | "gt" | "gte" | "eq";
export type SizeAxis = "max" | "width" | "height" | "either";
export type SizeUnitLabel = "cm" | "in" | "mm";
export type PriceCurrency = "USD" | "KRW" | "EUR" | "GBP";
export type SaleIntent = "available" | "sold" | "not_for_sale" | "inquire";
export type KindMode = "default" | "goods" | "collected" | "goods-and-collected";

export type SizeBound = {
  cm: number;
  displayValue: number;
  displayUnit: SizeUnitLabel;
  op: SizeOp;
  axis: SizeAxis;
};

export type SizeBox = {
  widthCm: number;
  heightCm: number;
  a: number;
  b: number;
  unit: SizeUnitLabel;
  op: SizeOp;
};

export type PriceBound = {
  amount: number;
  currency: PriceCurrency | null;
  op: SizeOp;
};

export type ParsedArtworkQuery = {
  text: string;
  sizeBounds: SizeBound[];
  sizeBox: SizeBox | null;
  priceBounds: PriceBound[];
  sale: SaleIntent | null;
  includeGoods: boolean;
  includeCollected: boolean;
  kindMode: KindMode;
  hasConstraint: boolean;
};

export type ArtworkConstraintSource = {
  visibility?: string | null;
  work_kind?: string | null;
  width_cm?: number | string | null;
  height_cm?: number | string | null;
  size?: string | null;
  size_unit?: string | null;
  pricing_mode?: string | null;
  is_price_public?: boolean | null;
  price_usd?: number | string | null;
  price_input_amount?: number | string | null;
  price_input_currency?: string | null;
  fx_rate_to_usd?: number | string | null;
  ownership_status?: string | null;
};

const CMP =
  "less than|more than|greater than|at most|at least|or less|or more|under|below|over|above|이하|미만|이상|초과";
const AXIS = "가로|세로|너비|높이|width|height";
const UNIT = 'cm|mm|inches|inch|인치|in|"|″';
const NUM = "\\d+(?:\\.\\d+)?";
const MONEY_NUM = "\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?";
const MONEY_UNIT = "만\\s*원|만원|원|달러|dollars?|usd|krw|유로|euros?|eur|파운드|pounds?|gbp";
const SIZE_EQ_TOLERANCE_CM = 0.2;
const SIZE_INEQ_EPS_CM = 0.05;

const EMPTY: ParsedArtworkQuery = {
  text: "",
  sizeBounds: [],
  sizeBox: null,
  priceBounds: [],
  sale: null,
  includeGoods: false,
  includeCollected: false,
  kindMode: "default",
  hasConstraint: false,
};

function opOf(raw: string | undefined): SizeOp | null {
  if (!raw) return null;
  const s = raw.toLowerCase().replace(/\s+/g, " ").trim();
  if (s === "미만" || s === "less than") return "lt";
  if (s === "초과" || s === "more than" || s === "greater than") return "gt";
  if (s === "이하" || s === "under" || s === "below" || s === "at most" || s === "or less") return "lte";
  if (s === "이상" || s === "over" || s === "above" || s === "at least" || s === "or more") return "gte";
  return null;
}

function axisOf(raw: string | undefined): "width" | "height" | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (s === "가로" || s === "너비" || s === "width") return "width";
  if (s === "세로" || s === "높이" || s === "height") return "height";
  return null;
}

function unitOf(raw: string | undefined): SizeUnitLabel | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (s === "cm") return "cm";
  if (s === "mm") return "mm";
  if (s === "in" || s === "inch" || s === "inches" || s === '"' || s === "″" || s === "인치") return "in";
  return null;
}

function toCm(value: number, unit: SizeUnitLabel): number {
  if (unit === "mm") return value / 10;
  if (unit === "in") return value * 2.54;
  return value;
}

function positive(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function finiteNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function cut(text: string, start: number, end: number): string {
  return `${text.slice(0, start)} ${text.slice(end)}`.replace(/\s+/g, " ").trim();
}

function startOf(match: RegExpMatchArray): number {
  return match.index ?? 0;
}

function earliest(text: string, sources: string[]): RegExpMatchArray | null {
  let best: RegExpMatchArray | null = null;
  for (const source of sources) {
    const match = new RegExp(source, "i").exec(text);
    if (!match || match[0].length === 0) continue;
    const start = startOf(match);
    const bestStart = best ? startOf(best) : -1;
    if (!best || start < bestStart || (start === bestStart && match[0].length > best[0].length)) {
      best = match;
    }
  }
  return best;
}

function stripKinds(input: string): { text: string; includeGoods: boolean; includeCollected: boolean } {
  let includeGoods = false;
  let includeCollected = false;
  let text = input.replace(/아트\s*굿즈|art\s*goods|artgoods|굿즈|\bgoods\b/gi, () => {
    includeGoods = true;
    return " ";
  });
  text = text.replace(/소장품|collected(?:\s+works)?|(?:^|\s)소장(?=\s|$)/gi, () => {
    includeCollected = true;
    return " ";
  });
  return { text: text.replace(/\s+/g, " ").trim(), includeGoods, includeCollected };
}

function takeSize(text: string, parsed: ParsedArtworkQuery): string {
  const pair = `(?:(?<lead>${CMP})\\s+)?(?:(?<axis>${AXIS})\\s+)?(?<a>${NUM})\\s*(?:${UNIT})?(?![A-Za-z])\\s*[x×*]\\s*(?<b>${NUM})\\s*(?<unit>${UNIT})(?![A-Za-z])(?:\\s*(?<trail>${CMP}))?`;
  const pairLead = `(?:(?<lead>${CMP})\\s+)?(?:(?<axis>${AXIS})\\s+)?(?<a>${NUM})\\s*(?<unit>${UNIT})(?![A-Za-z])\\s*[x×*]\\s*(?<b>${NUM})(?!\\s*(?:${UNIT}))(?:\\s*(?<trail>${CMP}))?`;
  const axisThen = `(?<axis>${AXIS})\\s+(?<a>${NUM})\\s*(?<unit>${UNIT})(?![A-Za-z])(?:\\s*(?<trail>${CMP}))?`;
  const leadThen = `(?<lead>${CMP})\\s+(?:(?<axis>${AXIS})\\s+)?(?<a>${NUM})\\s*(?<unit>${UNIT})(?![A-Za-z])`;
  const bare = `(?<a>${NUM})\\s*(?<unit>${UNIT})(?![A-Za-z])(?:\\s*(?<trail>${CMP}))?`;
  const match = earliest(text, [pair, pairLead, axisThen, leadThen, bare]);
  if (!match?.groups) return text;
  const groups = match.groups;
  const unit = unitOf(groups.unit);
  const a = Number(groups.a);
  const b = groups.b != null ? Number(groups.b) : null;
  if (!unit || !Number.isFinite(a)) return text;
  const op = opOf(groups.trail) ?? opOf(groups.lead) ?? "eq";
  const axis = axisOf(groups.axis);
  if (b != null && Number.isFinite(b)) {
    if (!parsed.sizeBox) {
      parsed.sizeBox = {
        widthCm: toCm(a, unit),
        heightCm: toCm(b, unit),
        a,
        b,
        unit,
        op,
      };
    }
  } else if (parsed.sizeBounds.length < 4) {
    parsed.sizeBounds.push({
      cm: toCm(a, unit),
      displayValue: a,
      displayUnit: unit,
      op,
      axis: axis ?? (op === "eq" ? "either" : "max"),
    });
  }
  return cut(text, startOf(match), startOf(match) + match[0].length);
}

function currencyOf(unitRaw: string | undefined, symbol: string | undefined): PriceCurrency | null {
  const unit = (unitRaw ?? "").toLowerCase().replace(/\s+/g, "");
  if (unit === "만원") return "KRW";
  if (unit === "원" || unit === "krw" || symbol === "₩") return "KRW";
  if (unit === "달러" || unit === "dollar" || unit === "dollars" || unit === "usd" || symbol === "$") return "USD";
  if (unit === "유로" || unit === "eur" || unit === "euro" || unit === "euros" || symbol === "€") return "EUR";
  if (unit === "파운드" || unit === "gbp" || unit === "pound" || unit === "pounds" || symbol === "£") return "GBP";
  return null;
}

function takePrice(text: string, parsed: ParsedArtworkQuery): string {
  const amount = `(?:(?<symbol>\\$|₩|€|£)\\s*)?(?<amount>${MONEY_NUM})`;
  const labeled = `(?:(?<lead>${CMP})\\s+)?(?:가격|price)\\s+${amount}(?:\\s*(?<unit>${MONEY_UNIT}))?(?:\\s*(?<trail>${CMP}))?`;
  const symbolic = `(?:(?<lead>${CMP})\\s+)?(?<symbol>\\$|₩|€|£)\\s*(?<amount>${MONEY_NUM})(?:\\s*(?<trail>${CMP}))?`;
  const unitPrice = `(?:(?<lead>${CMP})\\s+)?(?<amount>${MONEY_NUM})\\s*(?<unit>${MONEY_UNIT})(?:\\s*(?<trail>${CMP}))?`;
  const match = earliest(text, [labeled, symbolic, unitPrice]);
  if (!match?.groups) return text;
  const groups = match.groups;
  const amountRaw = Number((groups.amount ?? "").replace(/,/g, ""));
  if (!Number.isFinite(amountRaw)) return text;
  const currency = currencyOf(groups.unit, groups.symbol);
  const unit = (groups.unit ?? "").toLowerCase().replace(/\s+/g, "");
  const value = unit === "만원" ? amountRaw * 10000 : amountRaw;
  const op = opOf(groups.trail) ?? opOf(groups.lead) ?? "eq";
  if (parsed.priceBounds.length < 4) {
    parsed.priceBounds.push({ amount: value, currency, op });
  }
  return cut(text, startOf(match), startOf(match) + match[0].length);
}

function takeSale(text: string): { text: string; sale: SaleIntent | null } {
  const rules: Array<{ source: string; sale: SaleIntent }> = [
    { source: "not\\s+for\\s+sale|비매품|판매\\s*안\\s*함", sale: "not_for_sale" },
    { source: "가격\\s*문의|price\\s+on\\s+request|upon\\s+request", sale: "inquire" },
    { source: "판매\\s*완료|sold\\s+out", sale: "sold" },
    { source: "판매\\s*가능|판매\\s*중|구매\\s*가능|for\\s+sale|available\\s+for\\s+sale", sale: "available" },
  ];
  let sale: SaleIntent | null = null;
  let next = text;
  for (const rule of rules) {
    const match = new RegExp(rule.source, "i").exec(next);
    if (!match) continue;
    if (!sale) sale = rule.sale;
    next = cut(next, startOf(match), startOf(match) + match[0].length);
  }
  return { text: next, sale };
}

function cleanResidual(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/^[\s,./·]+|[\s,./·]+$/g, "")
    .trim();
}

export function parseArtworkQuery(raw: string): ParsedArtworkQuery {
  const source = raw.trim();
  if (!source) return { ...EMPTY, sizeBounds: [], priceBounds: [] };
  const kinds = stripKinds(source);
  let text = kinds.text;
  const parsed: ParsedArtworkQuery = {
    ...EMPTY,
    sizeBounds: [],
    priceBounds: [],
    includeGoods: kinds.includeGoods,
    includeCollected: kinds.includeCollected,
  };
  for (let i = 0; i < 6; i++) {
    const next = takeSize(text, parsed);
    if (next === text) break;
    text = next;
  }
  for (let i = 0; i < 4; i++) {
    const next = takePrice(text, parsed);
    if (next === text) break;
    text = next;
  }
  const sale = takeSale(text);
  text = cleanResidual(sale.text);
  parsed.text = text;
  parsed.sale = sale.sale;
  parsed.hasConstraint =
    parsed.sizeBounds.length > 0 || parsed.sizeBox != null || parsed.priceBounds.length > 0 || parsed.sale != null;
  const measure = parsed.hasConstraint || text.length > 0;
  if (!measure && parsed.includeGoods && parsed.includeCollected) parsed.kindMode = "goods-and-collected";
  else if (!measure && parsed.includeGoods) parsed.kindMode = "goods";
  else if (!measure && parsed.includeCollected) parsed.kindMode = "collected";
  else parsed.kindMode = "default";
  return parsed;
}

export function artworkQueryIsActive(parsed: ParsedArtworkQuery): boolean {
  return (
    parsed.text.length > 0 ||
    parsed.hasConstraint ||
    parsed.kindMode !== "default" ||
    parsed.includeGoods ||
    parsed.includeCollected
  );
}

export function discoverSqlKinds(parsed: ParsedArtworkQuery): string[] {
  if (parsed.kindMode === "goods") return ["art_goods"];
  if (parsed.kindMode === "collected") return ["collected"];
  if (parsed.kindMode === "goods-and-collected") return ["art_goods", "collected"];
  const kinds = ["artwork", "print_edition"];
  if (parsed.includeGoods) kinds.push("art_goods");
  if (parsed.includeCollected) kinds.push("collected");
  return kinds;
}

export function discoverKindRank(kind: string | null | undefined): number {
  if (kind === "print_edition") return 1;
  if (kind === "art_goods") return 2;
  if (kind === "collected") return 3;
  return 0;
}

/**
 * Centimeters already stored, or both sides recovered from `size` plus
 * `size_unit`. One stored side is not copied onto the other.
 */
export function artworkDimensionsCm(
  work: ArtworkConstraintSource,
): { widthCm: number; heightCm: number } | null {
  const width = positive(work.width_cm);
  const height = positive(work.height_cm);
  if (width != null && height != null) return { widthCm: width, heightCm: height };
  const storedUnit = work.size_unit === "cm" || work.size_unit === "in" ? work.size_unit : null;
  const parsed = parseSizeToDimensionsCm(work.size ?? null, storedUnit);
  if (!parsed) return null;
  if (!(parsed.widthCm > 0) || !(parsed.heightCm > 0)) return null;
  return { widthCm: parsed.widthCm, heightCm: parsed.heightCm };
}

function nearCm(value: number, target: number): boolean {
  return Math.abs(value - target) <= Math.max(SIZE_EQ_TOLERANCE_CM, Math.abs(target) * 0.002);
}

function compareCm(value: number, op: SizeOp, target: number): boolean {
  if (op === "eq") return nearCm(value, target);
  if (op === "lte") return value <= target + SIZE_INEQ_EPS_CM;
  if (op === "lt") return value < target - SIZE_INEQ_EPS_CM;
  if (op === "gte") return value >= target - SIZE_INEQ_EPS_CM;
  return value > target + SIZE_INEQ_EPS_CM;
}

function compareAmount(value: number, op: SizeOp, target: number): boolean {
  if (op === "eq") return Math.abs(value - target) <= 0.5;
  if (op === "lte") return value <= target + 0.001;
  if (op === "lt") return value < target - 0.001;
  if (op === "gte") return value >= target - 0.001;
  return value > target + 0.001;
}

function sizeOk(work: ArtworkConstraintSource, parsed: ParsedArtworkQuery): boolean {
  if (parsed.sizeBounds.length === 0 && !parsed.sizeBox) return true;
  const dims = artworkDimensionsCm(work);
  if (!dims) return false;
  if (parsed.sizeBox) {
    const box = parsed.sizeBox;
    const workPair = [dims.widthCm, dims.heightCm].sort((a, b) => a - b);
    const queryPair = [box.widthCm, box.heightCm].sort((a, b) => a - b);
    if (box.op === "eq") {
      if (!nearCm(workPair[0], queryPair[0]) || !nearCm(workPair[1], queryPair[1])) return false;
    } else if (box.op === "lte" || box.op === "lt") {
      if (!compareCm(workPair[0], box.op, queryPair[0]) || !compareCm(workPair[1], box.op, queryPair[1])) return false;
    } else if (!compareCm(workPair[0], box.op, queryPair[0]) || !compareCm(workPair[1], box.op, queryPair[1])) {
      return false;
    }
  }
  for (const bound of parsed.sizeBounds) {
    if (bound.axis === "either") {
      if (bound.op !== "eq") {
        const max = Math.max(dims.widthCm, dims.heightCm);
        if (!compareCm(max, bound.op, bound.cm)) return false;
      } else if (!nearCm(dims.widthCm, bound.cm) && !nearCm(dims.heightCm, bound.cm)) {
        return false;
      }
      continue;
    }
    const value =
      bound.axis === "width"
        ? dims.widthCm
        : bound.axis === "height"
          ? dims.heightCm
          : Math.max(dims.widthCm, dims.heightCm);
    if (!compareCm(value, bound.op, bound.cm)) return false;
  }
  return true;
}

function normCurrency(raw: string | null | undefined): PriceCurrency | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (s === "krw" || s === "₩" || s === "원" || s === "won") return "KRW";
  if (s === "usd" || s === "$" || s === "dollar" || s === "dollars") return "USD";
  if (s === "eur" || s === "€" || s === "euro") return "EUR";
  if (s === "gbp" || s === "£" || s === "pound") return "GBP";
  return null;
}

function priceCandidates(work: ArtworkConstraintSource, currency: PriceCurrency | null): number[] {
  const input = finiteNumber(work.price_input_amount);
  const inputCur = normCurrency(work.price_input_currency);
  const usd = finiteNumber(work.price_usd);
  const fx = finiteNumber(work.fx_rate_to_usd);
  const out: number[] = [];
  if (currency == null) {
    if (input != null) out.push(input);
    else if (usd != null) out.push(usd);
    return out;
  }
  if (input != null && inputCur === currency) out.push(input);
  if (currency === "USD" && usd != null && !out.includes(usd)) out.push(usd);
  if (currency === "USD" && input != null && inputCur && inputCur !== "USD" && fx != null && fx > 0) {
    out.push(input * fx);
  }
  return out;
}

function priceOk(work: ArtworkConstraintSource, parsed: ParsedArtworkQuery): boolean {
  if (parsed.priceBounds.length === 0) return true;
  if (work.pricing_mode !== "fixed" || work.is_price_public !== true) return false;
  for (const bound of parsed.priceBounds) {
    const candidates = priceCandidates(work, bound.currency);
    if (candidates.length === 0) return false;
    if (!candidates.some((amount) => compareAmount(amount, bound.op, bound.amount))) return false;
  }
  return true;
}

function saleOk(work: ArtworkConstraintSource, parsed: ParsedArtworkQuery): boolean {
  if (!parsed.sale) return true;
  if (parsed.sale === "inquire") return work.pricing_mode === "inquire";
  return work.ownership_status === parsed.sale;
}

export function kindAllowed(
  kind: string | null | undefined,
  parsed: ParsedArtworkQuery,
  scope: "discover" | "pool",
): boolean {
  const k = kind ?? "artwork";
  if (parsed.kindMode === "goods") return k === "art_goods";
  if (parsed.kindMode === "collected") return k === "collected";
  if (parsed.kindMode === "goods-and-collected") return k === "art_goods" || k === "collected";
  if (scope === "pool") return true;
  if (k === "art_goods") return parsed.includeGoods;
  if (k === "collected") return parsed.includeCollected;
  return k === "artwork" || k === "print_edition";
}

export function artworkMatchesConstraints(work: ArtworkConstraintSource, parsed: ParsedArtworkQuery): boolean {
  return sizeOk(work, parsed) && priceOk(work, parsed) && saleOk(work, parsed);
}

/** Public discovery. Drafts stay out. Goods and collected stay out unless the query names them. */
export function artworkMatchesDiscover(work: ArtworkConstraintSource, parsed: ParsedArtworkQuery): boolean {
  if (work.visibility !== "public") return false;
  if (!kindAllowed(work.work_kind, parsed, "discover")) return false;
  return artworkMatchesConstraints(work, parsed);
}

function trimNum(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 100) / 100);
}

function withOp(value: string, op: SizeOp, ko: boolean): string {
  if (op === "eq") return value;
  if (ko) {
    if (op === "lt") return `${value} 미만`;
    if (op === "lte") return `${value} 이하`;
    if (op === "gt") return `${value} 초과`;
    return `${value} 이상`;
  }
  if (op === "lt") return `< ${value}`;
  if (op === "lte") return `≤ ${value}`;
  if (op === "gt") return `> ${value}`;
  return `≥ ${value}`;
}

function moneyLabel(bound: PriceBound): string {
  const n = trimNum(bound.amount);
  if (bound.currency === "USD") return `$${Number(bound.amount).toLocaleString("en-US")}`;
  if (bound.currency === "KRW") return `₩${Number(bound.amount).toLocaleString("en-US")}`;
  if (bound.currency === "EUR") return `€${n}`;
  if (bound.currency === "GBP") return `£${n}`;
  return n;
}

export function describeArtworkQuery(parsed: ParsedArtworkQuery, locale: string): string[] {
  const ko = locale === "ko";
  const out: string[] = [];
  if (parsed.sizeBox) {
    const unit = parsed.sizeBox.unit === "in" ? "in" : parsed.sizeBox.unit === "mm" ? "mm" : "cm";
    out.push(withOp(`${trimNum(parsed.sizeBox.a)} × ${trimNum(parsed.sizeBox.b)} ${unit}`, parsed.sizeBox.op, ko));
  }
  for (const bound of parsed.sizeBounds) {
    const unit = bound.displayUnit === "in" ? "in" : bound.displayUnit === "mm" ? "mm" : "cm";
    const axis =
      bound.axis === "width" ? (ko ? "가로 " : "width ") : bound.axis === "height" ? (ko ? "세로 " : "height ") : "";
    out.push(withOp(`${axis}${trimNum(bound.displayValue)} ${unit}`, bound.op, ko));
  }
  for (const bound of parsed.priceBounds) out.push(withOp(moneyLabel(bound), bound.op, ko));
  if (parsed.sale === "available") out.push(ko ? "판매 가능" : "for sale");
  if (parsed.sale === "sold") out.push(ko ? "판매 완료" : "sold");
  if (parsed.sale === "not_for_sale") out.push(ko ? "비매품" : "not for sale");
  if (parsed.sale === "inquire") out.push(ko ? "가격 문의" : "price on request");
  if (parsed.includeGoods) out.push(ko ? "굿즈" : "goods");
  if (parsed.includeCollected) out.push(ko ? "소장" : "collected");
  return out;
}

export function searchArtworkHrefs(input: {
  artworkId: string;
  artistUsername?: string | null;
  artistIsExternal?: boolean;
}): { artworkHref: string; artistHref: string | null } {
  const artworkHref = `/artwork/${input.artworkId}`;
  if (input.artistIsExternal) return { artworkHref, artistHref: null };
  const username = (input.artistUsername ?? "").replace(/^@+/, "").trim();
  if (!hasPublicLinkableUsername({ username })) return { artworkHref, artistHref: null };
  return { artworkHref, artistHref: `/u/${username}` };
}
