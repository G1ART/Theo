-- =============================================================
-- P1 Display / Hang Simulation — feature key + quota seed.
-- =============================================================
--
-- Mirrors the additive pattern used by
-- 20260501000000_p1_ai_feature_keys.sql,
-- 20260503000400_delegation_feature_keys.sql, and
-- 20260729010001_ai_translate_draft_feature_keys.sql. The
-- canonical truncate-and-reseed lives in
-- 20260423123000_seed_plan_matrix.sql; this file is purely
-- additive so re-runs are safe.
--
-- Locked plan allowlist (see docs / parent design):
--   • simulation.2d         → free, artist_pro, discovery_pro,
--                             hybrid_pro, gallery_workspace
--                             (create + edit spaces)
--   • simulation.2d.export  → artist_pro, discovery_pro,
--                             hybrid_pro, gallery_workspace
--                             (share link + image export — Free is
--                             intentionally excluded so free-tier
--                             users can preview privately but must
--                             upgrade to share/export)
--   • simulation.3d         → hybrid_pro, gallery_workspace
--
-- Quota rules seeded here (one per (plan_key, feature_key), per
-- the plan_quota_matrix primary key):
--   • simulation.2d — LIFETIME space-creation ceiling
--       (countEventKeys = ['simulation.space.created'],
--        windowDays = 0):
--         free=2, artist_pro=5, discovery_pro=5,
--         hybrid_pro=20, gallery_workspace=null (unlimited)
--   • simulation.2d.export — MONTHLY share/export ceiling
--       (countEventKeys = ['simulation.render.exported'],
--        windowDays = 30):
--         artist_pro=5, discovery_pro=20, hybrid_pro=50,
--         gallery_workspace=null (unlimited)
--   • simulation.3d — MONTHLY render/export ceiling
--       (countEventKeys = ['simulation.render.exported'],
--        windowDays = 30):
--         hybrid_pro=30, gallery_workspace=null (unlimited)
--
-- Deviation-1 resolution: the parent spec originally asked for a
-- second quota rule on `simulation.2d` (monthly export). Because
-- `plan_quota_matrix.primary key = (plan_key, feature_key)` allows
-- only one rule per pair, we split "share/export" into its own
-- sub-feature key `simulation.2d.export`, mirroring the existing
-- sub-key pattern used by `delegation.*`. The resolver / matrix
-- shape stay unchanged.

begin;

-- 1) plan_feature_matrix — allowlist for the three new keys.
insert into public.plan_feature_matrix (plan_key, feature_key) values
  ('free',              'simulation.2d'),
  ('artist_pro',        'simulation.2d'),
  ('discovery_pro',     'simulation.2d'),
  ('hybrid_pro',        'simulation.2d'),
  ('gallery_workspace', 'simulation.2d'),
  ('artist_pro',        'simulation.2d.export'),
  ('discovery_pro',     'simulation.2d.export'),
  ('hybrid_pro',        'simulation.2d.export'),
  ('gallery_workspace', 'simulation.2d.export'),
  ('hybrid_pro',        'simulation.3d'),
  ('gallery_workspace', 'simulation.3d')
on conflict (plan_key, feature_key) do nothing;

-- 2) plan_quota_matrix — one rule per (plan, feature). "share/export"
-- lives on the sub-key `simulation.2d.export`, not on `simulation.2d`
-- itself, so both metering targets fit the (plan_key, feature_key) PK.
insert into public.plan_quota_matrix (plan_key, feature_key, quota_limit, quota_window_days, count_event_keys) values
  -- simulation.2d — lifetime space-creation ceiling
  ('free',              'simulation.2d',        2,    0,  array['simulation.space.created']),
  ('artist_pro',        'simulation.2d',        5,    0,  array['simulation.space.created']),
  ('discovery_pro',     'simulation.2d',        5,    0,  array['simulation.space.created']),
  ('hybrid_pro',        'simulation.2d',        20,   0,  array['simulation.space.created']),
  ('gallery_workspace', 'simulation.2d',        null, 0,  array['simulation.space.created']),
  -- simulation.2d.export — monthly share/export ceiling (Free omitted → blocked by feature allowlist)
  ('artist_pro',        'simulation.2d.export', 5,    30, array['simulation.render.exported']),
  ('discovery_pro',     'simulation.2d.export', 20,   30, array['simulation.render.exported']),
  ('hybrid_pro',        'simulation.2d.export', 50,   30, array['simulation.render.exported']),
  ('gallery_workspace', 'simulation.2d.export', null, 30, array['simulation.render.exported']),
  -- simulation.3d — monthly render/export ceiling
  ('hybrid_pro',        'simulation.3d',        30,   30, array['simulation.render.exported']),
  ('gallery_workspace', 'simulation.3d',        null, 30, array['simulation.render.exported'])
on conflict (plan_key, feature_key) do update set
  quota_limit       = excluded.quota_limit,
  quota_window_days = excluded.quota_window_days,
  count_event_keys  = excluded.count_event_keys;

commit;
