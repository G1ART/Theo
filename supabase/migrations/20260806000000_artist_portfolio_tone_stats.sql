-- 2026-08-06 — Theo Image Enhance (Beta) 아티스트 포트폴리오 톤 통계
-- RPC (`public.artist_portfolio_tone_stats`).
--
-- Motivation
-- ----------
-- 신규 업로드가 아티스트의 기존 포트폴리오 톤과 이질적이면
-- feed/profile 그리드에서 "다른 사람이 찍은 사진" 처럼 보인다.
-- 이 RPC 는 아티스트가 이미 공개한 작품들의 톤 시그니처를 (mean_luma,
-- mean_chroma, mean_sat, mean_contrast, sample_count) 형태로 반환해,
-- 클라이언트가 새 enhance 결과를 ±4 % 범위 안에서 nudge 할 수 있게
-- 한다.
--
-- Source of truth
-- ---------------
-- 각 이미지의 자체 tone 은 `artwork_images.display_adjust` (b/c/s) +
-- `artwork_images.enhancement_meta` 안의 pro-look 캐시에서 파생된다.
-- v1 rows 에는 display_adjust 만 있고 enhancement_meta 는 NULL 이므로
-- 폴백 값 (b=1, c=1, s=1) 로 계산한다.
--
-- 통계 정의
-- ---------
--   mean_luma      — 평균 밝기 대리값 (b · 128).
--   mean_chroma    — 평균 채도 * 대비 대리값 (c · s · 60).
--   mean_sat       — 평균 채도 (s).
--   mean_contrast  — 평균 대비 (c).
--
-- 위 근사는 실제 픽셀 값이 아니라 아티스트가 커밋한 tone 조정을
-- 기준으로 한 톤 시그니처다. 정확도보다 "그 아티스트 정체성"의
-- 근사 지표라는 점이 더 중요 (feed 배치 nudge 용).
--
-- Guards
-- ------
--   * 아티스트가 아직 공개 작품이 하나도 없으면 sample_count = 0 을
--     리턴 → caller 는 coherence 단계를 스킵해야 한다.
--   * `security invoker` — 조회자의 RLS 로 실행, 즉 caller 가 볼 수
--     없는 비공개 이미지는 통계에 반영되지 않는다.
--   * 인덱스: `artworks(artist_id)` 위에 인덱스 없으면 추가.
--
-- 이 마이그레이션은 PL/pgSQL 함수 정의가 1개뿐이므로 섹션 분리
-- 배너는 사용하지 않는다. (release-workflow rule "PL/pgSQL 함수 정의
-- 다수 포함 시 섹션별로 실행" 은 함수 ≥ 2 개일 때만 적용)

begin;

-- ── 1. artworks(artist_id) 인덱스 확보 (없을 때만 생성) ────────────
create index if not exists artworks_artist_id_idx
  on public.artworks (artist_id)
  where artist_id is not null;

-- ── 2. artwork_images(artwork_id) 인덱스 확보 ─────────────────────
-- 없을 가능성이 높지만, RPC 조인 비용 절감을 위해 idempotent 하게 추가.
create index if not exists artwork_images_artwork_id_idx
  on public.artwork_images (artwork_id);

-- ── 3. RPC: artist_portfolio_tone_stats ───────────────────────────
create or replace function public.artist_portfolio_tone_stats(
  p_artist_profile_id uuid
) returns table (
  mean_luma      numeric,
  mean_chroma    numeric,
  mean_sat       numeric,
  mean_contrast  numeric,
  sample_count   integer
)
language sql
stable
security invoker
set search_path = public
as $q$
  with imgs as (
    select
      coalesce(
        (ai.display_adjust ->> 'b')::numeric,
        1
      ) as b,
      coalesce(
        (ai.display_adjust ->> 'c')::numeric,
        1
      ) as c,
      coalesce(
        (ai.display_adjust ->> 's')::numeric,
        1
      ) as s
    from public.artwork_images ai
    join public.artworks a
      on a.id = ai.artwork_id
    where a.artist_id = p_artist_profile_id
      and coalesce(a.visibility, '') = 'public'
  )
  select
    coalesce(round(avg(b * 128)::numeric, 3), 0) as mean_luma,
    coalesce(round(avg(c * s * 60)::numeric, 3), 0) as mean_chroma,
    coalesce(round(avg(s)::numeric, 4), 1)      as mean_sat,
    coalesce(round(avg(c)::numeric, 4), 1)      as mean_contrast,
    count(*)::int                                as sample_count
  from imgs;
$q$;

comment on function public.artist_portfolio_tone_stats(uuid) is
  'Theo Image Enhance (Beta) — 아티스트가 공개한 artwork_images 로부터 톤 시그니처를 집계. Caller 는 sample_count < 3 이면 coherence 단계를 스킵해야 한다. security invoker: 조회자의 RLS 를 그대로 따른다.';

-- ── 4. execute grants ────────────────────────────────────────────
-- authenticated 만 호출 가능. anon 은 명시적으로 제외.
revoke all on function public.artist_portfolio_tone_stats(uuid) from public;
grant execute on function public.artist_portfolio_tone_stats(uuid) to authenticated;

commit;
