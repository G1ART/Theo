# Signup / Login Redesign — Spec (v2, sign-off complete)

Front-door redesign based on 6 designer wireframes (log in + sign-up
steps 1–4). This document is the **implementation spec** for "Signup
v2". All 13 decisions in §5 have been signed off by the parent
(2026-08-19). Phase 0 (schema migration + feature flag) shipped
alongside this revision — see §6 for the phased plan and §11 for the
column changes.

Source assets (designer, 2026-08-19):

1. `log_in-eng` — Log in
2. `Sign_up_step_1` — Step 1 · Enter your email
3. `Sign_up_step_2` — Step 2 · Set your name and password
4. `Sign_up_step_3-1` — Step 3 · Profile (closed dropdowns)
5. `Sign_up_step_3-2` — Step 3 · Primary Role dropdown open
6. `Sign_up_step_4_only_for_people_who_set_thtier_role_as_artist_`
   — Step 4 · Artist quick-start

Audit branch: `main`, HEAD `e2a5669`.

---

## 1. Executive summary

The wireframes propose a **new "front door"** with an intentionally
delicate visual language (thin strokes, oval-outlined inputs, huge
whitespace, single centered column, ambient "Theo" mark) and split the
existing 2-step signup into a **4-step wizard**. All 13 decisions in
§5 have been signed off by the parent (2026-08-19).

The visual redesign is **largely additive** — email/password +
passwordless are already the shipping auth surface, `age_band` and
`main_role` already exist with matching taxonomies, and the intent
picker in `src/app/upload/page.tsx` already models CREATED / OWNS /
CURATED. Phase 0 adds only three new columns
(`full_name`, `tos_accepted_at`, `profile_completed_at`) and the
`NEXT_PUBLIC_SIGNUP_V2` feature flag — see §11 for the full
foundation.

