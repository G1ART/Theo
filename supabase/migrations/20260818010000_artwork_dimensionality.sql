-- =============================================================
-- P1 Display / Hang Simulation — artwork dimensionality columns.
-- =============================================================
--
-- Adds:
--   • artwork_work_form enum   — flat_2d | relief | sculpture_3d
--                                | installation | time_based
--   • artworks.work_form        (not null, default 'flat_2d')
--   • artworks.width_cm         (nullable)
--   • artworks.height_cm        (nullable)
--   • artworks.depth_cm         (nullable)
--   • artworks.dims_confirmed_at (nullable timestamptz)
--
-- Additive only. Legacy `size` / `size_unit` columns are
-- intentionally preserved for display; consumers may keep
-- reading them until every path is migrated to width/height/
-- depth_cm.
--
-- Idempotent: safe to re-run.
-- =============================================================

begin;

do $$
begin
  create type public.artwork_work_form as enum (
    'flat_2d', 'relief', 'sculpture_3d', 'installation', 'time_based'
  );
exception when duplicate_object then null;
end $$;

alter table public.artworks
  add column if not exists work_form public.artwork_work_form not null default 'flat_2d',
  add column if not exists width_cm numeric,
  add column if not exists height_cm numeric,
  add column if not exists depth_cm numeric,
  add column if not exists dims_confirmed_at timestamptz;

comment on column public.artworks.work_form is
  'Dimensionality bucket used by simulation + future renderers. Legacy rows default to flat_2d.';
comment on column public.artworks.width_cm is
  'Canonical width in cm (nullable until user confirms). Legacy size/size_unit stays for display.';
comment on column public.artworks.height_cm is
  'Canonical height in cm (nullable until user confirms).';
comment on column public.artworks.depth_cm is
  'Canonical depth in cm (nullable; only meaningful for relief/sculpture/installation).';
comment on column public.artworks.dims_confirmed_at is
  'When the artist explicitly confirmed width/height/depth_cm. Null = auto-inferred/unset.';

commit;
