-- QA 2026-07 Phase 4 (스코프 B) — 전시 title + 외부 작가 display_name bilingual
--
-- 배경
-- ----
-- QA 2: 전시 정보 입력 시 한/영 제목이 모두 존재하는 케이스에 대응할
-- 필드가 없어서 어느 한 쪽만 저장되거나 두 언어가 하나 필드에 붙어
-- 저장되던 문제. 참여 작가명(external_artists.display_name)도 동일.
--
-- 원칙 (사용자 확정)
-- -----------------
-- 스키마 변경은 **additive** — 기존 컬럼(title, display_name)은
-- legacy 로 유지해 이미 저장된 데이터는 손대지 않는다. 신규 저장 시
-- 첫 번째 채워진 언어로 legacy 컬럼을 함께 sync 하여, bilingual 필드를
-- 아직 소비하지 않는 코드 경로(검색, SEO, 옛 리스트 뷰 등)에서도
-- 표시가 유지되게 한다. Sync 는 클라이언트 저장 시점의 책임이며 여기서
-- 트리거로 강제하지 않는다 (덮어쓰기 사고 방지).
--
-- 후속 코드 배선 지점
-- -------------------
-- src/lib/i18n/pickLocalized.ts (신규 헬퍼)
-- src/components/exhibitions/NewExhibitionFormShell.tsx (title 폼)
-- src/app/my/exhibitions/[id]/edit/page.tsx (title 폼)
-- src/app/my/exhibitions/[id]/add/page.tsx (external artist name row)
-- 그 외 display 사이트: src/app/e/[id]/page.tsx, ExploreExhibitionCard,
-- my/exhibitions/page.tsx 등

begin;

-- projects.title_ko / title_en
alter table public.projects
  add column if not exists title_ko text,
  add column if not exists title_en text;

comment on column public.projects.title_ko is
  'QA 2026-07 Phase 4: bilingual title (Korean). Legacy `title` remains as the primary display fallback for callers that have not migrated to pickLocalizedTitle().';
comment on column public.projects.title_en is
  'QA 2026-07 Phase 4: bilingual title (English). Legacy `title` remains as the primary display fallback for callers that have not migrated to pickLocalizedTitle().';

-- external_artists.display_name_ko / display_name_en
alter table public.external_artists
  add column if not exists display_name_ko text,
  add column if not exists display_name_en text;

comment on column public.external_artists.display_name_ko is
  'QA 2026-07 Phase 4: bilingual display name (Korean). Legacy `display_name` is kept in sync with the first-filled language on save.';
comment on column public.external_artists.display_name_en is
  'QA 2026-07 Phase 4: bilingual display name (English). Legacy `display_name` is kept in sync with the first-filled language on save.';

-- 검색 인덱스: 기존 title / display_name 검색은 그대로 두고,
-- 두 언어 필드에 대해 lower(text_pattern) 인덱스만 추가해 나중에
-- 통합 검색 확장 시 재활용한다. 지금 시점에서는 검색 경로가 legacy
-- 컬럼을 여전히 참조하므로 성능 영향 없음.
create index if not exists projects_title_ko_lower_idx
  on public.projects (lower(title_ko));
create index if not exists projects_title_en_lower_idx
  on public.projects (lower(title_en));
create index if not exists external_artists_display_name_ko_lower_idx
  on public.external_artists (lower(display_name_ko));
create index if not exists external_artists_display_name_en_lower_idx
  on public.external_artists (lower(display_name_en));

commit;
