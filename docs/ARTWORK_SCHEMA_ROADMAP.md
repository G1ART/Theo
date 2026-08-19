# Artwork Schema — 3-Tier Roadmap (2026-08-18)

> **Status**: Audit-only (`main @ 705131f`). No code / DB changes made.
> **Author**: Schema audit worker (2026-08-18).
> **Parallel context**: A separate worker
> (`agent id 2b110824-…` — [작품 크기 파서 + 백필](2b110824-)) is actively
> repairing `size` → `width_cm/height_cm/depth_cm` backfill and hardening
> `parseSizeToDimensionsCm`. This document only touches
> `docs/ARTWORK_SCHEMA_ROADMAP.md` — no file overlap.

---

## 1. Executive Summary

`public.artworks` is a **wide, thin, mostly-optional** table: **355 rows,
36 columns, ~13 nullable free-text / auxiliary slots, 4 enums, and no
required content beyond `title` + `artist_id`**. The result is a working
feed and a scheduled `size`-parser backfill (Chunk A / this week's
[작품 크기 파서 + 백필](2b110824-)) that lands the shape needed for the
2D simulator — but almost every downstream feature (search, filters,
curator surfaces, edition tracking, provenance UI) is bottlenecked by
**free-text fields the app cannot query** and **default enum values that
lie** (100 % of works report `work_form = 'flat_2d'` because the column
was added with a default and never surfaced in upload).

We should restructure now: at **355 rows** a schema change costs one
migration + one backfill script + zero support tickets. At 5 000+ rows
it becomes a multi-week project with user-facing incident risk.

**Three tiers, in delivery order:**

- **Tier 1 — Truth (this sprint).** Finish the in-flight `size` backfill,
  make `dims_confirmed_at` a real signal (only set when a human confirms),
  keep the honest-default posture agreed for `work_form` (spec + note; wait
  for the 3D upload flow to actually flip the default).
- **Tier 2 — Structure (next month).** Promote `medium` from
  free-text-only to **`surface` + `technique` + `medium_notes`** (still
  bilingual), add **edition / signed / framed / weight** slots the
  gallery persona has been asking for, and finally require enough on
  upload that the schema stops producing rows nobody can filter.
- **Tier 3 — Depth (this quarter).** Materials M2M, series/`year_start/end`,
  free-text deprecation story for `size` and `medium`, and a scoped
  provenance-chain audit spun out as its own doc.

---

## 2. Current State (measured)

### 2.1 `public.artworks` columns

Data pulled via MCP `execute_sql` against production
(`information_schema.columns`, `2026-08-18 22:xx PDT`).

| # | Column | Type | Nullable | Default | Filled (of 355) | Notes |
|---|---|---|---|---|---|---|
| 1 | `id` | uuid | NO | `gen_random_uuid()` | 355 (100 %) | PK. |
| 2 | `artist_id` | uuid | NO | — | 355 (100 %) | FK → `profiles.id`. |
| 3 | `title` | text | NO | — | 355 (100 %) | The only required *content* field. |
| 4 | `year` | int4 | YES | — | 346 (97 %) | 21 distinct values. |
| 5 | `medium` | text | YES | — | 348 (98 %) | **103 distinct** free-text values, top 5 all < 10 % coverage. |
| 6 | `size` | text | YES | — | 314 (88 %) | **187 distinct** free-text values (hosu + inches + cm + freeform). |
| 7 | `visibility` | `artwork_visibility` | NO | `'draft'` | 348 public / 7 draft / 0 unlisted / 0 private. |
| 8 | `ownership_status` | `ownership_status` | YES | `'available'` | 324 available, 19 sold, 8 owned, 4 not_for_sale, 0 null. |
| 9 | `pricing_mode` | `pricing_mode` | YES | `'fixed'` | 86 fixed / 269 inquire / 0 null. |
| 10 | `is_price_public` | bool | YES | `false` | 14 true (4 %). |
| 11 | `price_input_amount` | numeric | YES | — | 81 (23 %). |
| 12 | `price_input_currency` | text | YES | `'USD'` | Most rows; 21 non-USD. |
| 13 | `fx_rate_to_usd` | numeric | YES | — | — |
| 14 | `fx_date` | date | YES | — | — |
| 15 | `price_usd` | numeric | YES | — | 24 (6.7 %); 0 rows have USD without FX (invariant holds). |
| 16 | `story` | text | YES | — | 31 (9 %). |
| 17 | `created_at` | timestamptz | NO | `now()` | 355. |
| 18 | `updated_at` | timestamptz | NO | `now()` | 355. |
| 19 | `artist_sort_order` | int8 | YES | — | Owner-sortable rank. Superseded by `profile_artwork_orders` but still read as fallback. |
| 20 | `artist_sort_updated_at` | timestamptz | YES | `now()` | — |
| 21 | `provenance_visible` | bool | NO | `true` | 355 true (0 opted out). |
| 22 | `created_by` | uuid | YES | — | Uploader (may differ from `artist_id` for INVENTORY/CURATED). |
| 23 | `size_unit` | text | YES | — | 167 (47 %). App treats this as `'cm' | 'in' | null`; DB doesn't. |
| 24 | `likes_count` | int4 | NO | `0` | Denormalized cache. |
| 25 | `website_import_provenance` | jsonb | YES | — | **0 rows** (crawl-import panel exists but the audit run has landed nothing yet). |
| 26 | `title_ko` | text | YES | — | 128 (36 %). |
| 27 | `title_en` | text | YES | — | 197 (55 %). |
| 28 | `medium_ko` | text | YES | — | 104 (29 %). |
| 29 | `medium_en` | text | YES | — | 217 (61 %). |
| 30 | `story_ko` | text | YES | — | 21 (6 %). |
| 31 | `story_en` | text | YES | — | 11 (3 %). |
| 32 | `work_form` | `artwork_work_form` | NO | `'flat_2d'` | **355 flat_2d (100 %) — no relief / sculpture_3d / installation / time_based row exists.** |
| 33 | `width_cm` | numeric | YES | — | **0 (0 %) — pre-backfill.** |
| 34 | `height_cm` | numeric | YES | — | **0 (0 %) — pre-backfill.** |
| 35 | `depth_cm` | numeric | YES | — | **0 (0 %) — pre-backfill.** |
| 36 | `dims_confirmed_at` | timestamptz | YES | — | **0 (0 %) — pre-backfill.** |

