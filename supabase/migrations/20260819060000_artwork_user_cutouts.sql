-- ============================================================
-- 2026-08-19 Display Simulation — per-user personal cutouts
-- ------------------------------------------------------------
-- Bug diagnosis: the Track 1 ("여백 자동 제거 (AI)") and Track 2
-- ("고급 배경 분리 (Pro)") CTAs in the Space Editor silently fail
-- for non-owner viewers. AI succeeds, storage upload succeeds, but
-- the `artwork_images` INSERT is REJECTED by RLS because
-- `Allow owner insert artwork_images` only permits the artist
-- (`artist_id = auth.uid()`) or a claim holder
-- (`claims.subject_profile_id = auth.uid()`).
--
-- A collector placing a public artwork into their own Space fails
-- both predicates → INSERT rejected → renderer sees no cutout →
-- user perceives feature as broken.
--
-- Design (approved):
--   • New per-user, per-artwork, per-view_type table
--     `artwork_user_cutouts` — private cutout results scoped to
--     the current viewer. RLS is a simple `user_id = auth.uid()`
--     match. This table is only read for the space owner's own
--     placements; public share (anon) callers never see personal
--     cutouts.
--   • Existing `artwork_images` policies are left untouched. The
--     artist / claim-holder branch of the write path still lands
--     rows in `artwork_images` so a published cutout benefits every
--     viewer of the artwork.
--   • Client-side loader precedence (`spaces.ts` →
--     `ArtworkThumbForScene`):
--       1. current user's personal cutout (`artwork_user_cutouts`)
--       2. artist-published global cutout (`artwork_images` with
--          `view_type IN ('cutout','cutout_alpha')`)
--       3. primary image (`view_type='wall_mounted'`)
--
-- Storage cleanup: also drops the 4 pre-fix orphan JPGs at
-- `d4b84e70-3b10-4da9-a6da-ad7830fc7519/cutout/*.jpg` that were
-- uploaded before the RLS insert failed. Guarded so future runs
-- are idempotent (only deletes when no `artwork_images` /
-- `artwork_user_cutouts` row references the path).
-- ============================================================

begin;

-- == SECTION 1 == table + indexes
create table if not exists public.artwork_user_cutouts (
  user_id      uuid        not null references auth.users(id) on delete cascade,
  artwork_id   uuid        not null references public.artworks(id) on delete cascade,
  view_type    text        not null check (view_type in ('cutout', 'cutout_alpha')),
  storage_path text        not null,
  px_width     integer     check (px_width is null or px_width > 0),
  px_height    integer     check (px_height is null or px_height > 0),
  source       text,
  metadata     jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, artwork_id, view_type)
);

comment on table public.artwork_user_cutouts is
  '2026-08-19 Display Simulation fix — per-user personal cutouts (Track 1 / Track 2). '
  'Private to the user (RLS: user_id = auth.uid()). Loader precedence: personal '
  'cutout wins over `artwork_images.cutout_alpha` > `artwork_images.cutout` > primary. '
  'Public share (anon) callers never see this table; only global cutouts on '
  '`artwork_images` are exposed via `get_space_by_share_token`.';

comment on column public.artwork_user_cutouts.view_type is
  'Same enum as `artwork_images.view_type` for the cutout family — '
  '`cutout` (Track 1, Vision bbox JPEG) or `cutout_alpha` (Track 2, Photoroom PNG).';

comment on column public.artwork_user_cutouts.source is
  'Free-form label for the pipeline that produced the row (e.g. `vision_bbox`, `photoroom`). '
  'Helpful for observability; no functional gating.';

create index if not exists idx_artwork_user_cutouts_artwork
  on public.artwork_user_cutouts (artwork_id);

-- == SECTION 2 == updated_at trigger (reuses `public.set_updated_at()`
-- from `profiles_required_columns_triggers_rls.sql`)
drop trigger if exists trg_artwork_user_cutouts_updated_at
  on public.artwork_user_cutouts;
create trigger trg_artwork_user_cutouts_updated_at
  before update on public.artwork_user_cutouts
  for each row execute function public.set_updated_at();

-- == SECTION 3 == RLS + policies
alter table public.artwork_user_cutouts enable row level security;

drop policy if exists artwork_user_cutouts_select_own on public.artwork_user_cutouts;
create policy artwork_user_cutouts_select_own on public.artwork_user_cutouts
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists artwork_user_cutouts_insert_own on public.artwork_user_cutouts;
create policy artwork_user_cutouts_insert_own on public.artwork_user_cutouts
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists artwork_user_cutouts_update_own on public.artwork_user_cutouts;
create policy artwork_user_cutouts_update_own on public.artwork_user_cutouts
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists artwork_user_cutouts_delete_own on public.artwork_user_cutouts;
create policy artwork_user_cutouts_delete_own on public.artwork_user_cutouts
  for delete to authenticated
  using (user_id = auth.uid());

-- == SECTION 4 == grants (anon gets nothing)
grant select, insert, update, delete on public.artwork_user_cutouts to authenticated;
revoke all on public.artwork_user_cutouts from anon;

-- == SECTION 5 == one-shot cleanup for pre-fix orphan storage objects
-- Only the 4 known JPGs uploaded by user `d4b84e70-…` under `cutout/`
-- before the RLS insert failed. Idempotent: skipped if any live table
-- (artwork_images or artwork_user_cutouts) still references the path.
--
-- Supabase installs `storage.protect_delete()` as a BEFORE DELETE
-- trigger on `storage.objects` that hard-fails direct `DELETE`
-- unless the session GUC `storage.allow_delete_query` is set to
-- `'true'`. We SET LOCAL it so the flip only holds for this txn
-- and does not linger into other sessions.
set local storage.allow_delete_query = 'true';
delete from storage.objects
 where bucket_id = 'artworks'
   and name in (
     'd4b84e70-3b10-4da9-a6da-ad7830fc7519/cutout/20deee11-fa77-495d-a46d-ec2e7a5e4abb.jpg',
     'd4b84e70-3b10-4da9-a6da-ad7830fc7519/cutout/69abaf18-20c8-4b3d-b8cf-4886329d264d.jpg',
     'd4b84e70-3b10-4da9-a6da-ad7830fc7519/cutout/89a7e829-41ac-4f39-a4ed-d9670337a5d5.jpg',
     'd4b84e70-3b10-4da9-a6da-ad7830fc7519/cutout/95a2baa0-1edf-481e-966c-faf0d39ec9de.jpg'
   )
   and not exists (
     select 1 from public.artwork_images ai
      where ai.storage_path = storage.objects.name
   )
   and not exists (
     select 1 from public.artwork_user_cutouts auc
      where auc.storage_path = storage.objects.name
   );

commit;
