-- 2026-08-05 — Theo Image Enhance (Beta) 도메인 스키마 추가.
--
-- 이 마이그레이션은 세 가지를 additive 하게 추가한다:
--   1. artwork_images.enhancement_meta jsonb — 사용자가 승인한 보정본에
--      대한 provider/mode/recipe/confidence/sourceHash/처리시각/latency
--      envelope. Legacy row 는 NULL 로 남는다.
--   2. exhibition_media.enhancement_meta jsonb — 전시 미디어 (이미지)
--      쪽도 동일한 파리티를 확보. PDF media 는 이 컬럼을 사용하지 않는다.
--   3. plan_feature_matrix seed — `ai.image_enhance` 를 모든 플랜에 open
--      (Beta). quota 는 두지 않는다 — 사용량 계측만 진행하고, 향후 프리/
--      프로 티어 경계를 결정할 근거를 만든다.
--
-- Storage RLS
-- -----------
-- `{userId}/enhanced/`, `{userId}/enhanced-staging/`,
-- `exhibition-media/{exhibitionId}/enhanced/`,
-- `exhibition-media/{exhibitionId}/enhanced-staging/` 경로 모두
-- 기존 `can_manage_artworks_storage_path` (첫 세그먼트가 auth.uid()
-- 이거나 exhibition-media 하위인지 확인) 정책이 자동으로 커버한다.
-- 따라서 새 RLS 정책은 필요하지 않다. (2026-08-05 확인)

begin;

-- ── 1. artwork_images.enhancement_meta ────────────────────────────────
alter table public.artwork_images
  add column if not exists enhancement_meta jsonb;

comment on column public.artwork_images.enhancement_meta is
  'Theo Image Enhance (Beta) 결과 envelope. jsonb: { provider, mode, recipe, confidence, sourceHashSha256, processedAtIso, latencyMs, versions }. NULL = 사용자가 보정을 선택하지 않았거나 legacy row. 원본은 항상 original_storage_path 에 보존된다.';

-- ── 2. exhibition_media.enhancement_meta (parity) ─────────────────────
-- 전시 이미지에도 동일한 flow 를 제공하므로 파리티를 위해 추가.
alter table public.exhibition_media
  add column if not exists enhancement_meta jsonb;

comment on column public.exhibition_media.enhancement_meta is
  'Theo Image Enhance (Beta) 결과 envelope — artwork_images.enhancement_meta 와 동일 shape. media_kind = image 인 row 에서만 값이 채워지고, PDF row 는 NULL 로 남는다.';

-- ── 3. plan_feature_matrix seed (Beta open) ───────────────────────────
-- Additive 패턴은 20260501000000_p1_ai_feature_keys.sql 참조. quota 는
-- 이번 릴리즈에서 두지 않는다 (베타 shadow-tracking 목적).
insert into public.plan_feature_matrix (plan_key, feature_key) values
  ('free',              'ai.image_enhance'),
  ('artist_pro',        'ai.image_enhance'),
  ('discovery_pro',     'ai.image_enhance'),
  ('hybrid_pro',        'ai.image_enhance'),
  ('gallery_workspace', 'ai.image_enhance')
on conflict (plan_key, feature_key) do nothing;

commit;
