-- =============================================================
-- P1 Display / Hang Simulation — foundation schema.
-- =============================================================
--
-- Adds the three tables that hold a user's hanging simulation:
--   • spaces            — one room / view container per user
--   • space_surfaces    — wall/floor/ceiling/freestanding rows a
--                         space exposes for placements. Present
--                         from P1 (`role='wall'`, 1 row per space)
--                         so P2 parametric 3D rooms can add more
--                         surfaces without a schema rewrite.
--   • space_placements  — one artwork placed on a surface, stored
--                         in full 3D (x/y/z cm + rx/ry/rz deg +
--                         w/h/d cm + z_order). The 2D renderer
--                         projects; the future 3D renderer reads
--                         the same rows.
--
-- Owner-scoped RLS follows the shortlists pattern: flat predicate
-- (`owner_id = auth.uid()`) on the parent table, and a
-- `SECURITY DEFINER` helper (`is_space_owner`) for child tables so
-- the child policies do not re-enter the parent's RLS (mirrors
-- 20260422140000_shortlists_rls_recursion_fix.sql).
--
-- Idempotent and additive; safe to re-run.
-- =============================================================

begin;

-- ── spaces ───────────────────────────────────────────────────
create table if not exists public.spaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled space',
  kind text not null default 'room_photo_2d'
    check (kind in ('room_photo_2d','parametric_3d')),
  unit text not null default 'cm' check (unit in ('cm','in')),
  source_shortlist_id uuid references public.shortlists(id) on delete set null,
  width_cm numeric,
  height_cm numeric,
  depth_cm numeric,
  photo_storage_path text,
  photo_original_storage_path text,
  photo_width_px integer,
  photo_height_px integer,
  share_token uuid unique default gen_random_uuid(),
  is_active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_spaces_owner
  on public.spaces (owner_id, updated_at desc);

comment on column public.spaces.owner_id is
  'Authenticated user who owns the space; RLS scopes reads/writes to owner.';
comment on column public.spaces.title is
  'Human title for the space (defaults to "Untitled space").';
comment on column public.spaces.kind is
  'Rendering kind. P1 uses room_photo_2d; parametric_3d is reserved for P2.';
comment on column public.spaces.unit is
  'Display unit for lengths (cm|in). Stored dimensions are always cm.';
comment on column public.spaces.source_shortlist_id is
  'Optional shortlist this space was seeded from; nulled on shortlist delete.';
comment on column public.spaces.width_cm is
  'Overall space width in cm (nullable until user confirms dimensions).';
comment on column public.spaces.height_cm is
  'Overall space height in cm (nullable until user confirms dimensions).';
comment on column public.spaces.depth_cm is
  'Overall space depth in cm; used by future 3D renderer.';
comment on column public.spaces.photo_storage_path is
  'Storage path to the working (display-sized) room photo used by 2D renderer.';
comment on column public.spaces.photo_original_storage_path is
  'Storage path to the untouched upload; kept so we can re-derive display sizes.';
comment on column public.spaces.photo_width_px is
  'Width in pixels of photo_storage_path; used to project cm→px.';
comment on column public.spaces.photo_height_px is
  'Height in pixels of photo_storage_path; used to project cm→px.';
comment on column public.spaces.share_token is
  'Opaque token for the P1 shared /space/[token] read-only view.';
comment on column public.spaces.is_active is
  'Soft-delete flag; false hides the space from owner listings.';
comment on column public.spaces.expires_at is
  'Optional expiry for shared links; enforced by the viewer RPC (Chunk C).';

-- ── is_space_owner helper (defined before child policies) ────
-- SECURITY DEFINER + fixed search_path prevents policy recursion
-- when child tables ask "does the caller own the parent space?"
-- (mirrors is_shortlist_owner from 20260422140000).
create or replace function public.is_space_owner(_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.spaces s
     where s.id = _space_id and s.owner_id = auth.uid()
  );
$fn$;

revoke all on function public.is_space_owner(uuid) from public;
grant execute on function public.is_space_owner(uuid) to anon;
grant execute on function public.is_space_owner(uuid) to authenticated;
grant execute on function public.is_space_owner(uuid) to service_role;

