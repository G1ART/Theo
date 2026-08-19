-- =============================================================
-- Beta Unlimited — Display / Hang Simulation quotas.
-- =============================================================
--
-- Opens up every simulation quota to unlimited during the beta so
-- the "space-first" flow can be exercised without artificial slot
-- pressure. Only `plan_quota_matrix.quota_limit` is nulled;
-- `count_event_keys` and `quota_window_days` are preserved so
-- `usage_events` continues to accrue a faithful baseline that
-- future paid tiers can reference.
--
-- Mirrors the code-side change in
-- `src/lib/entitlements/planMatrix.ts` (see the BETA_UNLIMITED
-- banner above `simulation.2d`). Feature allowlists in
-- `plan_feature_matrix` are intentionally NOT touched — the
-- `BETA_ALL_PAID` override in `betaOverrides.ts` already forces
-- `allowed: true` for every plan during beta.
--
-- -------------------------------------------------------------
-- Post-beta ROLLBACK (restore original caps — run in SQL Editor):
-- -------------------------------------------------------------
-- update public.plan_quota_matrix set quota_limit = 2
--   where plan_key = 'free'              and feature_key = 'simulation.2d';
-- update public.plan_quota_matrix set quota_limit = 5
--   where plan_key = 'artist_pro'        and feature_key = 'simulation.2d';
-- update public.plan_quota_matrix set quota_limit = 5
--   where plan_key = 'discovery_pro'     and feature_key = 'simulation.2d';
-- update public.plan_quota_matrix set quota_limit = 20
--   where plan_key = 'hybrid_pro'        and feature_key = 'simulation.2d';
-- -- gallery_workspace stays null (unlimited)
-- update public.plan_quota_matrix set quota_limit = 5
--   where plan_key = 'artist_pro'        and feature_key = 'simulation.2d.export';
-- update public.plan_quota_matrix set quota_limit = 20
--   where plan_key = 'discovery_pro'     and feature_key = 'simulation.2d.export';
-- update public.plan_quota_matrix set quota_limit = 50
--   where plan_key = 'hybrid_pro'        and feature_key = 'simulation.2d.export';
-- -- gallery_workspace stays null (unlimited)
-- update public.plan_quota_matrix set quota_limit = 30
--   where plan_key = 'hybrid_pro'        and feature_key = 'simulation.3d';
-- -- gallery_workspace stays null (unlimited)
-- -------------------------------------------------------------

begin;

update public.plan_quota_matrix
  set quota_limit = null
  where feature_key in ('simulation.2d', 'simulation.2d.export', 'simulation.3d');

commit;
