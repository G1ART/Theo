# Display / Hang Simulation — Render Quality Roadmap

_Living design note. Last updated: 2026-08-19 (Phase 2 painting isolation + mounting realism)._

## Purpose

Track render-quality issues in the P1 "hang your work on the wall"
simulation (`/my/spaces/[id]`, `/space/[token]`) and the sequenced
work needed to close them. This document is deliberately scoped to
_rendering_ — placement math, image treatment, mounting affordance —
and separate from the entitlements / metering / share-token concerns
which have their own roadmaps.

## Diagnosis (2026-08-19)

The P1 milestone shipped a fast placement pipeline (cm↔px projection
via a 4-corner homography, DOM overlays, drag persistence). Real-world
uploads then surfaced two quality issues that were not visible on
synthetic test images:

### Issue 1 — Placement rectangle vs. image aspect

The overlay `<img>` used `object-cover`. The placement rectangle is
derived from the physical `widthCm × heightCm`, so any aspect-ratio
mismatch between the placement and the source photo caused the image
to stretch or crop to fill. The 121.9 × 106.7 cm portrait in the
bug report ended up looking like a slightly-landscape square.

**Fix (this patch)**: swap to `object-contain`. The placement
rectangle stays sized to the true physical dimensions, but the image
letterboxes inside without a single pixel of distortion. Small
transparent margins are the price of never lying about proportions.

### Issue 2 — Background padding + flat sticker look

Photographers routinely shoot a painting inside its wall + frame
context, then upload the whole photo. When we place that photo on a
wall at the painting's cm dimensions, the extra background creates
two problems at once:

1. The aspect ratio disagrees with the physical size — same root
   cause as Issue 1.
2. The image reads as "a photo pasted on the wall" rather than "a
   painting hanging in front of the wall", because there is no depth
   affordance (shadow, bevel, frame).

**Fixes (this patch)**:

- **Mounting stack** on the placement `<div>`:
  `box-shadow: 0 2px 6px rgba(0,0,0,0.18), 0 12px 28px rgba(0,0,0,0.12)`
  plus an `outline: 1px solid rgba(0,0,0,0.10)` hairline and an inset
  top highlight `inset 0 1px 0 rgba(255,255,255,0.18)`. Three cheap
  CSS effects that together push the perceived depth from "flat
  sticker" to "hanging object".
