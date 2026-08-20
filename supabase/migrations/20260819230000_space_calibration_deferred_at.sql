-- =============================================================
-- Display Simulation — 2026-08-19 (Required Wall Calibration)
-- =============================================================
--
-- Adds `calibration_deferred_at timestamptz` to `public.spaces`.
--
-- Background
-- ----------
-- The Space Editor promotes wall-size calibration from an optional
-- "정확한 스케일 (고급)" accordion to a REQUIRED post-upload setup
-- step. Users are shown a blocking overlay after upload; they can
-- either complete calibration (via AI object detect or by entering
-- wall dims directly) OR explicitly defer with a "나중에 설정" link.
--
-- Deferrals need to be per-space (not global) so that a user who
-- skipped calibration on one space still sees the setup gate on
-- their next upload. This column stamps `now()` when the user hits
-- the escape hatch; the client also mirrors the value into
-- sessionStorage so the same-tab experience is instant.
--
-- Semantics:
--   • NULL (default)             — space has never been deferred.
--     Overlay behaviour depends only on whether the surface has a
--     scale (`space_surfaces.width_cm`). If null → overlay shows.
--   • non-null timestamptz value — user opted out at least once.
--     Overlay no longer auto-shows; a persistent "벽 크기 미설정"
--     banner is displayed until the scale is set. Clicking the
--     banner's "지금 설정" button re-opens the overlay for that
--     session (session flag `overlayForced`).
--
-- Idempotent: `add column if not exists` guard keeps re-runs a
-- no-op. Column is nullable and has no default, so pre-existing
-- rows are unaffected (null == "never deferred").
-- =============================================================

begin;

alter table public.spaces
  add column if not exists calibration_deferred_at timestamptz;

comment on column public.spaces.calibration_deferred_at is
  'Timestamp when the space owner deferred wall-size calibration '
  'from the required setup overlay. NULL means never deferred '
  '(overlay auto-shows when scale is unset). Set client-side by '
  'the Space Editor and cleared on re-calibration.';

commit;