### 2.2 Enums (all four)

- **`artwork_visibility`**: `public | unlisted | private | draft`. Only
  `public` (348) and `draft` (7) actually used. `unlisted` and `private`
  are defined but **no application code path writes them** — the
  edit/upload flows only surface `public` and `draft` (`validatePublish`
  only knows those two).
- **`artwork_work_form`**: `flat_2d | relief | sculpture_3d | installation
  | time_based`. Only `flat_2d` exists in data (100 %). Added in
  `20260818010000_artwork_dimensionality.sql` with `default 'flat_2d'`,
  never surfaced to the upload/edit UI.
- **`ownership_status`**: `available | owned | sold | not_for_sale`.
  Upload / edit expose all four. Data: 324 / 8 / 19 / 4.
- **`pricing_mode`**: `fixed | inquire`. **Note the enum label is
  `inquire`, not `inquiry`** — audit callers who write `'inquiry'` will
  silently 500. Data: 86 fixed vs 269 inquire; enum default `'fixed'`
  disagrees with the actual majority (a UX foot-gun on partial writes).

### 2.3 Related tables (row counts + shape)

| Table | Rows | Artwork ref | Purpose | Notes |
|---|---|---|---|---|
| `artwork_images` | 356 | `artwork_id` (NOT NULL) | 1..N images per work | **99 % of works have exactly 1 image (350). Only 3 works have 2, none have ≥ 3.** Multi-image feature is technically live but almost unused. |
| `artwork_likes` | 116 | `artwork_id` (NOT NULL) | User ↔ work like | Also mirrored to `artworks.likes_count` (denormalized cache). |
| `artwork_views` | 871 | `artwork_id` (NOT NULL) | Impression log with viewer_id | Insert-only; no aggregate view yet. |
| `artwork_embeddings` | 0 | `artwork_id` (PK) | Image + text embeddings | **Schema wired, zero data.** RLS: owner + public-artwork read. |
| `claims` | 371 | `work_id` (nullable) | Provenance: CREATED / OWNS / INVENTORY / CURATED / EXHIBITED | 354 have `work_id`; 17 are project-scoped. Distribution: CURATED 197, INVENTORY 102, CREATED 58, OWNS 11, EXHIBITED 3. **58 CREATED means only 16 % of works have an explicit CREATED claim — the rest rely on `artist_id`.** |
| `exhibition_works` | 279 | `work_id` (NOT NULL) | Which works are in which exhibition | 277 unique works listed; 275 are in exactly 1 show, 2 in 2..5. |
| `price_inquiries` | 12 | `artwork_id` (NOT NULL) | Inquiry inbox | Also has `source_artwork_id` (attribution). Long tail of `source_*` columns (feed, room, exhibition). |
| `space_placements` | 0 | `artwork_id` (NOT NULL) | 2D simulator placements | Duplicates `width_cm/height_cm/depth_cm` from the work — placement can override for what-if sizing. |
| `profile_artwork_orders` | 42 | `artwork_id` (NOT NULL) | Per-profile custom order | Overrides `artworks.artist_sort_order`. |

Relationship diagram (text):

```
                                    ┌─── artwork_images (356)
                                    ├─── artwork_likes (116)
                                    ├─── artwork_views (871)
                                    ├─── artwork_embeddings (0)
             ┌──> artworks ─────────┼─── claims (371, work-scoped 354)
profiles ────┤    (355 rows)        ├─── exhibition_works (279)  ──> projects
             │                      ├─── price_inquiries (12)
             │                      ├─── space_placements (0)    ──> spaces
             │                      └─── profile_artwork_orders (42)
             │
             └── artists (artist_id = profiles.id) ────> also acts as "uploader" via created_by
```

### 2.4 Bilingual coverage

| Field | KO filled | EN filled | Legacy-only |
|---|---|---|---|
| `title` | 128 / 355 (36 %) | 197 / 355 (55 %) | Some rows have only the legacy `title`; `pickLocalizedArtworkTitle` handles fallback. |
| `medium` | 104 / 355 (29 %) | 217 / 355 (61 %) | Same shape — EN heavy. |
| `story` | 21 / 355 (6 %) | 11 / 355 (3 %) | Bilingual + free-text combined; almost nothing filled. |

The bilingual system itself works (`240004` trigger + `240005` external
artist inheritance + `pickLocalized*` helpers), but the raw content
skew (EN heavy for medium, KO heavy for the tiny story pool) exposes
that we still don't ask for anything actively.

### 2.5 RLS surface (change-impact map)

The `artworks` table has **11 policies** across insert / select / update
/ delete. Any schema change should preserve these predicates:

- `artworks_public_read`: `visibility = 'public'`.
- `artworks_select_public`: `visibility = 'public' AND (artist_id IS NULL OR is_artist_publicly_visible(artist_id))`.
- `artworks_select_follower_accepted`: viewer-relationship follow-through.
- `artworks_select_own`: `artist_id = auth.uid()`.
- `artworks_select_with_claim`: any confirmed claim subject can view.
- Owner writes (INSERT/UPDATE/DELETE + delegate variants — `artworks_owner_write`, `artworks_insert_own`, `artworks_insert_authenticated`, `Allow owner update artwork`, `artworks_update_account_delegate`, `artworks_update_project_delegate`, `artworks_delete_*`).

Rippling children — `artwork_images` (14 policies), `artwork_embeddings`
(4), `artwork_likes` (3), `artwork_views` (2), `claims` (7 including
`claims_select_visibility_or_owner` which JOINs `artwork_artist_id`) —
all resolve via the `artworks` row, so any change to `artist_id`
semantics or a new gating column would need child policy audits.

