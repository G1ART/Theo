-- =============================================================
-- P1 Display / Hang Simulation — backfill missing primary
-- `space_surfaces` rows for spaces created via the empty flow.
-- =============================================================
--
-- Root cause
-- ----------
-- `createEmptySpace()` in `src/lib/supabase/spaces.ts` inserted a
-- `spaces` row without ever seeding a `space_surfaces` row. The
-- editor's `primarySurface = state.space.surfaces[0]` is null for
-- those rows, which caused every handler guarded by
-- `if (!primarySurface) return;` (wall dims input, tap-to-place,
-- AI calibrate apply) to silently no-op.
--
-- The client fix (this same commit) now seeds one `role='wall'`
-- surface at create-time. This migration retroactively fills in
-- the row for any active space that shipped through the buggy
-- code path so those users don't have to re-create their space to
-- unlock the editor.
--
-- Idempotent: the `not exists` guard keeps re-runs a no-op.
-- =============================================================

begin;

insert into public.space_surfaces (space_id, role, surface_index)
select s.id, 'wall', 0
  from public.spaces s
 where s.is_active = true
   and not exists (
     select 1
       from public.space_surfaces sf
      where sf.space_id = s.id
        and sf.surface_index = 0
   );

commit;
