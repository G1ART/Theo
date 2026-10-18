/**
 * Supabase / Postgres -> i18n error translator.
 *
 * Why this layer exists
 * ---------------------
 * Many of our SECURITY DEFINER RPCs (`p0_delegations.sql`,
 * `20260508000000_claims_subject_for_delegate.sql`,
 * `20260509000000_delegate_claim_request_and_shortlist.sql`,
 * `20260511000000_private_account_searchable_and_follow_requests.sql`, …)
 * communicate failure with terse English `RAISE EXCEPTION` strings such as
 * `permission_denied`, `auth.uid() is null`, `cannot_invite_self`, or the
 * full sentence
 *   `forbidden: caller is not an active account delegate writer for subject_profile_id`
 *
 * Beta QA pointed out — correctly — that surfacing those strings to end
 * users is jarring even if the underlying logic is correct: it looks like
 * a developer slip. Since the messages are also used as machine-readable
 * codes in some places, we DON'T rewrite them in SQL; we wrap every
 * client-side catch site in `formatSupabaseError(error, t)` and translate
 * to a friendly i18n string.
 *
 * Adding a new mapping
 * --------------------
 * 1. Add a row to `EXACT_MAP` (preferred) or `SUBSTRING_MAP` (last resort).
 * 2. Add the matching `errors.*` key to BOTH locales of
 *    `src/lib/i18n/messages.ts`.
 *
 * Unknown messages fall through to the raw text (instead of a generic
 * `errors.fallback`) so we never silently swallow a useful clue while
 * the catalog is still growing. The fallback path is reserved for
 * empty errors (rare).
 */

import { formatErrorMessage } from "./format";

type Translator = (key: string) => string;

/**
 * Exact-match table (case-sensitive). The matched message becomes the
 * i18n key. Both pre-trim and post-trim variants are checked by the
 * caller, so don't worry about leading/trailing whitespace here.
 */
const EXACT_MAP: Record<string, string> = {
  // --- auth gates ---
  "auth.uid() is null": "errors.auth.required",
  "auth required": "errors.auth.required",
  "not_authenticated": "errors.auth.required",
  "Not authenticated": "errors.auth.required",

  // --- generic permission ---
  "permission_denied": "errors.permission.denied",

  // --- delegate writer guard (Claim / artwork upload via acting-as) ---
  "forbidden: caller is not an active account delegate writer for subject_profile_id":
    "errors.delegate.notWriter",

  // --- delegation invite lifecycle (delegations RPCs) ---
  "missing_email": "errors.invite.missingEmail",
  "delegate_email required": "errors.invite.missingEmail",
  "invalid_scope": "errors.invite.invalidScope",
  "project_id required for project scope": "errors.invite.invalidScope",
  "project_not_found": "errors.invite.projectNotFound",
  "Not allowed to delegate this project": "errors.invite.projectNotFound",
  "cannot_invite_self": "errors.invite.cannotInviteSelf",
  "Cannot invite yourself": "errors.invite.cannotInviteSelf",
  "delegate_not_found": "errors.invite.delegateNotFound",
  "Delegate user has no email": "errors.invite.delegateNotFound",
  "delegate_profile_id required": "errors.invite.delegateNotFound",
  "duplicate_pending_invite": "errors.invite.duplicate",
  "Invitation or delegation already exists for this user and scope":
    "errors.invite.duplicate",

  // --- claim / provenance ---
  "exactly one of work_id, project_id required":
    "errors.claim.requiresWorkOrProject",
  "work_id required": "errors.claim.workIdRequired",
  "claim_type required": "errors.claim.typeRequired",
  "artist_profile_id required": "errors.claim.artistRequired",
  "display_name required": "errors.claim.displayNameRequired",
  "display_name must be at least 2 characters":
    "errors.claim.displayNameTooShort",
  "period_status must be past, current, or future":
    "errors.claim.invalidPeriodStatus",

  // --- artist invite email (external_artists, 20261018040637) ---
  "invite_email_verified_by_other_account": "errors.invite.emailVerifiedByOther",
  "invite_email_mismatch": "myArtists.linkEmailMismatch",

  // --- follow request ---
  "target profile not found": "errors.follow.targetNotFound",
  "invalid target": "errors.follow.invalidTarget",
  "invalid follower": "errors.follow.invalidFollower",

  // --- price inquiry ---
  "invalid status": "errors.priceInquiry.invalidStatus",
};

/**
 * Substring fallbacks for messages that ship with extra context (e.g.
 * a Postgrest envelope). Order matters: more specific patterns first.
 */
const SUBSTRING_MAP: Array<[RegExp, string]> = [
  [
    /forbidden:\s*caller is not an active account delegate writer/i,
    "errors.delegate.notWriter",
  ],
  [/permission denied/i, "errors.permission.denied"],
  [/violates row-level security/i, "errors.permission.denied"],
  [/jwt|invalid_jwt|token expired|expired token/i, "errors.auth.required"],
];

/**
 * Translate a Supabase / Postgrest / generic error into a friendly,
 * locale-aware string.
 *
 * Resolution order:
 *   1. Exact lookup against `EXACT_MAP` (head, then full raw text).
 *   2. Regex sweep over `SUBSTRING_MAP`.
 *   3. If `fallbackKey` is provided, return `t(fallbackKey)` so the
 *      surface keeps a polished message even for novel errors.
 *   4. Otherwise return the raw message verbatim — never
 *      `[object Object]` — so devs still have a useful clue while the
 *      catalog grows.
 */
export function formatSupabaseError(
  error: unknown,
  t: Translator,
  fallbackKey?: string,
): string {
  const raw = formatErrorMessage(error).trim();
  if (!raw) return t(fallbackKey ?? "errors.fallback");

  // Postgrest often wraps the original RAISE message inside
  //   `<message> — <details> — (<hint>)`
  // produced by formatErrorMessage. Try the lead segment first.
  const head = (raw.split(" — ")[0] ?? raw).trim();

  if (EXACT_MAP[head]) return t(EXACT_MAP[head]);
  if (head !== raw && EXACT_MAP[raw]) return t(EXACT_MAP[raw]);

  for (const [re, key] of SUBSTRING_MAP) {
    if (re.test(raw)) return t(key);
  }

  return fallbackKey ? t(fallbackKey) : raw;
}

/**
 * Convenience wrapper for callers that want a single translator they
 * can pass into a `useT()` hook scope. Mostly for components that
 * already destructure `{ t }` and want one-line catch handling:
 *
 *   } catch (e) {
 *     setError(formatSupabaseError(e, t));
 *   }
 */
export type SupabaseErrorTranslator = typeof formatSupabaseError;
