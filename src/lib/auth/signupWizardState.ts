/**
 * Signup v2 wizard draft persistence (sessionStorage).
 *
 * See `docs/SIGNUP_REDESIGN_SPEC.md` §11.6. The draft is versioned so
 * we can safely evolve the shape later — an older draft is rejected
 * (returns `null`) rather than crashing the wizard.
 *
 * Notes:
 *   - Password is intentionally NEVER stored. Users re-enter after tab
 *     close on Step 2.
 *   - Draft lives on `sessionStorage`, not `localStorage`, so it clears
 *     when the tab closes but survives page refresh (per §5 #13).
 *   - `signup:v2:banner-dismissed` (used by Phase 4 banner) is a
 *     separate key on `localStorage`.
 */

const STORAGE_KEY = "signup:v2:draft";
const CURRENT_VERSION = 1 as const;

export type SignupV2WizardStep = 1 | 2 | 3 | 4;

export type SignupV2MainRole = "artist" | "curator" | "collector" | "gallerist";

/** Signup v2 wireframe pass (2026-08-20): optional self-declared
 *  gender on Step 3. Free-form column downstream so we don't paint
 *  ourselves into a corner if the taxonomy expands — the UI restricts
 *  writes to these four values. */
export type SignupV2Gender =
  | "woman"
  | "man"
  | "non_binary"
  | "prefer_not_to_say";

export type SignupV2Draft = {
  version: typeof CURRENT_VERSION;
  step: SignupV2WizardStep;
  email?: string;
  fullName?: string;
  usernameSeed?: string;
  username?: string;
  ageBand?: string;
  mainRole?: SignupV2MainRole;
  /** Signup v2 wireframe pass (2026-08-20). */
  secondaryRole?: SignupV2MainRole;
  /** Signup v2 wireframe pass (2026-08-20). */
  gender?: SignupV2Gender;
  isPublic?: boolean;
  avatarPath?: string;
  step4?: {
    title?: string;
    year?: number;
    medium?: string;
    size?: string;
    story?: string;
    imagePath?: string;
  };
  savedAt: string;
};

const MAIN_ROLES: readonly SignupV2MainRole[] = [
  "artist",
  "curator",
  "collector",
  "gallerist",
];

const GENDERS: readonly SignupV2Gender[] = [
  "woman",
  "man",
  "non_binary",
  "prefer_not_to_say",
];

function isMainRole(v: unknown): v is SignupV2MainRole {
  return typeof v === "string" && (MAIN_ROLES as readonly string[]).includes(v);
}

function isGender(v: unknown): v is SignupV2Gender {
  return typeof v === "string" && (GENDERS as readonly string[]).includes(v);
}

function isStep(v: unknown): v is SignupV2WizardStep {
  return v === 1 || v === 2 || v === 3 || v === 4;
}

/**
 * Parse a raw JSON string into a `SignupV2Draft`. Returns `null` when
 * the payload is malformed, from an older schema version, or from a
 * future version we don't understand. Exported so we can unit-test the
 * validation without touching sessionStorage.
 */
export function parseSignupDraft(raw: string | null | undefined): SignupV2Draft | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== CURRENT_VERSION) return null;
  if (!isStep(obj.step)) return null;
  const draft: SignupV2Draft = {
    version: CURRENT_VERSION,
    step: obj.step,
    savedAt: typeof obj.savedAt === "string" ? obj.savedAt : new Date(0).toISOString(),
  };
  if (typeof obj.email === "string") draft.email = obj.email;
  if (typeof obj.fullName === "string") draft.fullName = obj.fullName;
  if (typeof obj.usernameSeed === "string") draft.usernameSeed = obj.usernameSeed;
  if (typeof obj.username === "string") draft.username = obj.username;
  if (typeof obj.ageBand === "string") draft.ageBand = obj.ageBand;
  if (isMainRole(obj.mainRole)) draft.mainRole = obj.mainRole;
  if (isMainRole(obj.secondaryRole)) draft.secondaryRole = obj.secondaryRole;
  if (isGender(obj.gender)) draft.gender = obj.gender;
  if (typeof obj.isPublic === "boolean") draft.isPublic = obj.isPublic;
  if (typeof obj.avatarPath === "string") draft.avatarPath = obj.avatarPath;
  if (obj.step4 && typeof obj.step4 === "object") {
    const s = obj.step4 as Record<string, unknown>;
    const step4: NonNullable<SignupV2Draft["step4"]> = {};
    if (typeof s.title === "string") step4.title = s.title;
    if (typeof s.year === "number" && Number.isFinite(s.year)) step4.year = s.year;
    if (typeof s.medium === "string") step4.medium = s.medium;
    if (typeof s.size === "string") step4.size = s.size;
    if (typeof s.story === "string") step4.story = s.story;
    if (typeof s.imagePath === "string") step4.imagePath = s.imagePath;
    draft.step4 = step4;
  }
  return draft;
}

