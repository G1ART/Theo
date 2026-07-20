-- 2026-07-20 — artwork_images.display_adjust (feed image standardization).
--
-- Purpose: allow the platform to display grid/feed thumbnails with a
-- gentle "Theo standard" tone (brightness / contrast / saturation) and
-- an optional crop rectangle, WITHOUT touching the original pixels.
--
-- Design contract (why this shape):
--   * Non-destructive: the original file in Storage is never rewritten,
--     never re-encoded, never replaced. This single column stores only
--     display adjustments that the client applies via CSS `filter` and
--     transform on grid surfaces. Detail / lightbox surfaces IGNORE
--     this column and render the original.
--   * Additive JSON so the vocabulary can evolve without further
--     migrations (e.g. per-viewport crop, later a `warmth` axis, etc.).
--   * Nullable → "unset" = render original as before. The column is
--     safe to deploy before any UI ships.
--   * No RLS changes: `display_adjust` sits on the same row as
--     `storage_path` and inherits the existing owner-scoped policies
--     (artist / lister via claim / account-delegate). Nothing to add.
--
-- Payload schema (informal, enforced client-side):
--   {
--     "v": 1,                 -- schema version, allows forward compat
--     "b": 1.00,              -- brightness multiplier (CSS filter brightness())
--     "c": 1.00,              -- contrast multiplier    (CSS filter contrast())
--     "s": 1.00,              -- saturation multiplier  (CSS filter saturate())
--     "crop": {               -- optional; normalized coords in [0,1]
--       "x": 0.05, "y": 0.05, -- top-left of visible rect on ORIGINAL
--       "w": 0.90, "h": 0.90
--     }
--   }
--
-- Any missing key falls back to the neutral value (b/c/s → 1.0, crop → full
-- image). Callers must clamp b/c/s to a gentle range (see
-- `src/lib/image/displayAdjust.ts`) so an accidental bad write can never
-- produce an unreadable image.

begin;

alter table public.artwork_images
  add column if not exists display_adjust jsonb;

comment on column public.artwork_images.display_adjust is
  '2026-07-20 (feed image standardization): optional per-image display adjustments applied ONLY on grid/feed surfaces via CSS filter+transform. NULL = render original as before. Schema: { v:int, b/c/s:number (brightness/contrast/saturation multipliers), crop:{x,y,w,h} in [0,1] }. Original storage pixels are never modified — this column is a non-destructive display layer.';

commit;
