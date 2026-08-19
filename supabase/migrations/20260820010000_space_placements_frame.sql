-- ============================================================
-- 2026-08-20 Display Simulation Phase 2 — frame preset column
-- ------------------------------------------------------------
-- Phase 2 adds per-placement mounting realism (frame + directional
-- shadow + mounting depth) so a shared /space/[token] view looks
-- like a real exhibition install, not "flat sticker on wall". The
-- persisted piece of that is a single per-placement selector:
--
--   frame_preset text  — nullable
--     null                = platform default (currently 'none')
--     'none'              = today's behaviour (shadow only)
--     'matte_white_thin'  = 2 cm white matte + subtle inner shadow
--     'frame_black'       = 3 cm black flat border + beveled shadow
--     'frame_wood'        = 5 cm warm-wood gradient + grain hint
--     'canvas_edge'       = 0.5 cm gallery-wrap thin cast + edge
--
-- Everything else in the mounting stack (directional shadow, 2-4 mm
-- lift illusion, matte inner shadow) is derived purely from CSS on
-- the client. A DB column is only needed for the preset selector
-- because it's the one piece the user picks explicitly and expects
-- to survive reloads / share links.
--
-- Additive & idempotent; safe to re-apply.
-- ============================================================

begin;

alter table public.space_placements
  add column if not exists frame_preset text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'space_placements_frame_preset_check'
       and conrelid = 'public.space_placements'::regclass
  ) then
    alter table public.space_placements
      add constraint space_placements_frame_preset_check
      check (
        frame_preset is null
        or frame_preset in (
          'none',
          'matte_white_thin',
          'frame_black',
          'frame_wood',
          'canvas_edge'
        )
      );
  end if;
end $$;

comment on column public.space_placements.frame_preset is
  '2026-08-20 Phase 2 — optional per-placement mounting frame preset. '
  'NULL means "use platform default (currently ''none'')". Rendering is '
  'purely CSS in the client; no derived storage.';

commit;
