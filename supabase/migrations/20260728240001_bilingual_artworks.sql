-- QA 2026-07-28 — KO/EN 병기 확장: artworks (Track A · Foundation)
--
-- 작품 3필드 (title / medium / story) 를 additive 로 bilingual 화한다.
-- legacy 컬럼은 유지 · 240004 트리거가 KO 우선으로 sync. 검색 및 옛 렌더
-- 경로 (예: exhibition manage grid) 는 legacy 컬럼을 참조하다가 점진 이관.

begin;

alter table public.artworks
  add column if not exists title_ko  text,
  add column if not exists title_en  text,
  add column if not exists medium_ko text,
  add column if not exists medium_en text,
  add column if not exists story_ko  text,
  add column if not exists story_en  text;

comment on column public.artworks.title_ko is
  'QA 2026-07-28 bilingual: 한국어 작품 제목. legacy title 은 240004 트리거가 KO 우선 sync.';
comment on column public.artworks.title_en is
  'QA 2026-07-28 bilingual: English artwork title (author-drafted).';
comment on column public.artworks.medium_ko is
  'QA 2026-07-28 bilingual: 한국어 매체 표기. legacy medium 은 240004 트리거가 sync.';
comment on column public.artworks.medium_en is
  'QA 2026-07-28 bilingual: English medium (e.g. "Oil on canvas").';
comment on column public.artworks.story_ko is
  'QA 2026-07-28 bilingual: 한국어 작품 스토리. legacy story 는 240004 트리거가 sync.';
comment on column public.artworks.story_en is
  'QA 2026-07-28 bilingual: English artwork story / long-form context.';

create index if not exists artworks_title_ko_lower_idx
  on public.artworks (lower(title_ko));
create index if not exists artworks_title_en_lower_idx
  on public.artworks (lower(title_en));

commit;