- **Aspect-ratio warning in the inspector**. When the source image
  aspect (from `artwork_images.width/height`) differs from the
  placement's physical aspect by more than the threshold (6% —
  tunable via `ASPECT_MISMATCH_THRESHOLD` in `SpaceEditor.tsx`), we
  surface an amber card explaining that the photo likely has
  background padding, with two CTAs: **긴 축 유지** and
  **짧은 축 유지**. Both snap the placement to the image aspect
  without touching `artworks.width_cm/height_cm` (safe under RLS —
  `space_placements` is owner-scoped; the artwork's canonical size
  never changes and other users' placements are untouched).

### What is NOT fixed in this patch

- Legacy images still carry their background. We warn and offer
  aspect-snap, but the padding pixels are still visible inside the
  letterbox. A true fix requires removing the background from the
  source image (see Photoroom section below).
- The mounting affordance is CSS-only — no proper cast shadow that
  follows the light direction in the room photo, no 3D frame. That's
  scoped out of this patch (see 3D-look section).

## Roadmap

### Now (shipped 2026-08-19)

- [x] `object-contain` on placement image.
- [x] `artwork_images.width/height` piped through
      `ArtworkThumbForScene` (both owner + share paths).
- [x] Aspect-mismatch inspector warning + snap-to-image-aspect action.
- [x] CSS mounting affordance (drop-shadow, border, top highlight) —
      *superseded 2026-08-19 (Phase 2)* by the shared `buildMountLayers`
      stack (see below). The hairline outline is removed because it
      read as a double frame when the source photo already carried
      padding around the painting.

### Phase 2 (shipped 2026-08-19)

Painting isolation (Phase A, both tracks) + realistic mounting
(Phase B, full scope). See HANDOFF 2026-08-19 (29) for the full
change list.

- [x] **Track 1** — `POST /api/ai/artwork-painting-bbox` (`gpt-4o-mini`,
      `detail:"high"`). Client-side canvas crop + `attachArtworkImage`
      as `view_type='cutout'`. Free, no gating. Auto-fires from bulk
      upload after `attachArtworkImage` succeeds; also exposed as
      "여백 자동 제거 (AI)" CTA in `SpaceEditor` inspector for legacy
      artworks.
- [x] **Track 2** — `POST /api/ai/artwork-cutout-alpha` (Photoroom
      v1 segment). Transparent PNG stored as
      `view_type='cutout_alpha'`. Entitlement
      `simulation.premium.cutout` — beta-open to every plan (see
      `PLAN_FEATURE_MATRIX` comment `BETA_UNLIMITED`). CTA labelled
      "고급 배경 분리 (Pro)" with "Beta — 지금은 무료" hint.
      Env: `PHOTOROOM_API_KEY`; unset → route returns 501.
- [x] **Renderer preference** — `renderer2d.ts` now returns
      `imageUrl / resolvedImageSource / resolvedImagePxWidth /
      resolvedImagePxHeight` and prefers
      `cutout_alpha > cutout > primary`. Aspect-mismatch banner
      auto-suppresses when `resolvedImageSource !== 'primary'`.
- [x] **Frame presets** — nullable `space_placements.frame_preset`
      column with 5 values: `none / matte_white_thin / frame_black /
      frame_wood / canvas_edge`. Inspector segmented-control picker
      with per-preset swatches; persists via the existing debounced
      `upsertPlacements` path.
- [x] **Directional shadow** — vision `space.wall_detect` now
      persists `lightDirection` to `space_surfaces.pose` on cleanup
      success. `frameOuterShadowFilter(light)` renders a directional
      CSS `filter: drop-shadow(...)` on the frame wrapper — 12–16 px
      blur, ~15 % opacity, direction flipped so light-from-top-left
      produces shadow-to-bottom-right.
- [x] **Mounting depth** — secondary tighter `drop-shadow(0 2px 3px
      rgba(0,0,0,0.24))` stacked under the primary cast so every
      preset reads as 2–4 mm lifted off the wall.
- [x] **Share view parity** — `/space/[token]` uses the same
      `buildMountLayers` helper so viewers see exactly what the owner
      sees.
- [x] **Public share RPC** — migration
      `20260820000000_space_share_rpc_cutouts.sql` widens the
      `artwork_images.view_type` whitelist and updates
      `get_space_by_share_token` to include `cutout` / `cutout_alpha`
      rows.

### Next: Photoroom cutout pipeline

**Trigger**: inspector button _"이 작품 배경 제거 / Remove background"_,
owner-only, disabled once a cutout already exists for the artwork.

**Pipeline**:

1. User clicks button on a selected placement whose artwork has no
   `view_type='cutout'` image yet.
2. Fire a job that:
   a. Reads the artwork's cover image bytes.
   b. Calls Photoroom's remove-background API. (API key must be
   stored server-side; never reach the browser.)
   c. Writes the cutout PNG (alpha channel intact) to the
   `artworks` bucket under
   `{userId}/cutout/{artworkId}-{uuid}.png`. The existing
   storage RLS shape 1 already permits this.
   d. Inserts a row into `artwork_images` with
   `view_type='cutout'` and pixel dims populated from the
   Photoroom response.
3. The 2D renderer, when picking the cover image for a placement,
   prefers `view_type='cutout'` (if present) over the first
   `sort_order` image. `object-contain` still applies — the cutout
   letterboxes inside the placement rectangle, but with no
   background pixels the placement now reads as a true "painting
   on the wall" regardless of the source photo's framing.

**Metering**: reuse the existing `image.enhance` family
(`ai.image.enhance.request` etc.) or introduce a sibling
`ai.image.cutout.request` — decision deferred until we know the
Photoroom price per call.

**Safety**:

- Cutouts are additive rows in `artwork_images`, never replace the
  original. Owner can toggle back to "use original" in the
  inspector.
- No auto-run on upload. The trigger stays explicit so we don't
  spend Photoroom credits on works where the user is happy with the
  full-context photo (e.g. deliberately-shot in-situ shots).

**Estimated effort**: **M** (~1 focused engineer-day for the API
route + job runner + inspector wire + view_type preference in the
loaders; add half a day if we introduce a new metering key).

### Next: Vision-based painting-bounds auto-detection

An intermediate step short of full background removal: detect the
painting's bounding box _inside_ the uploaded photo and store it as
`artwork_images.display_adjust.crop`. `object-contain` on the crop
rectangle then displays the painting without background, without
producing a full alpha cutout. Cheaper than Photoroom and reusable
for feed / grid surfaces.

**Trigger**: **automatic** on upload of a `view_type='wall_mounted'`
image via the Tier 1 upload wizard.

**Pipeline**:

1. After image compression completes, fire a background job that
   calls `gpt-4o-mini` (vision) with the prompt "return the
   painting's normalized `{x0,y0,x1,y1}` inside the frame".