### 2.6 Free-text pathology — why the structured columns rotted

- **`size`.** The upload wizard writes whatever the artist types into
  the `size` text input (with an explicit `cm`/`in` toggle that lands
  in `size_unit`). The 187 distinct values in production include hosu
  (`20F (73.0 x 60.0 cm)`), bare pairs (`91*72.2`), quoted inches
  (`9" x 12"`), Korean glosses (`53cm x 45.5cm`), and free-form notes
  (`Variable size`). `format.ts::formatSizeForLocale` painstakingly
  reconstructs cm/inch from these strings at render time.
- **`medium`.** 103 distinct values, top 20 covers < 60 %, and the long
  tail is often bilingual mash-ups (`Mixed media on canvas (24k gold,
  한지, 옻)`, `Colors on layered Korean mulberry paper (Hanji) with
  traditional glue mixture (Agyo)`, `장지에 채색, 금박`). Upload uses a
  `datalist` of 14 canonical values from `TAXONOMY.mediumOptions`, but
  because it's `datalist` (not `select`), only ~10 rows out of 348
  actually landed on a canonical value.
- **`work_form` / `width_cm` / `height_cm` / `depth_cm` /
  `dims_confirmed_at`.** Landed via
  `20260818010000_artwork_dimensionality.sql` with a `NOT NULL DEFAULT
  'flat_2d'` (so every legacy row silently became "2D") + four nullable
  numerics that nobody writes to yet. The simulator reads `width_cm`
  directly; the fallback path (50 × 70 cm) exists precisely because
  100 % of legacy rows are null. **This is the trigger for the current
  audit** and the driver for [작품 크기 파서 + 백필](2b110824-).

### 2.7 What actually gates upload today

From `src/app/upload/page.tsx::handleFormNext`:

```
images.length === 0 || !title.trim() || !year || !medium.trim() || !size.trim()
```

Required: **image + title + year + medium (free text) + size (free
text)**. Optional: story, ownership, pricing, edition, framed, signed,
weight, work_form, structured dims, everything else. `medium` and
`size` are required *fields*, not *structured values* — so we get
requirement without utility. The `bulk` upload path is even looser
(no per-row required fields beyond title). `publishArtworksWithProvenance`
only calls `validatePublish` (`title + ownership_status + pricing_mode
+ image`) before flipping to `public`.

### 2.8 What actually reads which field

Grep tour of `artwork.<field>` / column references outside the write
paths:

- `title` / `title_ko` / `title_en` — everywhere (feed cards, detail,
  passport header, provenance history, exhibition cards, notifications,
  price inquiries, opengraph). Bilingual pick via
  `pickLocalizedArtworkTitle`.
- `year` — `ExploreArtworkCard`, `FeedArtworkCard`, `ArtworkCard`,
  `AdvancedVisibilityPanel`. Rendered as ` · ` chip alongside medium.
  **Not queried by any code path** — no year filter, no year facet.
- `medium` — `FeedArtworkCard`, `ExploreArtworkCard`, `ArtworkCard`,
  detail page. Rendered as chip. **Not queried by any code path** — no
  medium facet on feed / explore / search.
- `size` + `size_unit` — read by `format.ts` in feed / explore /
  detail, and by `parseSizeToDimensionsCm` in
  `SpaceEditor.tsx` / `SeeInMySpaceCta.tsx` / the in-flight backfill
  worker.
- `story` / `story_ko` / `story_en` — detail page only.
- `pricing_mode`, `is_price_public`, `price_usd`,
  `price_input_amount`, `price_input_currency`, `fx_rate_to_usd`,
  `fx_date` — feed / detail / price inquiry / library filter. Stable.
- `ownership_status` — detail badge, library filter, upload/edit.
- `visibility` — every list query filters on it; `unlisted` and
  `private` are enum-defined but never written.
- `work_form` / `width_cm` / `height_cm` / `depth_cm` /
  `dims_confirmed_at` — read by `ArtworkPickerSheet.tsx` (2D-only
  filter), `SeeInMySpaceCta.tsx`, `SpaceEditor.tsx`, `renderer2d.ts`
  (fallback path), and detail page (gates the "in my space" CTA).
  **Never written from the upload / edit UI.** The only writers are
  the in-flight backfill worker and the Chunk A migration.
- `provenance_visible` — used by `canViewProvenance` (detail page).
  Not surfaced as an owner-editable toggle.
- `website_import_provenance` — written by
  `/api/import/website/session/[id]/apply/route.ts` when the crawl
  applies parsed fields to a draft. Read: none besides the raw column
  (no audit UI yet). **0 rows.**
- `created_by` — used by `canDeleteArtwork` and by the bulk-library
  filter dropdown.
- `artist_sort_order` / `artist_sort_updated_at` — legacy sort;
  `profile_artwork_orders` is the newer preferred path.

### 2.9 Dead / near-dead fields

- `unlisted` and `private` values on `artwork_visibility` — enum-defined,
  zero data, zero code path that sets them.
- `artwork_embeddings` — table + RLS + FK exist; 0 rows.
- `website_import_provenance` — write path exists; 0 rows landed.
- `artist_sort_order` — superseded by `profile_artwork_orders`; still
  read but with per-profile fallback.
- `dims_confirmed_at` — column exists; **no code path sets it**.

---

## 3. Problem Catalogue (with pinpoint refs)

Priority: **P0** = blocking a current or near-current release,
**P1** = active friction for known users, **P2** = strategic gap,
**P3** = cleanup.

### P0 — Structured dimensions are 100 % null

- **What.** 348 public works have `width_cm IS NULL`, `height_cm IS
  NULL`, `depth_cm IS NULL`, `dims_confirmed_at IS NULL`. The simulator
  falls back to 50 × 70 cm placeholders (`renderer2d.ts` /
  `SpaceEditor.tsx` — see HANDOFF entry (24)).
