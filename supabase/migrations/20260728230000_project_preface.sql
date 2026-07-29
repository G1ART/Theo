-- QA 2026-07-28 — 전시 서문(preface) 추가
--
-- 배경
-- ----
-- QA 이슈 (2026-07-28): "전시 정보 업데이트 화면에 서문(preface)/초안
-- 타이핑 칸이 없다." 기존 스키마엔 title/dates/status/curator/host 만
-- 있어 큐레이터가 직접 서문을 쓰거나 AI 초안을 붙여 넣을 필드가 없다.
--
-- 원칙
-- ----
-- 스키마 변경은 **additive**. 두 언어를 각각 컬럼으로 두어 title 과
-- 동일한 bilingual 패턴 (20260727200000_bilingual_titles.sql) 을 따른다.
-- legacy `title` 처럼 두 언어를 하나 필드에 합치는 조합 컬럼은 두지
-- 않는다 — pickLocalizedTitle 을 참고한 pickLocalizedPreface 로 UI 에서
-- 언어를 해석한다.
--
-- 코드 배선 지점
-- --------------
-- src/lib/i18n/pickLocalized.ts (pickLocalizedPreface 추가)
-- src/lib/supabase/exhibitions.ts (createExhibition / updateExhibition 페이로드)
-- src/components/exhibitions/NewExhibitionFormShell.tsx (생성 폼)
-- src/app/my/exhibitions/[id]/edit/page.tsx (편집 폼)
-- src/app/e/[id]/page.tsx (공개 상세)

begin;

alter table public.projects
  add column if not exists preface_ko text,
  add column if not exists preface_en text;

comment on column public.projects.preface_ko is
  'QA 2026-07-28: 전시 서문 (Korean). 큐레이터가 직접 작성하거나 AI 초안을 편집해 저장. 기존 title 처럼 legacy 단일 컬럼 fallback 은 두지 않는다.';
comment on column public.projects.preface_en is
  'QA 2026-07-28: 전시 서문 (English). 큐레이터가 직접 작성하거나 AI 초안을 편집해 저장.';

commit;