Three items were the biggest calls and are now resolved:
- **OAuth**: Google + Apple in Phase 3; Kakao deferred (§5 #5).
- **Step 1 enumeration**: anti-enumeration soft path (§5 #6).
- **Tone scope**: Option C hybrid — auth + brand-facing surfaces
  only (§5 #3).

Detailed decision table in §5. Phase plan in §6. Column changes and
per-decision details (password policy, username auto-suggest,
existing-user banner, wizard state, ToS) in §11.

---

## 2. Wireframes in detail

For each screen: visual elements, interactions, data requirements,
suggested React components (new vs. reused). All references to
existing code paths are audit-based.

### 2.1 Log in (asset 1)

**Visual elements**
- Centered "Theo" arch mark (existing `TheoLogo` PNG works — see
  `src/components/brand/TheoLogo.tsx`).
- Two-line tagline: "Meet your Theo. / Be our Theo." + "Get started here."
- Email field (oval outline, floating "Email" label).
- Password field with inline **"Forgot Password?"** on the right.
- Primary CTA (filled pill): **Log in**.
- Secondary link row: **Log in without a password** · **New to Theo? Sign up**.
- **Quick Start** cluster (labeled) with three pill buttons: Google · Apple · 카톡? (question mark indicates "?").
- Footnote (KO): "서비스 이용약관 및 개인정보 처리방침에 동의하시게 됩니다."

**Interactions**
- Primary Log-in submits email+password → `signInWithPassword` (existing
  code in `src/app/login/page.tsx` and `src/lib/supabase/auth.ts`).
- "Log in without a password" collapses into an email-only input that
  calls `sendMagicLink` — this is the same "passwordless disclosure"
  pattern the current `/login` already ships.
- "Forgot Password?" jumps to `/auth/forgot?email=<current>` (already wired).
- **Sign up** link routes to `/onboarding` (Step 1) with any `?next=` preserved.
- Quick Start pill click → **`signInWithOAuth({ provider })`** —
  **not implemented today** (decision #5).

**Data requirements**
- No new persisted state. OAuth adds redirect config +
  `NEXT_PUBLIC_APP_URL/auth/callback` allowlist per provider.

**Components**
- Reuse `TheoLogo`, `TheoLoadingMark`, `routeByAuthState`, existing
  auth API in `src/lib/supabase/auth.ts`.
- New primitive proposals (Phase 1): `<OvalInput/>`,
  `<PillButton variant="solid|ghost|outline"/>`, `<AuthShell/>`
  (centered single-column `min-h-screen` frame).
- Existing `/login/page.tsx` becomes the "returning user" surface;
  the current copy already reflects that (see file header comment).

### 2.2 Step 1 · Enter your email (asset 2)

**Visual elements**
- Very large left-aligned "Step 1" title (`text-5xl` sans, thin weight).
- Sub-label "Enter your email".
- Oval outline email input with floating "Email*" label.
- Primary CTA pill: **Sign up**.
- Secondary link: "Already have an account? **Log in**".
- Inline red hint (below submit): "*We found an account with this
  email please log in".

**Interactions**
- Submit → server check: "does this email have an auth.users row?".
  - If **known**: show the red inline hint + emphasize the Log in link.
    Two implementation paths (decision #6):
    - (a) Client attempts `signUp` and reads Supabase's
      "anti-enumeration" empty-identities response (current code path
      in `src/app/onboarding/page.tsx`, line 111–129); flip UI to
      "duplicate email" state.
    - (b) A dedicated RPC (`select 1 from auth.users where email=…`)
      exposed as a `check_email_available()` SECURITY DEFINER; faster,
      but leaks membership pre-auth.
  - If **unknown**: proceed to Step 2 in-memory (email held in a wizard
    store; no auth.users row yet).

**Data requirements**
- Email stored transiently in wizard state until Step 2 submits both
  fields to `signUpWithPassword`. **No DB write in Step 1.**

**Components**
- New: `<SignupWizardShell step={1..4}/>`, `<OvalInput/>`.
- Reuse: `safeNextPath`, `loginUrlWithNext`.

### 2.3 Step 2 · Name & password (asset 3)

**Visual elements** (post sign-off)
- "Step 2" title, "Set your name and password" sub-label.
- **Single wide oval input: `Name*`** (populates new `profiles.full_name`).
  First/Last split from the mockup is dropped (decision #1).
- Password oval input with hint **"Must be at least 12 characters"**
  (decision #8) + inline strength meter.
- Confirm password oval input.
- Primary CTA: **Next**.

**Interactions**
- Submit calls `signUpWithPassword(email, password, metadata)` where
  `metadata` carries `{ full_name }` (and `display_name` derived from
  `full_name` if user does not customize).
- Password validated client-side against `src/lib/auth/passwordPolicy.ts`:
  12+ chars, entropy score ≥ 3 (zxcvbn-lite-style), and **HIBP
  k-anonymity** check (rejects passwords that appear in known
  breach corpora — see §11.2 for the flow).
- On confirmation-email mode → show "Check your email" pane and pause
  the wizard until callback returns (matches today's flow).
- On immediate session mode → advance directly to Step 3.

**Data requirements — see mapping (§3)**
- `full_name` is a net-new column on `profiles` (decision #1). It is
  the sole name field collected at signup. Legal first/last name split
  is deferred to a later "payments / invoicing elevation" flow, not
  captured here.
- `display_name` maps to `profiles.display_name` and is populated from
  `full_name` on first save (user can edit in Studio → Profile).

**Components**
- Single `<OvalInput/>` for `Name*` (no bilingual pair; existing
  `display_name_ko / _en` continue to serve i18n slots and are
  populated by Step 3's profile card / Studio settings).
- Reuse new password-policy helper `src/lib/auth/passwordPolicy.ts`
  (introduces `MIN_PASSWORD_LENGTH = 12`, `checkPasswordStrength`,
  `checkPwnedPassword`). Existing constants in
  `src/app/onboarding/page.tsx` and `src/app/set-password/page.tsx`
  (currently `MIN=8`) are re-exported for the legacy flow but bumped
  to 12 in Phase 5.

### 2.4 Step 3 · Profile (assets 4 & 5)

**Visual elements** (post sign-off)
- "Step 3 · Tell us more about you / You can change it later in your Profile."
- Fields (rows of 2 across, then single):
  - `Setup profile photo` — Upload button + preview thumb (asset 5 shows the placeholder circle).
  - **~~Gender~~ dropped (decision #2).**
  - `Age` (dropdown, mockup shows "18–24"). Maps directly to
    existing `profiles.age_band` taxonomy — no new column.
  - `Primary Role*` (dropdown; open state in asset 5 shows Artist /
    Curator / Collector). We list all 4 (including Gallerist) since
    the DB enum has it and today's app treats Gallerist as a full role.
  - **~~Secondary Role~~ dropped from Step 3 scope (decision #1).** If
    the user later wants to declare multiple roles, they can edit
    `roles[]` in Studio → Profile.
  - `@username` — editable text field, defaulting to the auto-suggested
    sanitized email local-part (see decision #10 / §11.3). Live 300ms
    debounce uniqueness check; error state only fires on **collision**
    ("해당 유저네임은 이미 사용 중입니다").
  - `Visibility — who can see your profile?` — two pill radios: Public · Private.
- Primary CTA: **Next**.

**Interactions**
- Photo picker: reuses existing avatar upload code path (Supabase
  storage bucket + `profiles.avatar_url`).
- Username debounce reuses `checkUsernameAvailability` (see §11.3).
- On submit → `upsert_my_profile` (existing SECURITY DEFINER RPC) with
  identity payload including `full_name`, `main_role`, `roles: [main_role]`,
  `is_public`, `age_band`, `avatar_url`, `username`. Immediately after,
  stamp `profiles.profile_completed_at = now()` (SSOT for the "banner
  dismiss" logic — see §11.4).

**Data requirements — see §3, §11**

**Components**
- Reuse `IdentityPreview` if we still want a live preview (optional).
- New primitives: `<OvalSelect/>`, `<PillRadio/>`, `<PhotoUploadCard/>`.
- Reuse: `TAXONOMY.ageBandOptions` (already ships `18_24`, `25_34`,
  `prefer_not`, etc.). No new taxonomy needed.
- Reuse: `ROLE_KEYS = ["artist","curator","collector","gallerist"]` from
  `src/lib/identity/roles.ts`. All 4 are listed.
- Reuse: `UsernameField` + `checkUsernameAvailability` from
  `src/components/onboarding/UsernameField.tsx`.

### 2.5 Step 4 · Artist quick-start (asset 6)

**Visual elements** (post sign-off)
- Copy is **role-aware** (decision #7). For artists:
  "Step 4 · Add your first piece / Optional. Skip anytime."
  For non-artists (curator / collector / gallerist), the same slot
  reads "Step 4 (optional) — you can add art later" and the form is
  collapsed by default under a "Show anyway" disclosure (see §11.5).
- Left: large "Upload your artwork" dashed-outline drop zone with `+` icon.
- Right form column (single visible artwork):
  - `Title*` (single line).
  - `Year*` (4-digit integer).
  - `Medium` · `Size` (side by side, free-text).
  - **~~`Status*` dropdown removed~~ (decision #4).** `ownership_status`
    is silently written as the mockup's default intent → we auto-store
    `ownership_status='CREATED'` server-side. UI does not surface the
    field at signup.
  - `Description` (2-line text area, optional).
- Footer helper: "More information can be added on your profile".
- Primary CTA: **Skip** by default, **flips to "Add" when at least
  the required fields (Title, Year, plus 1 image) are filled**. Skip
  never inserts; Add inserts one artwork + one image.

**Interactions**
- On image drop: reuse `uploadArtworkImage` in
  `src/lib/supabase/storage.ts` (already handles single-image case).
- On submit ("Add"): mirror the "CREATED" path in `src/app/upload/page.tsx`.
  Field mapping is fully aligned with `/upload`'s actual column layout
  (decision #4):
  - Image → `artwork_images` row with `view_type='primary'`.
  - `title` (raw input) + **`title_ko` / `title_en` auto-populated on
    the current locale slot** (via `useLocale()` inside the wizard).
  - `year` → integer.
  - `medium` (raw) + `medium_ko` / `_en` on current locale.
  - `size` (raw free-text) → also fed into
    `parseSizeToDimensionsCm` (`src/lib/size/format.ts`) which writes
    `width_cm` / `height_cm` when parseable; unparseable size leaves
    dims null (existing fallback covered by 2026-08-19 (26) backfill).
  - `ownership_status = 'CREATED'` (constant).
  - `story` (raw) + `story_ko` / `_en` on current locale.
- Skip inserts nothing; wizard state (see §11.6) is cleared.

**Data requirements — see §3, §11.5**

**Components**
- **Miniature version** of `src/app/upload/page.tsx`. Full page is
  ~1700 lines and does dedup, bilingual, price, exhibition attachment,
  perspective correction. Step 4 needs only: 1 image, title, year,
  medium (free), size (free), story (optional). Auto-CREATED, no
  intent picker.
- Reuse: `ImageStandardizeEditor` can be **omitted** for signup; we
  accept the raw upload and let users refine later in `/my` or
  `/upload`.
- Reuse: `parseSizeToDimensionsCm` from `src/lib/size/format.ts`
  (already exercised on `/upload`).

---

## 3. Field mapping table (complete)

### 3.1 Auth (`auth.users`)

| Wireframe field | Current schema                    | Mapping status                        | Action                     |
| --------------- | --------------------------------- | ------------------------------------- | -------------------------- |
| Email           | `auth.users.email` (managed)      | Already in place                      | None                       |
| Password        | `auth.users` (Supabase auth)      | Already in place, `MIN=8`             | Enforce 8+ in UI (already) |

### 3.2 Profile identity (`profiles`)

Audit reference: `information_schema.columns` executed via MCP
(2026-08-19). Enum `main_role` values today: `artist, collector, curator, gallerist`.
The table has 43 columns; the ones relevant to signup:

| Wireframe field         | Current column                                   | Mapping status                                    | Action                                                                                                     |
| ----------------------- | ------------------------------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Name (single)           | `profiles.full_name` (**Phase 0**, text nullable) | **Added in Phase 0**                              | Populate on Step 2 submit. Single column — no first/last split. Decision #1.                               |
| ~~First name~~          | —                                                | **Dropped**                                       | Rationale: artist mononyms + Korean naming; `display_name_ko/_en` already covers locale. Legal name to be added at payments elevation. |
| ~~Last name~~           | —                                                | **Dropped**                                       | Same as above.                                                                                             |
| Display name            | `profiles.display_name`                          | Present, nullable                                 | Auto-populate from `full_name` on first save; user edits in Studio.                                        |
| Display name KO/EN      | `display_name_ko`, `display_name_en`             | Present (bilingual)                               | Leave as-is; Studio still surfaces both.                                                                   |
| Username                | `profiles.username` (NOT NULL, unique)           | Present                                           | Step 1 auto-suggests sanitized email local-part; Step 3 exposes editable `@username` with debounce collision check. Decision #10 / §11.3. |
| Profile photo           | `profiles.avatar_url`                            | Present, nullable                                 | Reuse existing upload flow.                                                                                |
| ~~Gender~~              | —                                                | **Dropped**                                       | Decision #2. Column not introduced. Studio may later reintroduce as optional free-text.                    |
| Age                     | `profiles.age_band` (text, nullable)             | Present + taxonomy (`u18/18_24/…/65p/prefer_not`) | Wireframe value "18–24" **already matches** existing option. No new column.                                |
| Primary Role            | `profiles.main_role` (enum `main_role`)          | Present                                           | Direct map. All 4 (Artist / Curator / Collector / Gallerist) listed.                                       |
| ~~Secondary Role~~      | —                                                | **Dropped**                                       | Decision #1. Users declare additional `roles[]` in Studio.                                                 |
| Visibility              | `profiles.is_public` (boolean, default true)     | Present                                           | Wireframe "Public / Private" = boolean toggle. Direct map.                                                 |
| ToS / Privacy consent   | `profiles.tos_accepted_at` (**Phase 0**, timestamptz nullable) | **Added in Phase 0**                | Stamped `now()` on account create (implicit consent per §11.7). Decision #12.                              |
| Profile completion mark | `profiles.profile_completed_at` (**Phase 0**, timestamptz nullable) | **Added in Phase 0**                 | Stamped when Step 3 saves. NULL for the existing 59 → banner surfaces. Decision #9 / §11.4.                |

### 3.3 Artist quick-start Step 4 (`artworks` + `claims` + `artwork_images`)

Reference: `pg_constraint.claims_claim_type_valid` allows
`CREATED, OWNS, INVENTORY, EXHIBITED, CURATED, INCLUDES_WORK, HOSTS_PROJECT`.
`ownership_status` enum values: `available, owned, sold, not_for_sale`.

| Wireframe field | Current column                                              | Mapping status                       | Action                                                              |
| --------------- | ----------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------- |
| Title\*         | `artworks.title` + `title_ko` / `title_en`                  | Direct + locale slot                 | Write `title`; also write `title_{ko|en}` based on current app locale. |
| Year\*          | `artworks.year` (int, nullable)                             | Direct                               | Validate 4-digit                                                    |
| Medium          | `artworks.medium` + `medium_ko` / `medium_en`               | Direct + locale slot                 | Write `medium`; also write `medium_{ko|en}` based on current locale. |
| Size            | `artworks.size` + `size_unit` + `width_cm / height_cm / depth_cm` | Present with unit toggle       | Write `size` free-text; run `parseSizeToDimensionsCm` → populate structured cm dims when parseable (silent fallback if not). |
| Status          | `artworks.ownership_status` (auto)                          | **No UI (decision #4)**              | Server writes `ownership_status='CREATED'` unconditionally. `claims` is *not* written at signup — first "collected / curated" flows still happen on `/upload` where attribution UX exists. |
| Description     | `artworks.story` + `story_ko` / `story_en`                  | Direct + locale slot                 | Optional. Write `story`; also write `story_{ko|en}` on current locale. |
| Image           | `artwork_images` (via `attachArtworkImage`)                 | Present                              | Upload one image, `view_type='primary'`.                            |

### 3.4 Status dropdown → DB mapping (finalized: dropdown removed)

Decision #4: **the `Status*` dropdown is not surfaced at signup**.
`/upload`'s three intents (CREATED / OWNS / CURATED) all require
external-artist attribution UX to be meaningful for OWNS / CURATED,
which we deliberately keep out of the signup surface. Step 4 always
writes `artworks.ownership_status='CREATED'` and does *not* create a
`claims` row. Owned / curated work continues to be added on `/upload`,
where the attribution picker already lives.

For reference, the existing `/upload` intent → column mapping is:

| Intent                            | `artworks.ownership_status`  | `claims.claim_type` | Requires external_artist? |
| --------------------------------- | ---------------------------- | ------------------- | ------------------------- |
| CREATED (my own work)             | `available` (default) → auto | `CREATED`           | No — self as artist_id    |
| OWNS (collected)                  | `owned`                      | `OWNS`              | **Yes** if artist ≠ self  |
| CURATED                           | `not_for_sale` or `available`| `CURATED`           | **Yes** if artist ≠ self  |

Signup only travels the CREATED row. `ownership_status` write happens
server-side (or in the wizard's submit helper) — the user never sees
the enum name.

### 3.5 Column change summary

See §11 for the full list. Short version:

- **Added in Phase 0** (`20260820020000_signup_v2_profile_columns.sql`):
  `profiles.full_name`, `profiles.tos_accepted_at`,
  `profiles.profile_completed_at`. `profiles.age_band` already exists —
  Phase 0 confirms and re-uses.
- **Dropped from earlier drafts** (never introduced): `first_name`,
  `last_name`, `gender`, `secondary_role`.
- **Existing columns re-used** (no change): `avatar_url`, `main_role`,
  `roles`, `is_public`, `display_name`, `display_name_ko`,
  `display_name_en`, `username`, `age_band`.

---

## 4. Tone & manner gap + Options A / B / C

### 4.1 Visual language today vs. mockup

| Attribute | Wireframes | Current app (`/login`, `/onboarding/identity`, `/feed`) |
| --------- | ---------- | ------------------------------------------------------- |
| Corners on inputs | Fully oval (`rounded-full` visual)             | `rounded-md` (`src/app/login/page.tsx` L166, L196) |
| Stroke weight     | Ultra-thin, ~1px, `zinc-200`-ish               | 1px `border-zinc-300`, black focus ring            |
| Column width      | Single narrow column, `max-w-sm` visually + huge top padding | Auth: `max-w-sm` (`/login`) / `max-w-md` (`/onboarding`); after auth: `PageShell` variants up to `max-w-6xl` |
| Vertical rhythm   | Very generous (~30vh top gap)                  | `py-12` on auth pages                              |
| Type              | Thin sans, ~48px section titles                | `text-2xl font-semibold text-zinc-900`             |
| Chrome            | No sidebar, no header — a "brand gateway"      | Header/sidebar mount inside authed layout          |
| Copy tone         | Warm, short ("Meet your Theo. Be our Theo.")   | Functional, direct                                 |

### 4.2 Options

**Option A — Front-door only.** Sign-up + Log-in adopt the new
delicate tone. Nothing else in the app changes.
- **File count:** ~10–14 new/renamed files.
  - New: `AuthShell`, `OvalInput`, `OvalSelect`, `PillRadio`,
    `PillButton`, `SignupWizardShell`, `SignupStep{1..4}Page`.
  - Modified: `/login/page.tsx`, `/onboarding/page.tsx`, `/onboarding/identity/page.tsx` (Step 3 lives here now — either move or reuse).
  - Untouched: everything under authed shell (`/feed`, `/my`, `/upload`).
- **Risk:** low — new components sit in isolation. The "reveal moment"
  when the user lands on `/feed` after Step 4 will be a jarring
  stylistic shift, but nothing breaks.
- **Effort:** **M** (Medium, ~5–8 dev-days).
- **Rollback:** trivial — remove the routes; `/login` and
  `/onboarding` fall back to the current implementation via feature flag.

**Option B — Whole-app migration.** All app surfaces (feed, upload,
studio, profile) adopt the new delicate tone. New tokens replace the
`zinc` primitive palette; DS primitives get rewritten.
- **File count:** ~200+ files touch `border-zinc-*` / `rounded-md`.
- **Risk:** high — the existing DS (`04_DESIGN_SYSTEM.md`) is only 5
  months old and is battle-tested for the salon rhythm. Rewriting
  breaks tour scripts, screenshot QA, likely a lot of pixel-tuning.
- **Effort:** **XL** (2–3 months of design system work).
- **Rollback:** near-impossible once tokens ship.
- **Not recommended** for this cycle. Belongs in a separate story
  after we validate the front-door direction with real users.

**Option C — Hybrid: brand-facing surfaces only.** Signup, login,
password reset, invite acceptance, marketing landing pages, and empty
states adopt the new tone. Authed working surfaces stay on today's DS.
- **File count:** ~25–40 files.
  - Everything in A, plus: `/auth/forgot`, `/auth/reset`,
    `/set-password`, `/invites/**`, `unsubscribe`, root `page.tsx`.
- **Risk:** medium — the "brand vs. tool" boundary is a real
  cognitive line that many products use (Notion, Linear, Figma), so
  users tolerate the shift. Requires a shared `AuthShell` /
  `BrandShell` primitive.
- **Effort:** **L** (2 dev-weeks).
- **Recommended default.**

---

## 5. Final decisions (all 13 signed off 2026-08-19)

The table below is the **canonical, sign-off-locked** state of every
decision. Detailed specs for the more involved items (password policy,
username auto-suggest, existing-user banner, wizard state, ToS)
live in §11.

| #   | Topic                              | Decision                                                                                                                                                                                                                                                                              |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Name column shape                  | **Single `full_name text`.** No First/Last split. No `secondary_role`. Rationale: artist mononyms, Korean naming conventions, `display_name_ko/_en` already covers locale. Legal name split is deferred until payments/invoicing elevation, where it will land as `legal_first_name / legal_last_name`. |
| 2   | Gender                             | **Dropped entirely.** No column introduced. Studio may reintroduce as optional free-text later; not on the signup surface.                                                                                                                                                             |
| 3   | Tone & manner scope                | **Option C — hybrid.** New tone lives on auth + brand-facing surfaces only. Authed working shells stay on the current DS. See §4.2.                                                                                                                                                    |
| 4   | Step 4 fields                      | **Fully optional.** `ownership_status` UI is removed — writer auto-stamps `CREATED`. Field mapping (Step 4 ⇄ existing `/upload` columns) is enumerated in §2.5 and §3.3: `title` + `title_{ko|en}` (current locale), `year`, `medium` + `medium_{ko|en}`, `size` (with `parseSizeToDimensionsCm` auto-fill), `story` + `story_{ko|en}`, single primary image. |
| 5   | OAuth providers                    | **Google + Apple in Phase 3.** KakaoTalk deferred. Implementation: `signInWithOAuth` (Supabase). Requires per-provider Supabase env vars (`SUPABASE_AUTH_GOOGLE_CLIENT_ID`, etc.) — parent will set them in Supabase Dashboard. `NEXT_PUBLIC_APP_URL/auth/callback` already whitelisted. |
| 6   | Step 1 email enumeration           | **Anti-enumeration soft path.** Step 1 always advances to Step 2. Duplicate detection continues to ride Supabase's "empty identities" signal on signUp. No dedicated `check_email_available` RPC ships.                                                                                 |
| 7   | Non-artist Step 4 copy             | **Role-aware copy.** Step 4 always renders; body copy switches on `main_role` (see §2.5) so curators / collectors / gallerists see "optional — you can add art later" instead of "artist quick-start".                                                                                    |
| 8   | Password policy                    | **12+ chars minimum**, live strength meter (zxcvbn-lite-style scoring, threshold ≥ 3), and **HIBP k-anonymity** breach check. Helper: `src/lib/auth/passwordPolicy.ts`. See §11.2 for the client-side flow and network shape.                                                            |
| 9   | Existing 59-profile cohort         | **Dismissable "Complete your profile" banner** on authed surfaces. Backed by `profiles.profile_completed_at` (SSOT): banner renders when `profile_completed_at IS NULL`. Dismiss persisted per user in `localStorage` key `signup:v2:banner-dismissed`. **No forced gate** — retention over completeness. See §11.4. |
| 10  | Username                           | **Auto-suggest + editable in Step 3.** Step 1 email local-part → sanitized (alphanumeric + underscore) → uniqueness check → append `2`, `3`, … suffix on collision. Step 3 profile card exposes `@username` field with 300ms debounce uniqueness check. Error surfaces **only** on collision. See §11.3. |
| 11  | KO/EN copy                         | **Worker seeds KO + EN pragmatic drafts** now; designer reviews before Phase 1 ships. Not a Phase 0 blocker.                                                                                                                                                                         |
| 12  | ToS / Privacy consent              | **Passive consent** below the Step 2 submit ("계정 생성 시 [이용약관] 및 [개인정보처리방침]에 동의하는 것으로 간주됩니다." / EN equivalent). Stamped as `profiles.tos_accepted_at = now()` on account creation. New `/legal/terms` + `/legal/privacy` stub pages (SafeMd-rendered placeholder pending legal). See §11.7. |
| 13  | Wizard back / refresh              | **`sessionStorage` draft persistence** under key `signup:v2:draft`. Auto-restored on page load. Cleared on wizard completion, explicit "Start over", or Step 4 skip. Back arrows on Steps 2–4.                                                                                          |

---

## 6. Implementation phases (post-sign-off)

Effort scale: **S** = ≤1 dev-day, **M** = 2–5 days, **L** = 1–2 weeks,
**XL** = >2 weeks.

### Phase 0 · Schema migration & feature flag foundation (**S**) — **SHIPPED 2026-08-19**
- Migration `supabase/migrations/20260820020000_signup_v2_profile_columns.sql`:
  - `alter table public.profiles add column if not exists full_name text;`
  - `alter table public.profiles add column if not exists tos_accepted_at timestamptz;`
  - `alter table public.profiles add column if not exists profile_completed_at timestamptz;`
  - `age_band` already exists — skipped (idempotent).
  - Existing profiles RLS policies cover new columns automatically (owner-scoped `UPDATE` + `SELECT is_public OR owner`). No new policy needed — see §11.1.
- Env flag `NEXT_PUBLIC_SIGNUP_V2` (default `false`). Helper:
  `src/lib/featureFlags/signupV2.ts` (`isSignupV2Enabled()`). Initial
  implementation is a simple env check; ramp logic (10% cookie split
  → 100%) is left as a TODO comment for Phase 6.
- `.env.example` and `docs/03_RUNBOOK.md` updated.
- Files touched: 1 migration + 1 flag helper + 1 env example + 1
  runbook doc + spec doc.
- **UI is deliberately untouched in Phase 0.** All wizard pages ship
  in Phase 1 onward.

### Phase 1 · Signup wizard Steps 1–3 (**M**)
- New primitives in `src/components/authv2/`: `<AuthShell/>`,
  `<OvalInput/>`, `<OvalSelect/>`, `<PillRadio/>`, `<PillButton/>`,
  `<SignupWizardShell/>`.
- New route `/signup` (URL-driven step: `/signup?step=1..3`).
- Step 1: email holding + Step 1 → 2 anti-enumeration signal (see §5 #6).
- Step 2: `full_name` + password (12+, strength meter — HIBP wired in
  Phase 5), passive ToS consent footer, `signUpWithPassword` call.
  Auto-generate username seed (email local-part sanitized + suffix
  dedup) — reserved into wizard state for Step 3.
- Step 3: photo, `age_band`, `main_role`, `@username` (editable +
  debounce), `is_public`. On submit → `upsert_my_profile` +
  `profile_completed_at = now()`.
- Wizard state persisted to `sessionStorage['signup:v2:draft']`.
- Legacy `/onboarding` retired via 301 → `/signup` **only after**
  Phase 6 flag flip to 100%.

### Phase 2 · Signup Step 4 (optional artwork upload) (**M**)
- Mini-uploader for Step 4. Locale-aware writers: current locale of
  the wizard writes both raw and `_ko` / `_en` columns for `title`,
  `medium`, `story`. Runs `parseSizeToDimensionsCm` for structured cm
  dims.
- Auto `ownership_status='CREATED'`; no `claims` insert (see §3.4).
- Role-aware copy (§5 #7). Non-artists see "optional" collapsed view.
- Files touched: ~4 new + 1 shared helper extracted from
  `src/app/upload/page.tsx` (`createArtworkForCreatedIntent`).

### Phase 3 · OAuth (Google + Apple) (**M**)
- Wire `signInWithOAuth({ provider })` on login page + Step 1.
- Callback handling reuses `src/app/auth/callback/page.tsx`; on first
  OAuth login, seed `profiles.full_name` from provider profile if
  available; `profile_completed_at` stays NULL until user finishes
  Step 3 profile card (post-OAuth wizard resume).
- **KakaoTalk deferred** (§5 #5).
- Files touched: ~2 new (provider buttons) + 3 modified (login, Step 1,
  callback).

### Phase 4 · Existing-user banner + legal stubs + placeholder copy (**S**)
- Dismissable banner surfacing on authed shells when
  `profile_completed_at IS NULL` (§11.4). Copy: KO + EN.
- Stub pages `/legal/terms` and `/legal/privacy` (SafeMd-rendered
  placeholder text: "약관 준비 중 — 사용자가 준비 후 교체").
- Files touched: 1 banner component + 1 layout mount + 2 stub route
  files + 2 markdown seed files + 1 i18n messages update.

### Phase 5 · HIBP integration + strength meter polish (**S**)
- `src/lib/auth/passwordPolicy.ts` gains `checkPwnedPassword` (SHA-1
  prefix / suffix range query against `api.pwnedpasswords.com`).
- Strength meter component wired into Step 2 (visual bar + hint copy).
- Bump `MIN_PASSWORD_LENGTH` from 8 → 12 across
  `src/app/onboarding/page.tsx`, `src/app/set-password/page.tsx`,
  `src/app/auth/reset/page.tsx` (Signup v2 is already 12; this
  aligns legacy paths).
- Files touched: 1 lib + 1 meter component + 3 legacy pages + i18n.

### Phase 6 · Rollout (feature flag 10% → 100%) (**S**)
- Extend `src/lib/featureFlags/signupV2.ts` to support a cookie-based
  bucket split (10% initial, 50%, 100%). Bucket assignment stable per
  visitor (hash of `sb-visitor-id` cookie).
- Monitor Supabase auth error rate + drop-off funnel for 1 week per
  step-up.
- Flip legacy `/onboarding` → 301 `/signup` at 100%.

**Grand total effort:** roughly **S + M + M + M + S + S + S ≈ 6–9
dev-weeks single-track** (Phase 2 and Phase 3 can run in parallel with
Phase 1 once primitives from Phase 1 land, dropping wall-clock to
**3–4 weeks with two engineers**).

---

## 7. Reusable existing components

| Concern                | Existing artefact                                                       | Reuse mode           |
| ---------------------- | ----------------------------------------------------------------------- | -------------------- |
| Auth API               | `src/lib/supabase/auth.ts` (signUp, signIn, magic link, reset)          | Direct               |
| Auth-state routing     | `src/lib/identity/routing.ts` (`routeByAuthState`, `loginUrlWithNext`)  | Direct               |
| Password gate          | `MIN_PASSWORD_LENGTH = 8` constant in `onboarding/page.tsx`             | Extract to `lib/auth/password.ts`, import in V2 |
| Anti-enumeration       | `/auth/forgot/page.tsx` "sent for email" pattern                        | Copy pattern         |
| Duplicate email handling | `/onboarding/page.tsx` L111–129 (Supabase empty-identities signal)   | Copy pattern         |
| Username live check    | `src/components/onboarding/UsernameField.tsx` + `checkUsernameAvailability` | Optional (used only if we surface username in wizard) |
| Bilingual name pair    | `src/components/i18n/BilingualFieldPair.tsx`                            | Optional (Step 2)    |
| Identity live preview  | `src/components/onboarding/IdentityPreview.tsx`                         | Optional (Step 3)    |
| Role SSOT              | `src/lib/identity/roles.ts` (`ROLE_KEYS`)                               | Direct               |
| Age taxonomy           | `src/lib/profile/taxonomy.ts` (`ageBandOptions`)                        | Direct               |
| Avatar upload          | `src/lib/supabase/storage.ts` (used from `settings/page.tsx`)           | Direct               |
| Artwork create + claim | `src/app/upload/page.tsx` (`createArtwork` + `createClaimForExistingArtist`) | Extract shared helper |
| Loading mark           | `src/components/brand/TheoLoadingMark.tsx`                              | Direct               |
| Brand mark             | `src/components/brand/TheoLogo.tsx`                                     | Direct               |
| Auth callback          | `src/app/auth/callback/page.tsx`                                        | Direct               |

---

## 8. Risks & mitigations

1. **Tone whiplash at the auth boundary (Option A/C).**
   Users complete a delicate onboarding and land on today's dense
   feed. Mitigation: brief loading transition with the arch mark
   between Step 4 → `/feed`; consider a one-time first-run overlay in
   `/feed` welcoming the user (~150ms of soft brand tone before app UI
   takes over).
2. **New nullable columns and existing rows.**
   All new columns must be `nullable` (or `default null`) so the 59
   existing profiles keep working. Backfill scripts must be idempotent.
3. **OAuth redirect / cookie surface.**
   Google/Apple use PKCE + third-party cookies in Safari private mode.
   Reuse `getAuthOrigin()` from `src/lib/supabase/auth.ts` and add
   provider allowlists in Supabase dashboard. Test on iOS Safari
   private (this is the same class of bug the current `/onboarding`
   already guards with a `try/catch` around `getSession()`).
4. **User enumeration (§5 #6).**
   Documented above; recommendation is to accept a minor UX regression
   to avoid the enumeration channel.
5. **Wizard state loss (browser back / refresh).**
   Persist wizard state to `sessionStorage`; clear on Step 4 success.
6. **Username auto-generation collision.**
   Reuse the DB-side `profiles_username_autogen` trigger already in
   place. Collisions retry with a numeric suffix.
7. **Artist quick-start uploads that later need dedup.**
   Step 4 uploads bypass the `search_works_for_dedup` step. Mitigation:
   run a lightweight `search_works_for_dedup` on the artist's own
   works only (same artist_id → cheap query) before insert, so we
   don't create duplicates of pieces that were pre-loaded by a curator
   via external_artist.
8. **Legal / consent copy.**
   ToS/Privacy footnote is passive-consent style (jurisdictional risk
   in EEA). Legal counsel should sign off on the exact language.

---

## 9. Non-goals

- Full app UI redesign (Option B). Explicitly out of scope; owned by a
  separate story if the parent picks that option.
- Password reset flow visual redesign. Not in the wireframes.
- Delete-account / GDPR export UX. Not in the wireframes.
- Multi-factor auth setup UI. Not in the wireframes.
- Bulk-onboarding for the 12 auth.users with no profile row. Handled
  by the existing `ensure_my_profile` bootstrap RPC; no signup-redesign
  work required.
- Kakao OAuth. Deferred per §5 #5.
- Gender demographics analytics. Even if we ship the column, no
  dashboard consumer is planned in this scope.

---

## 11. Phase 0 foundation details (schema + flag + detailed specs)

This section is the single source of truth for the columns, helpers,
copy strings, and storage keys introduced by Signup v2. Later phases
will read from here.

### 11.1 Schema changes

Migration file: `supabase/migrations/20260820020000_signup_v2_profile_columns.sql`
(shipped 2026-08-19).

```sql
alter table public.profiles
  add column if not exists full_name             text,
  add column if not exists tos_accepted_at       timestamptz,
  add column if not exists profile_completed_at  timestamptz;
```

- **`full_name`** — single name column. See §5 #1.
- **`tos_accepted_at`** — stamped `now()` when the auth account is
  first created via signup. NULL for the existing 59 profiles until
  they trip the banner and re-consent. See §11.7.
- **`profile_completed_at`** — stamped `now()` when Step 3
  (`upsert_my_profile`) writes for the first time via Signup v2.
  Existing 59 profiles are NULL by definition — that's what powers the
  banner (§11.4).
- **`age_band`** — pre-existing (2026-02-14 `profile_v0_fields.sql`).
  Confirmed via MCP `information_schema.columns` query on 2026-08-19.
  No re-add needed.

**RLS**: `profiles` already has owner-scoped `UPDATE` policy
(`profiles_update_rls.sql`) and `is_public OR owner` `SELECT` policy
(`profiles_required_columns_triggers_rls.sql`). The three new columns
inherit these automatically because they are on the same table — no
new policy needed. Confirmed by inspecting existing policies.

**Dropped columns from the earlier draft** (never introduced,
documented for future maintainers):

- `first_name`, `last_name` — replaced by single `full_name`.
- `gender` — dropped entirely.
- `secondary_role` — dropped.

If a future scope introduces legal name split (e.g. payments /
invoicing), add `legal_first_name` / `legal_last_name` as separate
columns rather than backfilling from `full_name`.

### 11.2 Password policy (decision #8)

Helper: `src/lib/auth/passwordPolicy.ts` (introduced in Phase 1).

Rules:
1. `MIN_PASSWORD_LENGTH = 12`.
2. Local strength score ≥ 3 out of 4 (zxcvbn-lite-style scoring; may
   inline a minimal port to avoid the 400KB `zxcvbn` bundle).
3. **HIBP k-anonymity** breach check (Phase 5 activation; Phase 1
   ships the helper with a `checkPwnedPassword` no-op that always
   resolves `false`):

```
1. Client computes SHA-1(password), uppercase hex.
2. Take first 5 hex chars (prefix), remaining 35 chars (suffix).
3. GET https://api.pwnedpasswords.com/range/{prefix}
   with header "Add-Padding: true".
4. Response body is newline-separated "SUFFIX:COUNT" pairs.
5. If any line's SUFFIX matches, count > 0 ⇒ password is pwned. Reject.
6. On network failure, do not block (fail-open with warning telemetry).
```

The full password is never transmitted (k-anonymity). We add the
`Add-Padding: true` header so response length does not leak information
about how many hits the prefix contains.

Copy (KO / EN):
- Too short: `"비밀번호는 최소 12자 이상이어야 해요."` / `"Password must be at least 12 characters."`
- Weak: `"조금 더 복잡한 비밀번호를 사용해 주세요."` / `"Try a stronger password."`
- Pwned: `"이 비밀번호는 알려진 유출 데이터에 포함되어 있어요. 다른 걸 사용해 주세요."` / `"This password appears in known data breaches. Please choose another."`

### 11.3 Username auto-suggest + editable field (decision #10)

**Seed generation** (Step 1, on email submit):
1. Take email local-part (`before @`).
2. Sanitize: lowercase, replace non-alphanumeric with underscore,
   collapse runs, strip leading/trailing underscores.
3. Call `checkUsernameAvailability(seed)` (existing RPC in
   `src/lib/supabase/profiles.ts`).
4. If taken, append `2`, then `3`, …, until available (cap at 20
   attempts; if all taken, fall back to existing
   `user_xxxxxxxx` DB autogen trigger).
5. Store as `wizardDraft.username` in sessionStorage.

**Step 3 field UX**:
- Rendered as `@<input value=...>` inside `<OvalInput/>`.
- On change: 300ms `debounce` → `checkUsernameAvailability(nextValue)`.
- **Success state has no message** (per decision) — no green check, no
  "사용 가능" text.
- **Error state fires only when the check returns "taken"**:
  - KO: `"해당 유저네임은 이미 사용 중입니다."`
  - EN: `"This username is already taken."`
- Empty / too-short surfaces the standard input hint but not a
  hard error.

### 11.4 Existing 59-profile "Complete your profile" banner (decision #9)

Backend SSOT: `profiles.profile_completed_at IS NULL`.

**Where it renders**: authed shells (initially `/feed`, later
`/my`, `/space`, wherever the primary nav is mounted). Component:
`<SignupV2CompletionBanner/>` (Phase 4).

**Client-side dismiss key**: `localStorage['signup:v2:banner-dismissed']`.
Stored as `"true"` on dismiss. When Step 3 later stamps
`profile_completed_at`, banner will not render regardless of the
localStorage key (server is the SSOT).

**Behavior**:
- If `profile_completed_at IS NOT NULL` → do not render.
- If `localStorage['signup:v2:banner-dismissed'] === "true"` → do not
  render (dismiss survives across sessions per browser).
- Otherwise render the banner: title + short body + primary CTA
  ("프로필 완성하기") that routes to `/signup?step=3&resume=1` (a
  Signup-v2 shim that pre-fills the wizard from the current
  `profiles` row, skips Step 1/2, and lands on Step 3).
- Secondary dismiss control (X icon on the banner). Dismiss is
  **soft** — user can always revisit via a Studio → "완성도 낮음"
  hint if needed later.

Copy (KO):
- Title: `"프로필 완성하고 시작해요"`
- Body: `"조금만 채워도 사람들이 더 잘 찾아옵니다."`
- CTA: `"완성하기"`

Copy (EN):
- Title: `"Finish setting up your profile"`
- Body: `"A few more details and people can find you more easily."`
- CTA: `"Complete profile"`

### 11.5 Step 4 role-aware copy + auto CREATED (decision #4, #7)

- **All personas enter Step 4.** UI does NOT branch routes.
- Header + body swap on `main_role`:
  - `artist` → `"Step 4 · Add your first piece"` / `"작품 하나 등록해 볼까요?"`
  - `curator` | `collector` | `gallerist` → `"Step 4 (optional) — you can add art later"` / `"작품 등록은 언제든지 나중에 할 수 있어요."` with the form collapsed under a "Show anyway" disclosure.
- Both flows share the same underlying form + submit handler.
- `ownership_status='CREATED'` is written unconditionally by the
  submit helper (`src/lib/supabase/artworks.ts` gets a new
  `createArtworkForSignup(payload)` wrapper that hides the field).

### 11.6 Wizard state (decision #13)

Key: `sessionStorage['signup:v2:draft']`.

Shape (JSON):

```ts
type SignupV2Draft = {
  version: 1;
  step: 1 | 2 | 3 | 4;
  email?: string;                    // Step 1
  fullName?: string;                 // Step 2 (transient — persisted only until account exists)
  usernameSeed?: string;             // Step 1 auto-suggestion result
  username?: string;                 // Step 3 edited value
  ageBand?: string;                  // Step 3
  mainRole?: "artist" | "curator" | "collector" | "gallerist";
  isPublic?: boolean;                // Step 3
  avatarPath?: string;               // Step 3 (Supabase storage path, not blob)
  step4?: {
    title?: string;
    year?: number;
    medium?: string;
    size?: string;
    story?: string;
    imagePath?: string;              // Supabase storage path
  };
  savedAt: string;                   // ISO
};
```

- Password is **never** stored — the wizard requires re-entry if the
  tab is closed at Step 2 before `signUpWithPassword` runs.
- On Step 4 submit (either Add or Skip), wizard state is cleared.
- On explicit "Start over" (Step 1 CTA), wizard state is cleared.
- On successful account creation (Step 2 → 3 transition), we may
  clear `fullName` immediately since it's now persisted server-side.

### 11.7 ToS / Privacy consent (decision #12)

- Stub pages `/legal/terms` and `/legal/privacy`. Content is rendered
  by an existing `<SafeMd/>` component from a seed markdown file
  (`src/content/legal/terms.<locale>.md`, same for privacy). Initial
  content is a single line: `"약관 준비 중입니다. 조만간 업데이트할 예정이에요."` / `"Terms coming soon. This page is a placeholder."`.
- Footer under Step 2 submit (KO):
  `"계정 생성 시 [이용약관] 및 [개인정보처리방침]에 동의하는 것으로 간주됩니다."`
  where the bracketed segments become link tokens to the stub pages.
- EN equivalent:
  `"By creating an account you agree to the [Terms of Service] and [Privacy Policy]."`
- On successful account creation, wizard submit stamps
  `profiles.tos_accepted_at = now()` via `upsert_my_profile`
  (helper adds the field to its payload; existing RPC signature
  extends without breaking older callers because column is nullable).

### 11.8 Feature flag helper

`src/lib/featureFlags/signupV2.ts`:

```ts
export function isSignupV2Enabled(): boolean {
  return process.env.NEXT_PUBLIC_SIGNUP_V2 === "true";
}
```

Env var: `NEXT_PUBLIC_SIGNUP_V2` (default `"false"`). Local
`.env.local` and Vercel Production/Preview envs both need it.

TODO (Phase 6): extend with cookie-based bucket split — stable per
visitor via hash of `sb-visitor-id` cookie. Signature stays
`(): boolean` so callers don't have to change.

---

## Appendix A — File index for the parent

Audit-only reads (no writes):
- `src/app/login/page.tsx`
- `src/app/onboarding/page.tsx`
- `src/app/onboarding/identity/page.tsx`
- `src/app/auth/callback/page.tsx`
- `src/app/auth/forgot/page.tsx`
- `src/app/set-password/page.tsx`
- `src/app/upload/page.tsx` (intent picker, artwork create)
- `src/lib/supabase/auth.ts`
- `src/lib/identity/routing.ts`
- `src/lib/identity/roles.ts`
- `src/lib/profile/taxonomy.ts`
- `src/lib/provenance/types.ts`
- `src/components/brand/TheoLogo.tsx`
- `src/components/onboarding/UsernameField.tsx`
- `src/components/ds/index.ts`

Supabase MCP queries executed:
- `information_schema.columns` for `profiles`, `artworks`.
- `pg_enum` for `main_role`, `ownership_status`, `artwork_visibility`, etc.
- `pg_constraint` for `claims_claim_type_valid`.
- Row-count sanity: `auth.users=71`, `profiles=59`, `artworks=355`.
- Coverage: `profiles.age_band is null` = 59/59; `avatar_url null` = 47/59; placeholder usernames = 16/59.

No DDL, DML, or migration was applied. Everything above is read-only.