- **Pinpoint.** `supabase/migrations/20260818010000_artwork_dimensionality.sql`,
  `src/lib/simulation/renderer2d.ts`, `src/components/simulation/SpaceEditor.tsx`,
  `src/app/upload/page.tsx` (no writer).
- **Owner of the fix.** [작품 크기 파서 + 백필](2b110824-) worker
  (parser + backfill script + migration). This roadmap only tracks the
  **cutover** and the **write-side wiring** (Tier 1).

### P0 — `work_form` default lies

- **What.** `NOT NULL DEFAULT 'flat_2d'` set for every legacy row and
  every future insert. 100 % of rows are `flat_2d` in the DB, but only
  ~85–90 % of the actual catalogue is flat 2D (rough eyeball —
  sculpture / installation percentage is unmeasurable while the field
  is a lie). Downstream filters (`ArtworkPickerSheet.tsx`,
  `SeeInMySpaceCta.tsx`) treat legacy = 2D, so 3D works currently
  masquerade as 2D and land in the simulator.
- **Pinpoint.** `supabase/migrations/20260818010000_artwork_dimensionality.sql:33`,
  `src/components/simulation/ArtworkPickerSheet.tsx:14, 86-104`,
  `src/app/artwork/[id]/page.tsx:1268` (`(artwork.work_form ?? "flat_2d") !== "flat_2d"`).
- **Note.** The user has already staked out this fix's boundary: the
  3D upload flow **will** ship separately. This roadmap only carries
  the *decision protocol* for when it does (§ 4.1).

### P0 — Upload writes almost nothing structured

- **What.** `src/app/upload/page.tsx:396` requires
  `image + title + year + medium(text) + size(text)` — but never
  `work_form`, `width_cm/height_cm/depth_cm`, `dims_confirmed_at`,
  `surface`, `technique`, `edition_of_n`, `signed`, `framed`. So even
  after backfill, every *new* upload creates a fresh nullable-dim row
  and a fresh free-text medium string.
- **Pinpoint.** `src/app/upload/page.tsx:396`,
  `src/app/upload/bulk/page.tsx:1533-1541`,
  `src/app/artwork/[id]/edit/page.tsx` (no `work_form` / `width_cm` UI).

### P1 — `medium` is unfilterable free text

- **What.** 103 distinct values. Top 5 (`Acrylic on canvas` 31, `Mixed
  media` 30, `장지에 채색` 23, `acrylic, mother of pearl, 24K gold on
  canvas` 21, `Oil on canvas` 19) cover 35 % of rows; the rest is a
  long tail. No feed / explore filter exists to slice on medium; no
  facet on artist profile; the taxonomy has 14 canonical values that
  ~10 rows actually match.
- **Pinpoint.** `src/app/upload/page.tsx:1512-1516` (datalist only),
  `src/lib/profile/taxonomy.ts:62-77` (canonical list exists),
  `src/components/FeedArtworkCard.tsx:383-389`, `src/components/explore/ExploreArtworkCard.tsx`.

### P1 — `size` free text will not degrade to structured

- **What.** Even after backfill (Tier 1), new uploads continue to write
  free-text `size` first and structured dims later (or never). The
  parser is being hardened by the sibling worker, but the *upload
  contract* still doesn't ask for structured dims. This turns backfill
  into a permanent tax.
- **Pinpoint.** `src/lib/size/format.ts::parseSizeToDimensionsCm` (does
  the work now), `src/app/upload/page.tsx:1518-1608` (writes free
  text + size_unit only), `src/app/upload/bulk/page.tsx:1533-1542`
  (bulk applies same free-text pattern).

### P1 — Bilingual `story` under-adoption is a UX problem

- **What.** 21/11 KO/EN filled out of 355 (~6/3 %). The Story field is
  the primary vehicle for artist narrative on detail pages; low fill
  rate depresses the whole detail experience.
- **Pinpoint.** `src/app/artwork/[id]/page.tsx` (renders when present),
  `src/app/upload/page.tsx:1610-1657` (optional textarea, no prompt or
  scaffolding).

### P1 — `artwork_visibility` enum has dead values

- **What.** `unlisted` and `private` labels defined; 0 rows; 0 writers
  in code. A future "private studio" mode will want them, but until
  then they're a footgun for RLS refactoring (any policy the audit
  writes needs to consider them or it will start behaving strangely
  when we finally use them).
- **Pinpoint.** `pg_type` enum, `src/app/artwork/[id]/edit/page.tsx`
  (only writes `public`/`draft`).

### P2 — No edition / signed / framed / weight / installation notes

- **What.** Gallery and collector personas need: edition size,
  signed/dated flag, framed dimensions, weight (shipping!),
  installation notes, hanging hardware, environmental requirements.
  None of these exist as columns. `story` is used as a catch-all,
  which explains part of the low structured medium fill.
- **Pinpoint.** No writer. Requested implicitly by ownership flow
  (sold/available/reserved) and by curator persona.

### P2 — Series / date range unsupported

- **What.** `year` is a single int. For series works, artists want
  `year_start / year_end`, or a series id (which itself would need a
  new table `artwork_series`). No filter uses year, so this is
  strategic not tactical.
- **Pinpoint.** `src/app/upload/page.tsx:1450-1462`, `year` column.

### P2 — Provenance chain UI vs data mismatch

- **What.** `claims` has 371 rows (CURATED 197 dominates), but the
  detail page's "provenance block" (`ArtworkProvenanceBlock`) uses
  only `getPrimaryClaim` + a linear history. Ownership transfer,
  period conflicts, and multi-owner chains are undocumented. Also
  `claims.visibility` is a raw text column ("public") rather than an
  enum, so it drifts from `artwork_visibility`. This is a big enough
  area that it should be its own audit doc.
- **Pinpoint.** `src/lib/supabase/artworks.ts:255-475`,
  `src/components/ArtworkProvenanceBlock.tsx`, `public.claims`
  table + policies.

