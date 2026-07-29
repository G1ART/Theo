-- QA 2026-07-29 (Track α) — ai.translate_draft feature key seed + quota.
--
-- Mirrors the additive pattern used by 20260501000000_p1_ai_feature_keys.sql
-- (Board Pitch Pack) and 20260502000000_p1_ai_keys_extra.sql. The canonical
-- truncate-and-reseed lives in 20260423123000_seed_plan_matrix.sql; this file
-- is purely additive so re-runs are safe.
--
-- Feature key rationale
-- ---------------------
-- 이중언어 인풋의 "AI 초안" 버튼과 `/settings/bilingual` 벌크 대시보드는
-- 짧은 필드 (title/medium/host_name) + 산문 (bio/statement/story/preface)
-- 을 대상 언어로 옮긴 draft 를 반환한다. 사용자는 draft 를 편집·저장하
-- 거나 버릴 수 있으며, 자동 저장은 절대 없다.
--
-- Quota rationale
-- ---------------
-- LLM 비용을 감안해 프리 티어에 월 40회 상한. 프로 계열은 넉넉하게,
-- gallery_workspace 는 무제한. `applyBetaOverride` 가 여전히 유효해서
-- 베타 기간 동안엔 실제로 게이팅되지 않고 shadow-tracking 만 이뤄진다.

begin;

insert into public.plan_feature_matrix (plan_key, feature_key) values
  ('free',              'ai.translate_draft'),
  ('artist_pro',        'ai.translate_draft'),
  ('discovery_pro',     'ai.translate_draft'),
  ('hybrid_pro',        'ai.translate_draft'),
  ('gallery_workspace', 'ai.translate_draft')
on conflict (plan_key, feature_key) do nothing;

insert into public.plan_quota_matrix (plan_key, feature_key, quota_limit, quota_window_days, count_event_keys) values
  ('free',              'ai.translate_draft', 40,   30, array['ai.translate_draft.generated']),
  ('artist_pro',        'ai.translate_draft', 300,  30, array['ai.translate_draft.generated']),
  ('discovery_pro',     'ai.translate_draft', 60,   30, array['ai.translate_draft.generated']),
  ('hybrid_pro',        'ai.translate_draft', 300,  30, array['ai.translate_draft.generated']),
  ('gallery_workspace', 'ai.translate_draft', null, 30, array['ai.translate_draft.generated'])
on conflict (plan_key, feature_key) do update set
  quota_limit       = excluded.quota_limit,
  quota_window_days = excluded.quota_window_days,
  count_event_keys  = excluded.count_event_keys;

commit;