-- ── space_surfaces ───────────────────────────────────────────
create table if not exists public.space_surfaces (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  role text not null default 'wall'
    check (role in ('wall','floor','ceiling','freestanding')),
  surface_index int not null default 0,
  width_cm numeric,
  height_cm numeric,
  photo_corners jsonb,
  pose jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_space_surfaces_space
  on public.space_surfaces (space_id, surface_index);

comment on column public.space_surfaces.space_id is
  'Parent space; cascade delete tears down all surfaces with the space.';
comment on column public.space_surfaces.role is
  'Which architectural surface this row represents (wall|floor|ceiling|freestanding).';
comment on column public.space_surfaces.surface_index is
  'Stable ordinal per space (0-based). Useful when multiple walls exist.';
comment on column public.space_surfaces.width_cm is
  'Surface width in cm; nullable until user calibrates the room.';
comment on column public.space_surfaces.height_cm is
  'Surface height in cm; nullable until user calibrates the room.';
comment on column public.space_surfaces.photo_corners is
  '2D renderer input: {tl,tr,br,bl} normalized corner points on the room photo.';
comment on column public.space_surfaces.pose is
  '3D renderer input: {position, rotation, size} in world coords (reserved P2+).';

-- ── space_placements ─────────────────────────────────────────
create table if not exists public.space_placements (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  surface_id uuid references public.space_surfaces(id) on delete set null,
  artwork_id uuid not null references public.artworks(id) on delete cascade,
  x_cm numeric not null default 0,
  y_cm numeric not null default 0,
  z_cm numeric not null default 0,
  rot_x_deg numeric not null default 0,
  rot_y_deg numeric not null default 0,
  rot_z_deg numeric not null default 0,
  width_cm numeric,
  height_cm numeric,
  depth_cm numeric,
  z_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_space_placements_space
  on public.space_placements (space_id, z_order);

comment on column public.space_placements.space_id is
  'Parent space; cascade delete removes all placements with the space.';
comment on column public.space_placements.surface_id is
  'Optional surface anchor. Freestanding placements may leave this null.';
comment on column public.space_placements.artwork_id is
  'The artwork this placement renders; cascade delete on artwork removal.';
comment on column public.space_placements.x_cm is
  'Local x offset on the surface in cm (or world x for freestanding).';
comment on column public.space_placements.y_cm is
  'Local y offset on the surface in cm (or world y for freestanding).';
comment on column public.space_placements.z_cm is
  'Depth in cm from the surface (0 = flush); reserved for 3D renderer.';
comment on column public.space_placements.rot_x_deg is
  'Rotation about x-axis (degrees); reserved for 3D renderer.';
comment on column public.space_placements.rot_y_deg is
  'Rotation about y-axis (degrees); reserved for 3D renderer.';
comment on column public.space_placements.rot_z_deg is
  'In-plane rotation (degrees); consumed by both 2D and 3D renderers.';
comment on column public.space_placements.width_cm is
  'Override width in cm; falls back to artworks.width_cm when null.';
comment on column public.space_placements.height_cm is
  'Override height in cm; falls back to artworks.height_cm when null.';
comment on column public.space_placements.depth_cm is
  'Override depth in cm; falls back to artworks.depth_cm when null.';
comment on column public.space_placements.z_order is
  'Draw order for overlapping placements (higher = drawn later / on top).';

-- ── RLS ──────────────────────────────────────────────────────
alter table public.spaces           enable row level security;
alter table public.space_surfaces   enable row level security;
alter table public.space_placements enable row level security;

drop policy if exists "spaces_owner_all" on public.spaces;
create policy "spaces_owner_all"
  on public.spaces
  for all
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "space_surfaces_owner_all" on public.space_surfaces;
create policy "space_surfaces_owner_all"
  on public.space_surfaces
  for all
  to authenticated
  using (public.is_space_owner(space_id))
  with check (public.is_space_owner(space_id));

drop policy if exists "space_placements_owner_all" on public.space_placements;
create policy "space_placements_owner_all"
  on public.space_placements
  for all
  to authenticated
  using (public.is_space_owner(space_id))
  with check (public.is_space_owner(space_id));

commit;