### P2 — `artwork_images` is nominally 1..N but 99 % 1

- **What.** 350/353 works have exactly 1 image (`artwork_images`
  count). Multi-image works ship (upload supports it, detail carousel
  supports it) but almost no one uses it. Either promote it in the
  wizard or treat "primary image" as canonical and demote the
  multi-image feature to power-user territory.
- **Pinpoint.** `src/app/upload/page.tsx:1128-1408` (multi-image UI
  works), `artwork_images` rows.

### P3 — Free-text `size` / `medium` deprecation

- **What.** Once `surface + technique + medium_notes` (Tier 2) and
  `width_cm/height_cm/depth_cm + dims_confirmed_at` (Tier 1) are the
  only write path, `size` and `medium` become derived columns. Retain
  them read-only for a release, then plan a hidden write-then-delete
  cycle.

### P3 — `website_import_provenance` orphan

- **What.** Column + write path exist; **0 rows in production**. Either
  the crawler hasn't landed any successful apply (likely), or the
  feature is dormant. Either exercise it or fold the audit
  requirements into the Tier 2 spec.
- **Pinpoint.** `src/app/api/import/website/session/[id]/apply/route.ts:147-158`.

### P3 — `artwork_embeddings` empty

- **What.** Table + RLS + `image_embedding vector`, `text_embedding
  vector`, `embedding_model text`, `image_hash text`, `updated_at`. 0
  rows. If the recommender is planned for a future sprint, keep
  as-is; if not, it's dead weight on the schema surface.

### P3 — `artist_sort_order` legacy

- **What.** Superseded by `profile_artwork_orders` (42 rows). Fallback
  still respected by `applyProfileOrdering`. Deprecate as part of the
  Tier 3 free-text cleanup.

---

## 4. Tier-by-Tier Roadmap

### Tier 1 — Truth (this sprint, ~2 weeks)

**Goal.** Every public work has correct structured dimensions and a
`work_form` that isn't a lie by default. Nothing else changes.

#### 4.1.a Finish the `size` parser + backfill (owner: sibling worker)

- **Column changes.** None. Reuses existing `width_cm / height_cm /
  depth_cm`.
- **UX changes.** Simulator fallback (50 × 70) removed after backfill
  lands cleanly (per HANDOFF (24)'s deferred item).
- **Migration order.** (i) sibling worker ships parser + backfill
  script; (ii) run against prod; (iii) confirm `width_cm IS NULL`
  count drops from 348 → single-digit outliers; (iv) simulator drops
  fallback path; (v) write-side wiring below.
- **Backfill strategy.** SQL migration + one-shot script
  (`scripts/backfill-artwork-dims.ts` already staged) — coalesce'd
  UPDATE keyed on `id`, idempotent.
- **Rollout.** Spec (done via sibling) → migration → backfill → hot-fix
  simulator fallback → cutover.
- **Effort.** M — the parser complexity is the tax; the migration is
  cheap.
- **Risk & mitigation.** Parser mis-classifies an ambiguous string →
  `dims_confirmed_at IS NULL` keeps the "확인 필요" affordance surfaced
  in inspector, so no auto-set is ever promoted to owner-confirmed.

#### 4.1.b `dims_confirmed_at` becomes a real signal

- **Column changes.** None (already exists).
- **UX changes.** Upload wizard (§ 4.1.d) sets `dims_confirmed_at =
  now()` **only when** the artist explicitly types values into the new
  structured `width / height / depth (cm)` inputs. Backfill never sets
  it. Inspector / detail treat NULL as "auto-parsed, subject to
  confirmation" and surface a small "치수 확인" pill.
- **Migration order.** No migration; only application wiring.
- **Backfill.** None (deliberately null-preserving).
- **Rollout.** Piggybacks on 4.1.d.
- **Effort.** S.
- **Risk.** None on schema; UX risk is minor (a new pill).

#### 4.1.c `work_form` default reconciliation (spec-only; write happens with 3D upload)

- **User decision on record.** Leave `work_form` default at `'flat_2d'`
  until the 3D upload flow ships. This roadmap does **not** flip the
  default; it defines the migration + rollout plan the 3D flow story
  will pick up.
- **Column changes** (when the 3D flow lands, not now):
  - Drop the default (either `alter column work_form drop default` or
    change default to `'unknown'` after adding an enum value).
  - Optional: add `'unknown'` label at the head of the enum, migrate
    all rows currently `'flat_2d'` where `dims_confirmed_at IS NULL`
    to `'unknown'`, force the upload wizard to require an explicit
    pick.
- **UX changes.** Upload adds a required radio group
  `2D · relief · 3D · installation · time-based · other` before the
  size step; edit page adds an editable selector.
- **Migration order (deferred).** Add enum label (if we choose) →
  data reclassification → drop default → upload wizard required
  field → 3D-specific fields (depth prompt, weight, install notes).
- **Backfill.** Data reclassification via heuristics + owner reconfirm
  emails (soft — non-blocking).
- **Rollout.** Owned by the 3D upload flow story.
- **Effort.** M for schema + backfill; L for the whole 3D flow.
- **Risk.** Any owner who never reconfirms sits on `'unknown'` for a
  while → all simulator / picker filters must handle `'unknown'` (drop
  from 2D-only surfaces). Mitigation: default the `'flat_2d'` filter
  to also include `'unknown'` when there's no depth signal (or an
  explicit 3D signal).

#### 4.1.d Upload wizard promotes structured dimensions

- **Column changes.** None (columns already exist).
- **UX changes.**
  - Size step: add three number inputs `width_cm / height_cm /
    depth_cm` under the existing `size` text + unit toggle.
  - When the artist types structured values, set `dims_confirmed_at =
    now()`. `size` is still written (kept for display + freeform
    text like "Variable size").
  - When only free-text is provided (legacy path), the row's
    structured cols stay null and the sibling backfill picks them up.
  - Add depth prompt when `work_form ≠ 'flat_2d'` (post-4.1.c;
    guarded by a feature flag until the 3D upload flow ships).
