-- QA 2026-07-28 — legacy 컬럼 자동 sync 트리거 (Track A · Foundation)
--
-- 목적
-- ----
-- KO/EN 슬롯 중 어느 쪽이 update 되면 legacy 컬럼을 KO 우선으로 갱신한다.
-- pickLegacyTitleForSave / pickLegacyDisplayNameForSave 클라이언트 semantics
-- 와 일치. 이 트리거 도입 후 클라이언트가 legacy 를 명시적으로 세팅하지
-- 않아도 legacy 는 항상 최신값을 유지 → 검색·SEO 안전.
--
-- 규칙
-- ----
--   1) *_ko 나 *_en 중 하나라도 write 이벤트 발생 시 실행 (INSERT/UPDATE)
--   2) legacy = coalesce(trim(new._ko), trim(new._en), old.legacy)
--      - 두 슬롯이 모두 null 이면 legacy 는 이전 값을 유지 (사용자가 직접
--        legacy 를 지우고 싶다면 legacy 컬럼 자체를 직접 set null 해야 함)
--   3) 반대 방향 (legacy → _ko/_en) 은 하지 않는다. 240003 백필 이후에는
--      author-owned KO/EN 슬롯이 진실원. 옛 legacy write 는 그대로 저장되되
--      _ko/_en 이 이미 존재하면 다음 KO/EN write 시 다시 KO 로 덮인다.
--
-- Section-banner 규칙 (release-workflow.mdc): PL/pgSQL 본문이 다수이므로
-- 섹션 배너로 나눠 SQL Editor 에서 highlight → Run 하기 좋게 한다.

begin;

-- == SECTION 1 == profiles: display_name / bio / artist_statement legacy sync
create or replace function public.tg_sync_profile_bilingual_legacy()
returns trigger
language plpgsql
as $a$
declare
  v_ko text;
  v_en text;
begin
  v_ko := nullif(trim(coalesce(new.display_name_ko, '')), '');
  v_en := nullif(trim(coalesce(new.display_name_en, '')), '');
  if v_ko is not null then
    new.display_name := v_ko;
  elsif v_en is not null then
    new.display_name := v_en;
  end if;

  v_ko := nullif(trim(coalesce(new.bio_ko, '')), '');
  v_en := nullif(trim(coalesce(new.bio_en, '')), '');
  if v_ko is not null then
    new.bio := v_ko;
  elsif v_en is not null then
    new.bio := v_en;
  end if;

  v_ko := nullif(trim(coalesce(new.artist_statement_ko, '')), '');
  v_en := nullif(trim(coalesce(new.artist_statement_en, '')), '');
  if v_ko is not null then
    new.artist_statement := v_ko;
  elsif v_en is not null then
    new.artist_statement := v_en;
  end if;

  return new;
end;
$a$;

drop trigger if exists tr_sync_profile_bilingual_legacy on public.profiles;
create trigger tr_sync_profile_bilingual_legacy
  before insert or update of
    display_name_ko, display_name_en,
    bio_ko, bio_en,
    artist_statement_ko, artist_statement_en
  on public.profiles
  for each row execute function public.tg_sync_profile_bilingual_legacy();

-- == SECTION 2 == artworks: title / medium / story legacy sync
create or replace function public.tg_sync_artwork_bilingual_legacy()
returns trigger
language plpgsql
as $b$
declare
  v_ko text;
  v_en text;
begin
  v_ko := nullif(trim(coalesce(new.title_ko, '')), '');
  v_en := nullif(trim(coalesce(new.title_en, '')), '');
  if v_ko is not null then
    new.title := v_ko;
  elsif v_en is not null then
    new.title := v_en;
  end if;

  v_ko := nullif(trim(coalesce(new.medium_ko, '')), '');
  v_en := nullif(trim(coalesce(new.medium_en, '')), '');
  if v_ko is not null then
    new.medium := v_ko;
  elsif v_en is not null then
    new.medium := v_en;
  end if;

  v_ko := nullif(trim(coalesce(new.story_ko, '')), '');
  v_en := nullif(trim(coalesce(new.story_en, '')), '');
  if v_ko is not null then
    new.story := v_ko;
  elsif v_en is not null then
    new.story := v_en;
  end if;

  return new;
end;
$b$;

drop trigger if exists tr_sync_artwork_bilingual_legacy on public.artworks;
create trigger tr_sync_artwork_bilingual_legacy
  before insert or update of
    title_ko, title_en, medium_ko, medium_en, story_ko, story_en
  on public.artworks
  for each row execute function public.tg_sync_artwork_bilingual_legacy();

-- == SECTION 3 == projects: title / host_name legacy sync
-- (20260727200000 은 legacy title sync 를 클라이언트 책임으로 남겼음.
--  여기서 트리거로 승격해 향후 backend 경로에서도 legacy 가 방치되지 않게 한다.)
create or replace function public.tg_sync_project_bilingual_legacy()
returns trigger
language plpgsql
as $c$
declare
  v_ko text;
  v_en text;
begin
  v_ko := nullif(trim(coalesce(new.title_ko, '')), '');
  v_en := nullif(trim(coalesce(new.title_en, '')), '');
  if v_ko is not null then
    new.title := v_ko;
  elsif v_en is not null then
    new.title := v_en;
  end if;

  v_ko := nullif(trim(coalesce(new.host_name_ko, '')), '');
  v_en := nullif(trim(coalesce(new.host_name_en, '')), '');
  if v_ko is not null then
    new.host_name := v_ko;
  elsif v_en is not null then
    new.host_name := v_en;
  end if;

  return new;
end;
$c$;

drop trigger if exists tr_sync_project_bilingual_legacy on public.projects;
create trigger tr_sync_project_bilingual_legacy
  before insert or update of
    title_ko, title_en, host_name_ko, host_name_en
  on public.projects
  for each row execute function public.tg_sync_project_bilingual_legacy();

-- == SECTION 4 == external_artists: display_name legacy sync
create or replace function public.tg_sync_external_artist_bilingual_legacy()
returns trigger
language plpgsql
as $d$
declare
  v_ko text;
  v_en text;
begin
  v_ko := nullif(trim(coalesce(new.display_name_ko, '')), '');
  v_en := nullif(trim(coalesce(new.display_name_en, '')), '');
  if v_ko is not null then
    new.display_name := v_ko;
  elsif v_en is not null then
    new.display_name := v_en;
  end if;
  return new;
end;
$d$;

drop trigger if exists tr_sync_external_artist_bilingual_legacy on public.external_artists;
create trigger tr_sync_external_artist_bilingual_legacy
  before insert or update of
    display_name_ko, display_name_en
  on public.external_artists
  for each row execute function public.tg_sync_external_artist_bilingual_legacy();

commit;