2. Confidence gate: only apply the crop when the model is
   confident (say, >0.7) AND the crop leaves more than 40 % of the
   image visible (guards against cases where the model latched onto
   a poster in the background).
3. Persist to `artwork_images.display_adjust` (already exists — see
   `20260720000000_artwork_image_display_adjust.sql`).

**Metering**: reuse `ai.vision.*` family; single call per image.

**Safety**:

- The `display_adjust` schema is versioned; a bad row can be
  reverted by nulling the column.
- Simulation renderer already respects `display_adjust.crop` (or
  can be extended to). Original bytes are never modified.

**Estimated effort**: **M–L** (~1.5 engineer-days for the vision
prompt + confidence gating + backfill script + renderer crop
support).

### Deferred: 3D-look rendering (frame, lighting, shadow)

_Superseded 2026-08-19 (Phase 2)_ for the CSS-achievable pieces
(frame chrome + directional shadow). What is still deferred:

- **Ambient / bounce lighting**: belongs in the parametric 3D path
  where we have real geometry.
- **Ambient light matching**: sample the wall's median RGB from
  the room photo and tint the frame accordingly, so a warm-tungsten
  room doesn't render a jarring cool-white matte. Cheap DOM/CSS
  extension; wait for user feedback on whether the current fixed
  matte reads well enough.
- **Multi-artwork layout helpers**: eye-level guides already exist;
  next up = "auto-align to salon-hang grid" and "space equally"
  bulk actions in the inspector.
- **WebXR AR preview**: "see this space on my wall" via device AR.
  Requires camera permission handoff + a WebXR anchor.
- **NeRF / Gaussian Splatting**: alternative to the parametric 3D
  path; explore when we have real user demand.

## Non-goals

- Do not auto-modify `artworks.width_cm/height_cm` from simulation
  actions. Placement dims are RLS-scoped to the space owner;
  canonical artwork dims affect every other user's placements and
  should only change via the owner's artwork-edit flow.
- Do not add DB columns for any of the above — the existing
  `artwork_images` columns (`width`, `height`, `display_adjust`,
  `view_type`) cover the Photoroom and vision-crop plans.
- Do not ship the Photoroom or vision-crop paths inside a
  render-quality patch — each deserves its own patch with metering
  + entitlements review.

## Related code

- `src/components/simulation/SpaceEditor.tsx` — placement overlay
  CSS (`object-contain`, mount stack via `buildMountLayers`) and
  inspector aspect-mismatch card + frame preset picker + cutout
  CTAs.
- `src/app/space/[token]/page.tsx` — share view; same
  `buildMountLayers` stack, read-only.
- `src/lib/simulation/mounting.ts` — shared frame + directional
  shadow + mount depth helpers (Phase 2).
- `src/lib/simulation/scene.ts` — `ArtworkThumbForScene` carries
  `imagePxWidth/imagePxHeight` + Phase 2 cutout URL/dim fields;
  `ScenePlacement.framePreset`.
- `src/lib/simulation/renderer2d.ts` — image source preference
  (`cutout_alpha > cutout > primary`) + `resolvedImageSource` flag
  consumers use to suppress the aspect-mismatch banner.
- `src/lib/simulation/cutoutClient.ts` — client glue for both
  Track 1 (Vision bbox → canvas crop → upload) and Track 2
  (Photoroom proxy) cutout pipelines.
- `src/lib/supabase/spaces.ts` — `PUBLIC_ARTWORK_SELECT` +
  `pickRendererImages` + `rowToArtworkThumb` mapping (returns
  primary + cutout + cutout_alpha URLs).
- `src/app/api/ai/artwork-painting-bbox/route.ts` — Track 1 Vision
  bbox route.
- `src/app/api/ai/artwork-cutout-alpha/route.ts` — Track 2
  Photoroom proxy route (`PHOTOROOM_API_KEY`).
- `supabase/migrations/20260819050000_space_share_rpc_image_dims.sql`
  — share RPC returns image pixel dims (P1 fix).
- `supabase/migrations/20260820000000_space_share_rpc_cutouts.sql`
  — Phase 2: extend `artwork_images.view_type` enum with `cutout` /
  `cutout_alpha` + share RPC returns them.
- `supabase/migrations/20260820010000_space_placements_frame.sql`
  — Phase 2: `space_placements.frame_preset` nullable text column.

## Threshold tuning log

- **2026-08-19**: initial `ASPECT_MISMATCH_THRESHOLD = 0.06` (6%).
  Chosen from the audit sample: JPEG rounding stays under 2 %,
  padded uploads land at 30–50 %. Revisit if we see false positives
  from tight-crop uploads or misses on subtle padding.