- **Migration order.** Application-only.
- **Backfill.** None.
- **Rollout.** Ship behind a feature flag → smoke test → default on.
- **Effort.** S–M.
- **Risk.** UX regression if the extra inputs friction the wizard.
  Mitigation: keep the free-text `size` optional and default-collapsed
  ("고급 치수 직접 입력") until we can measure the friction.

#### 4.1.e Cutover checklist

- Simulator drops the 50 × 70 fallback in `renderer2d.ts` (owned by
  sibling worker or a follow-up).
- HANDOFF entry.
- Backfill run notes into `docs/HANDOFF.md`.

#### Tier 1 total effort: **M**.

### Tier 2 — Structure (next month, ~4 weeks)

**Goal.** Turn `medium` and other free-text soft-spots into columns the
app can filter and reason about. Give the gallery / collector persona
the required fields they've been asking for.

#### 4.2.a `medium` becomes `surface / technique / medium_notes`

- **Column changes.**
  - Add `surface text` — canonical value from a controlled vocabulary
    ("canvas", "paper", "hanji", "wood", "panel", "screen", "linen",
    "photograph", "textile", "sculpture (bronze)", ...). Nullable
    until Tier 3.
  - Add `technique text` — controlled ("oil", "acrylic", "watercolor",
    "채색 (Korean color painting)", "mixed media", "video",
    "photography", ...). Nullable until Tier 3.
  - Add `medium_notes text` (bilingual: `medium_notes_ko`,
    `medium_notes_en`) — free-text supplement ("with 24k gold leaf",
    "on layered Hanji with Agyo glue").
  - Keep `medium`, `medium_ko`, `medium_en` as legacy read columns
    for one release; a `medium` computed view or trigger keeps them
    in sync.
- **UX changes.**
  - Upload / edit: replace the datalist-medium input with a **surface
    select + technique select + optional medium notes**. Legacy free
    text migrated into `medium_notes_ko/en`.
  - Detail / cards: render `${technique} on ${surface}${medium_notes ? ' (' + medium_notes + ')' : ''}` (localised).
  - Feed / explore: add surface + technique filters (Tier 2.d wiring).
- **Migration order.** Add columns → controlled vocabulary loader
  (seed table) → upload wizard reads it → backfill → cutover.
- **Backfill strategy.** Two-pass:
  1. Heuristic script (fuzzy match to the canonical list — 60–70 %
     coverage expected on top-20 mediums).
  2. Ops UI (or one-time SQL) to sweep the long tail.
  - Legacy `medium` string preserved verbatim in `medium_notes_ko`
    (if KO) or `medium_notes_en` (if EN) as a safety net.
- **Rollout.** Spec (this doc) → migration → parser → backfill → new
  wizard fields dark-launched → default on → deprecate old `medium`
  input.
- **Effort.** M–L (mostly UX + backfill quality).
- **Risk.** Fuzzy matching mis-classifies → owner confirm needed
  before "medium" filters surface. Mitigation: don't build the filter
  UI until backfill quality signs off (>= 90 % non-NULL surface).

#### 4.2.b New optional-but-structured columns

- **Column changes.**
  - `edition_of_n int null` + `edition_number int null` (both null
    for unique works; when either is set, the other is required at
    write time).
  - `signed bool null` (null = unknown; explicit yes/no).
  - `framed bool null` + `framed_width_cm numeric null` +
    `framed_height_cm numeric null` + `framed_depth_cm numeric null`.
  - `weight_g numeric null` (int → numeric to allow fractional kg).
  - `installation_notes text null` (bilingual pair
    `installation_notes_ko/en`).
- **UX changes.**
  - Upload wizard adds a collapsible "Edition / condition / shipping"
    section (default collapsed). Wired up only for owner personas
    that need it (auto-expanded for gallery workspace members).
  - Detail page: new "Details" block below the primary meta chip
    row. Hidden when all values NULL.
- **Migration order.** Add columns → wizard → detail render → filters.
- **Backfill.** None (all null-tolerant).
- **Rollout.** Ship behind a per-workspace feature flag first
  (gallery workspace members) → widen.
- **Effort.** M.
- **Risk.** UX bloat if we open all fields to all personas.
  Mitigation: default-collapsed + gallery-first rollout.

#### 4.2.c Upload wizard required fields expand

- **Column changes.** None.
- **UX changes.** `handleFormNext` gains:
  - `work_form` explicit selection (post-4.1.c).
  - Structured dimensions required when `work_form !== 'time_based'`.
  - `surface` required (once 4.2.a lands).
- **Migration order.** Follows 4.1.c + 4.2.a.
- **Backfill.** None.
- **Rollout.** Ship behind feature flag; A/B measure abandonment.
- **Effort.** S.
- **Risk.** Wizard abandonment. Mitigation: Tier-2 owner-confirm loop
  (email prompt) instead of hard-block for existing draft flows.

#### 4.2.d Explore / feed / library filter wiring

- **Column changes.** None (uses 4.2.a + 4.2.b).
- **UX changes.** Explore adds surface + technique + edition-only +
  signed-only filters. Library ("내 아카이브") gets the same in the
  advanced drawer.
- **Migration order.** Post-backfill.
- **Backfill.** None.
- **Rollout.** Post-backfill signoff.
- **Effort.** M.
- **Risk.** Empty-facet fatigue if the backfill quality lags.
  Mitigation: hide facets whose backing column is < 80 % non-null.

#### 4.2.e `pricing_mode` enum alignment

