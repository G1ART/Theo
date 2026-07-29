-- QA 2026-07-28 — KO/EN 병기 확장 (Track A · Foundation)
--
-- 배경
-- ----
-- 20260727200000 마이그레이션은 projects.title 과 external_artists.display_name
-- 만 bilingual 로 확장했다. 이 세 마이그레이션 세트 (240000-240002) 는
-- 나머지 monolingual 신원/본문 필드에 동일한 additive 패턴을 적용한다.
--
--   * profiles: display_name / bio / artist_statement → 각각 _ko / _en
--   * artworks: title / medium / story → 각각 _ko / _en
--   * projects: host_name → 이미 title 이 bilingual, host_name 만 남았음
--
-- 원칙
-- ----
--   1) legacy 컬럼은 그대로 유지. 검색·SEO·옛 렌더 경로가 여전히 참조.
--   2) sync 는 240004 트리거가 담당 (KO 우선 → EN → 이전 legacy 값).
--   3) backfill (240003) 은 legacy 값에 한글이 있으면 _ko 로, 아니면 _en 로
--      이관. legacy 는 절대 지우지 않음.
--
-- 이 파일은 profiles 만 담당.

begin;

alter table public.profiles
  add column if not exists display_name_ko    text,
  add column if not exists display_name_en    text,
  add column if not exists bio_ko             text,
  add column if not exists bio_en             text,
  add column if not exists artist_statement_ko text,
  add column if not exists artist_statement_en text;

comment on column public.profiles.display_name_ko is
  'QA 2026-07-28 bilingual: 한국어 활동명. 저자가 직접 관리. legacy display_name 은 240004 트리거가 KO 우선으로 sync.';
comment on column public.profiles.display_name_en is
  'QA 2026-07-28 bilingual: English activity name (transliteration NOT auto). legacy display_name mirrored via 240004 trigger.';
comment on column public.profiles.bio_ko is
  'QA 2026-07-28 bilingual: 한국어 자기소개. Author-owned; 240004 trigger keeps legacy bio in sync (KO wins).';
comment on column public.profiles.bio_en is
  'QA 2026-07-28 bilingual: English bio (author-drafted, not machine-translated).';
comment on column public.profiles.artist_statement_ko is
  'QA 2026-07-28 bilingual: 한국어 스테이트먼트. 240004 trigger syncs legacy artist_statement.';
comment on column public.profiles.artist_statement_en is
  'QA 2026-07-28 bilingual: English artist statement.';

-- Search fallback indexes (lower text_pattern) so future cross-language
-- search extensions can reuse them without a rebuild. Not required for
-- correctness today (search still runs against the legacy column).
create index if not exists profiles_display_name_ko_lower_idx
  on public.profiles (lower(display_name_ko));
create index if not exists profiles_display_name_en_lower_idx
  on public.profiles (lower(display_name_en));

commit;