/**
 * Merge `patch` into `previous` (or an empty draft), stamping
 * `savedAt` and preserving `version`. Pure — the browser-side load /
 * save helpers below wrap this so tests can exercise the merge logic
 * without touching sessionStorage.
 */
export function mergeSignupDraft(
  previous: SignupV2Draft | null,
  patch: Partial<Omit<SignupV2Draft, "version" | "savedAt">>,
  now: string = new Date().toISOString()
): SignupV2Draft {
  const base: SignupV2Draft = previous
    ? { ...previous }
    : { version: CURRENT_VERSION, step: 1, savedAt: now };
  const step = isStep(patch.step) ? patch.step : base.step;
  const merged: SignupV2Draft = {
    ...base,
    ...patch,
    version: CURRENT_VERSION,
    step,
    savedAt: now,
  };
  if (patch.step4) {
    merged.step4 = { ...(base.step4 ?? {}), ...patch.step4 };
  }
  return merged;
}

/** Serialize for storage. Exposed for tests. */
export function serializeSignupDraft(draft: SignupV2Draft): string {
  return JSON.stringify(draft);
}

/**
 * Load the current draft from sessionStorage. Silent on SSR / private-
 * mode / disabled-storage — returns `null`.
 */
export function loadSignupDraft(): SignupV2Draft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return parseSignupDraft(raw);
  } catch {
    return null;
  }
}

/** Persist the draft. Best-effort — swallowed errors so signup never
 *  crashes because storage is disabled. */
export function saveSignupDraft(
  patch: Partial<Omit<SignupV2Draft, "version" | "savedAt">>
): SignupV2Draft | null {
  if (typeof window === "undefined") return null;
  try {
    const previous = loadSignupDraft();
    const next = mergeSignupDraft(previous, patch);
    window.sessionStorage.setItem(STORAGE_KEY, serializeSignupDraft(next));
    return next;
  } catch {
    return null;
  }
}

/** Nuke the draft. Called on wizard success, explicit "Start over",
 *  or Step 4 skip / submit. */
export function clearSignupDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* best-effort */
  }
}

export const SIGNUP_DRAFT_STORAGE_KEY = STORAGE_KEY;

// ── username seed helper (used by Step 1 → Step 3) ────────────────

/**
 * Convert an email local-part into a Signup v2 username seed:
 *   1. lowercase.
 *   2. replace non-`[a-z0-9_]` with `_`.
 *   3. collapse runs of `_`.
 *   4. trim leading / trailing `_`.
 *   5. cap at 20 chars (matches the DB constraint).
 *
 * Returns `""` when the seed is unusable (length < 3 or all-`_`); the
 * caller should fall back to the DB autogen trigger in that case.
 */
export function sanitizeUsernameSeed(rawEmail: string): string {
  if (!rawEmail || typeof rawEmail !== "string") return "";
  const localPart = rawEmail.split("@")[0] ?? "";
  const lowered = localPart
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
  const replaced = lowered.replace(/[^a-z0-9_]+/g, "_");
  const collapsed = replaced.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  const trimmed = collapsed.slice(0, 20);
  if (trimmed.length < 3) return "";
  return trimmed;
}
