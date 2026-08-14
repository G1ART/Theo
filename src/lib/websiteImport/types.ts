/** Confidence bucket for a proposed image ↔ artwork match. */
export type WebsiteImportMatchStatus = "high_confidence" | "review_needed" | "no_match" | "pending";

export type WebsiteImportParsedFields = {
  title?: string | null;
  year?: number | null;
  medium?: string | null;
  size?: string | null;
  size_unit?: "cm" | "in" | null;
  story?: string | null;
};

export type WebsiteImportCandidate = {
  id: string;
  page_url: string;
  image_url: string;
  dhash_hex: string;
  width?: number;
  height?: number;
  alt_text?: string | null;
  caption_blob?: string | null;
  parsed?: WebsiteImportParsedFields | null;
};

export type WebsiteImportMatchScore = {
  candidate_id: string;
  hamming: number;
  dimension_bonus: number;
};

/**
 * Reason a match row is in `no_match` (or otherwise degraded). Used to give
 * a more actionable hint to the user instead of "no match" everywhere.
 *
 *  - `fetch_failed`: artwork image bytes could not be retrieved (auth wall,
 *     redirected to a private host, network timeout, etc.).
 *  - `decode_failed`: bytes were retrieved but `sharp` could not decode
 *     them (unsupported format, truncated transfer).
 *  - `no_candidates`: scan succeeded but produced 0 candidate images on the
 *     remote site, so nothing could possibly match.
 *  - `no_similar`: candidates exist, but every one was over the hamming
 *     threshold — most often because the artwork isn't on the website at
 *     all, or the website hosts a heavily cropped/edited version.
 */
export type WebsiteImportMatchErrorCode =
  | "fetch_failed"
  | "decode_failed"
  | "no_candidates"
  | "no_similar";

export type WebsiteImportMatchRow = {
  artwork_id: string;
  chosen_candidate_id: string | null;
  match_status: WebsiteImportMatchStatus;
  confidence: number;
  top_matches: WebsiteImportMatchScore[];
  proposed: WebsiteImportParsedFields | null;
  field_provenance: Record<string, "website">;
  source_page_url?: string | null;
  source_image_url?: string | null;
  raw_caption?: string | null;
  /** True when the user explicitly picked a candidate via the pick API; this
   *  flag prevents subsequent match re-runs from clobbering their choice. */
  manual_pick?: boolean;
  /** Diagnostic hint when `match_status === "no_match"`. Optional for
   *  forward-compat with rows written by older code. */
  error_code?: WebsiteImportMatchErrorCode | null;
};

export type WebsiteImportEmptyReason =
  | "no_html_images"
  | "all_filtered"
  | "fetch_blocked"
  | "js_shell";

export type WebsiteImportScanMeta = {
  pages_fetched: number;
  pages_queued_cap: number;
  origin_hostname: string;
  /** Candidates whose caption/metadata parsed to at least one field. */
  candidates_parsed_count?: number;
  /** Non-fatal crawl caveats for UI (e.g. near_candidate_cap). */
  warnings?: string[];
  /** Why a successful crawl produced 0 candidates. */
  empty_reason?: WebsiteImportEmptyReason;
};
