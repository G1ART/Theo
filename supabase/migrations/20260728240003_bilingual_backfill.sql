-- QA 2026-07-28 — legacy 값 → KO/EN 슬롯 best-effort 백필 (Track A · Foundation)
--
-- 규칙
-- ----
--   * legacy 컬럼에 한글(AC00-D7AF) 이 하나라도 있으면 → *_ko 슬롯
--   * 그 외 (라틴/숫자만) → *_en 슬롯
--   * 대상 슬롯이 이미 채워져 있으면 절대 덮어쓰지 않는다 (idempotent)
--   * legacy 컬럼은 손대지 않는다 (검색·옛 렌더 fallback 유지)
--
-- 트리거 (240004) 가 이 백필 이후에 걸리므로 백필 update 는 트리거 실행을
-- 유발할 수 있다. 트리거는 legacy 로부터 KO/EN 로 되돌려 쓰지 않고 반대
-- 방향만 sync 하기 때문에 안전하다 (240004 참고).

begin;

-- profiles.display_name → display_name_ko / display_name_en
update public.profiles
   set display_name_ko = display_name
 where display_name_ko is null
   and coalesce(trim(display_name), '') <> ''
   and display_name ~ '[가-힣]';

update public.profiles
   set display_name_en = display_name
 where display_name_en is null
   and display_name_ko is null
   and coalesce(trim(display_name), '') <> ''
   and display_name !~ '[가-힣]';

-- profiles.bio → bio_ko / bio_en
update public.profiles
   set bio_ko = bio
 where bio_ko is null
   and coalesce(trim(bio), '') <> ''
   and bio ~ '[가-힣]';

update public.profiles
   set bio_en = bio
 where bio_en is null
   and bio_ko is null
   and coalesce(trim(bio), '') <> ''
   and bio !~ '[가-힣]';

-- profiles.artist_statement → artist_statement_ko / artist_statement_en
update public.profiles
   set artist_statement_ko = artist_statement
 where artist_statement_ko is null
   and coalesce(trim(artist_statement), '') <> ''
   and artist_statement ~ '[가-힣]';

update public.profiles
   set artist_statement_en = artist_statement
 where artist_statement_en is null
   and artist_statement_ko is null
   and coalesce(trim(artist_statement), '') <> ''
   and artist_statement !~ '[가-힣]';

-- artworks.title → title_ko / title_en
update public.artworks
   set title_ko = title
 where title_ko is null
   and coalesce(trim(title), '') <> ''
   and title ~ '[가-힣]';

update public.artworks
   set title_en = title
 where title_en is null
   and title_ko is null
   and coalesce(trim(title), '') <> ''
   and title !~ '[가-힣]';

-- artworks.medium → medium_ko / medium_en
update public.artworks
   set medium_ko = medium
 where medium_ko is null
   and coalesce(trim(medium), '') <> ''
   and medium ~ '[가-힣]';

update public.artworks
   set medium_en = medium
 where medium_en is null
   and medium_ko is null
   and coalesce(trim(medium), '') <> ''
   and medium !~ '[가-힣]';

-- artworks.story → story_ko / story_en
update public.artworks
   set story_ko = story
 where story_ko is null
   and coalesce(trim(story), '') <> ''
   and story ~ '[가-힣]';

update public.artworks
   set story_en = story
 where story_en is null
   and story_ko is null
   and coalesce(trim(story), '') <> ''
   and story !~ '[가-힣]';

-- projects.host_name → host_name_ko / host_name_en
update public.projects
   set host_name_ko = host_name
 where host_name_ko is null
   and coalesce(trim(host_name), '') <> ''
   and host_name ~ '[가-힣]';

update public.projects
   set host_name_en = host_name
 where host_name_en is null
   and host_name_ko is null
   and coalesce(trim(host_name), '') <> ''
   and host_name !~ '[가-힣]';

-- external_artists: 20260727200000 은 컬럼만 추가하고 backfill 은 스킵했음.
-- 여기서 legacy display_name 을 동일 규칙으로 백필.
update public.external_artists
   set display_name_ko = display_name
 where display_name_ko is null
   and coalesce(trim(display_name), '') <> ''
   and display_name ~ '[가-힣]';

update public.external_artists
   set display_name_en = display_name
 where display_name_en is null
   and display_name_ko is null
   and coalesce(trim(display_name), '') <> ''
   and display_name !~ '[가-힣]';

commit;