- **Column changes.** Consider renaming enum label `inquire` →
  `inquiry` to match the everyday spelling. Requires an enum ALTER
  + `pg_dump / restore`-safe migration + all consumers updated. **Or**
  leave as-is (recommended, per user's "가격·통화·FX 리팩터 non-goal").
- **Rollout.** Not this tier.
- **Effort.** S if aligned; else 0.
- **Risk.** N/A.

#### Tier 2 total effort: **M–L**.

### Tier 3 — Depth (this quarter, ~6-8 weeks)

**Goal.** Deprecate free-text `size` / `medium`, introduce structured
materials + series, and hand off the provenance-chain audit as its own
project.

#### 4.3.a `artwork_materials` M2M table

- **Column changes.**
  - Add `public.materials (id uuid pk, kind text /* pigment | ground |
    substrate | binder */, name text, name_ko text, name_en text)`
    seeded with 30–50 curated values.
  - Add `public.artwork_materials (artwork_id uuid, material_id uuid,
    role text, note text)` — many-to-many, sortable.
  - Drop `medium_notes*` in the same release (or migrate its content
    into `note`).
- **UX changes.** Upload adds a chip-picker for materials (autocomplete
  + freeform). Detail renders a compact list. Feed / explore add
  material chip filters.
- **Migration order.** Seed materials → M2M table → wizard picker →
  backfill from `medium_notes` (regex) → deprecate `medium_notes*`.
- **Backfill.** Regex extract known materials from `medium`,
  `medium_ko`, `medium_en`, `medium_notes*`. Long tail via ops UI.
- **Rollout.** Ship dark → migrate → default on.
- **Effort.** L.
- **Risk.** Materials taxonomy scope creep. Mitigation: seed with 30,
  cap add-your-own at 5 per artwork.

#### 4.3.b `year_start / year_end` (series)

- **Column changes.** Add `year_start int null, year_end int null`.
  `year` becomes a computed alias (`coalesce(year, year_end,
  year_start)`) or is kept as the "primary display year". Optionally
  add `series_title text null`.
- **UX changes.** Upload adds a "이 작품은 시리즈의 일부입니다"
  checkbox that reveals series title + year range.
- **Migration order.** Add columns → wizard opt-in → detail render.
- **Backfill.** None.
- **Rollout.** Post-Tier 2 wizard rework.
- **Effort.** S–M.

#### 4.3.c Deprecate free-text `size`

- **Column changes.** Once every writer emits structured dims and
  `dims_confirmed_at IS NOT NULL` on ≥ 95 % of rows: mark `size` /
  `size_unit` deprecated in the ORM types, remove writes, keep as
  read-only, then drop after one release.
- **UX changes.** Detail displays `formatSizeForLocale` output derived
  from `width_cm / height_cm / depth_cm` + owner locale.
- **Migration order.** Type deprecation → writer removal → column
  drop.
- **Backfill.** None (structured is canonical by then).
- **Rollout.** Two releases (deprecation → drop).
- **Effort.** S.

#### 4.3.d Deprecate free-text `medium`

- **Column changes.** Once `surface + technique + artwork_materials`
  are the writers: mark `medium / medium_ko / medium_en` deprecated,
  keep read-only for a release, drop.
- **Rollout / effort.** Same shape as 4.3.c.

#### 4.3.e Provenance chain — spin out its own audit doc

- **Deliverable.** `docs/PROVENANCE_CHAIN_AUDIT.md` (out of scope
  here) covering: multi-owner history, transfer events,
  `claims.visibility` → enum, external artist → onboarded transition
  race, dispute flow, admin merge collision cases (already partially
  handled in `20260814052248_admin_merge_external_artists_claim_collision.sql`).
- **Effort.** L (own project).

#### Tier 3 total effort: **L** (schema is cheap; product story is the
work).

---

## 5. Non-Goals (this roadmap)

- **3D display simulation P2.** Own story; this doc only defines the
  `work_form` protocol at § 4.1.c.
- **Price / currency / FX refactor.** `price_input_amount +
  price_input_currency + fx_rate_to_usd + fx_date + price_usd + KRW
  quick-convert` all work today; no rewrites here.
- **Bilingual system expansion.** The KO/EN pair columns +
  `240004` trigger + `pickLocalized*` helpers are stable and battle-
  tested. Any new bilingual field (`medium_notes_ko/en`,
  `installation_notes_ko/en`) copies the pattern; no framework work.
- **Provenance chain deep dive.** § 4.3.e explicitly spins that out.
- **`artwork_embeddings` activation.** Empty table stays empty for now;
  a recommender project would revive it.

---

## 6. References

### 6.1 In-flight worker

- [작품 크기 파서 + 백필](2b110824-) — `size` parser hardening,
  backfill script (`scripts/backfill-artwork-dims.ts`), simulator
  fallback removal.

### 6.2 Relevant commits (most recent → older)

- `705131f` — 시뮬 편집기 배치·클린업·선택 피드백 3-이슈 근원 픽스 (HEAD).
- `c45be29` — 시뮬 편집기 4-이슈 근원 픽스 + 스페이스 삭제 UX + 베타 무제한.
- `d5775f7` — 업로드 즉시 자동 벽 클린업 (space.wall_detect).
- `33ea1ec` — 시뮬 에디터 P1 hot-fix + 내 공간 → 워크스페이스 타일 이동.
- `c1333e6` — Vision AI 2종 — 공간 자동 스케일 + 업로드 품질 게이트.
- `720f260` — 전시 시뮬레이션 P1 Chunk C — space-first UI + 익명 공유 RPC.
- `dfd3349` — 전시 시뮬레이션 P1 lib 레이어 (Chunk B).
- `d76c9a2` — 전시 시뮬레이션 P1 파운데이션 (스키마·엔타이틀먼트)
  → introduced `20260818010000_artwork_dimensionality.sql` (Chunk A).

### 6.3 Related migrations

- `supabase/migrations/20260818010000_artwork_dimensionality.sql`
  (Chunk A — `work_form / width_cm / height_cm / depth_cm /
  dims_confirmed_at`).
- `supabase/migrations/20260818020000_simulation_feature_keys.sql`
  (simulation entitlements).
- `supabase/migrations/20260818000000_spaces_schema.sql`
  (space / surface / placement).
- `supabase/migrations/20260728240001_bilingual_add_slots.sql` +
  `20260728240004_bilingual_sync_trigger.sql` +
  `20260728240005_bilingual_rpc_extensions.sql` (bilingual pattern the
  Tier 2 additions will copy).

### 6.4 Related docs

- `docs/HANDOFF.md` — release log (recent entries (20)–(24) describe
  Chunk A/B/C + hot-fixes referenced here).
- `docs/THEO_BOARD_DESIGN.md` — schema pattern reference (staff-owned
  moderation flow; not directly related but referenced for RPC style).
- `docs/PROFILE_TAXONOMY.md` — controlled vocabulary pattern the
  Tier 2 `surface / technique` selectors should mirror.

### 6.5 Code entry points (for the reader who wants to trace)

- **Read model.** `src/lib/supabase/artworks.ts` (`ARTWORK_SELECT`,
  `Artwork`, `ArtworkWithLikes`, list helpers).
- **Write path — single upload.** `src/app/upload/page.tsx`.
- **Write path — bulk.** `src/app/upload/bulk/page.tsx`.
- **Write path — edit.** `src/app/artwork/[id]/edit/page.tsx`.
- **Write path — website import.**
  `src/app/api/import/website/session/[id]/apply/route.ts`.
- **Display — detail.** `src/app/artwork/[id]/page.tsx`.
- **Display — feed / explore card.**
  `src/components/FeedArtworkCard.tsx`,
  `src/components/explore/ExploreArtworkCard.tsx`,
  `src/components/ArtworkCard.tsx`.
- **Size util.** `src/lib/size/format.ts`, `src/lib/size/hosu.ts`.
- **Simulation consumers.**
  `src/components/simulation/ArtworkPickerSheet.tsx`,
  `src/components/simulation/SeeInMySpaceCta.tsx`,
  `src/components/simulation/SpaceEditor.tsx`,
  `src/lib/simulation/renderer2d.ts`.
- **Taxonomy.** `src/lib/profile/taxonomy.ts` (canonical mediums
  already declared; Tier 2 promotes to surface + technique).

---

## 7. Roadmap Summary (parent handoff)

**Tier 1 (2 weeks · effort M):**
1. Finish sibling worker's `size` → `width/height/depth_cm` backfill;
   drop simulator's 50 × 70 fallback after cutover.
2. Wire `dims_confirmed_at = now()` when the upload wizard's new
   structured dim inputs are used (never on backfill).
3. Ship the upload-wizard structured-dim inputs (collapsed by default);
   keep the free-text `size` input as a fallback for freeform sizes.

**Tier 2 (4 weeks · effort M–L):**
1. Split `medium` into `surface` + `technique` + bilingual
   `medium_notes_ko/en`; migrate the 103-distinct free-text pool
   through a heuristic pass + ops UI sweep.
2. Add gallery-persona fields: `edition_of_n / edition_number`,
   `signed`, `framed + framed_*_cm`, `weight_g`, bilingual
   `installation_notes_ko/en`.
3. Wire the new columns into Explore / Feed / Library filters and
   expand upload required-field set once backfill signs off.

**Tier 3 (quarter · effort L):**
1. Introduce `artwork_materials` M2M table with a curated seed
   taxonomy; deprecate `medium_notes_*` after backfill.
2. Add `year_start / year_end` (+ optional `series_title`); make
   `year` the primary display.
3. Deprecate free-text `size` and `medium` (two-release cycle each);
   spin out `docs/PROVENANCE_CHAIN_AUDIT.md` as its own project.

**Total roadmap effort:** M + M–L + L ≈ **L** across a quarter.

---

## 8. Open Questions for the Parent (needs stakeholder confirmation)

1. **`work_form` default flip window.** The audit is emphatic that
   defaulting to `'flat_2d'` is a P0 lie. The user's guidance was
   "handled by the 3D upload flow story." **Confirm** that story lands
   in this quarter (not later), otherwise we should ship the
   `'unknown'` enum label + wizard prompt as a *Tier 1* fix (small
   migration, big correctness win). Owner?
2. **Wizard friction budget.** Tier 2's expanded required-field set
   *will* increase upload abandonment. Do we A/B measure and roll
   back if abandonment rises > X %, or accept a hard cutover? Product
   / growth owner call.
3. **Materials taxonomy source of truth.** Should the seed 30 materials
   come from an existing curator list, or do we hire a curator to
   author it? (Impacts Tier 3 timing significantly.)
4. **Gallery workspace gating.** Tier 2.b's edition / framed / weight
   / installation notes fields overlap with the gallery workspace
   feature. Ship as workspace-only (auto-expanded for gallery members,
   hidden for artist personas) or ship to all owners with a
   collapsed section? Product call.
5. **Deprecation of `unlisted` / `private` visibility values.** Delete
   the labels now (safe; 0 usage) or keep them for a future "private
   studio" mode? If keeping, add write paths in Tier 2 so RLS
   refactors can rely on them.
6. **`artwork_embeddings` fate.** Is a recommender project on the
   roadmap this quarter? If yes, Tier 2 should add the write path.
   If no, mark as "deferred" and stop provisioning RLS around it.
7. **`website_import_provenance` — production run.** 0 rows landed to
   date. Is the crawler still being exercised in prod, or has it been
   quietly parked? If parked, Tier 3 should either finish it or
   remove the column.
8. **Multi-image UX.** 99 % of works have 1 image. Do we invest in
   promoting multi-image (Tier 2 UX push) or accept it as
   power-user-only and simplify the detail carousel? Signal from
   sales / partnership team would help.
9. **`claims.visibility` → enum alignment.** Should we align
   `claims.visibility` with `artwork_visibility` (enum, share the
   RLS surface) as part of the Tier 3 provenance audit, or split it
   off now to avoid confusing overlap?
10. **Cutover window for the backfill.** The simulator fallback
    (50 × 70) currently masks the null dims. When does the sibling
    worker's backfill land, and can we schedule the fallback removal
    for the same release window (avoid a lingering "임시 크기" ghost
    period)?
