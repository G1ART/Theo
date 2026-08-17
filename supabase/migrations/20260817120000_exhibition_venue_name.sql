-- 2026-08-17 — 전시 주최(who)와 장소(where) 분리
--
-- 배경
-- ----
-- 갤러리 스태프가 host_name 한 칸에 주최(계정/기관)와 건물 이름을
-- 섞어 넣고 있었다. 예: The GREEN (주최) vs The Green Gallery (장소).
--
-- 원칙
-- ----
-- venue_* 는 선택 필드. 주최와 같으면 비운다. 옛 host_name 은 주최로
-- 그대로 두고, 무엇이 장소였는지 추측하는 백필은 하지 않는다.
-- 240004 bilingual sync 트리거는 건드리지 않는다. 클라이언트는
-- host 와 같이 pickLegacyForSave 로 venue_name 을 채운다.

begin;

alter table public.projects
  add column if not exists venue_name text,
  add column if not exists venue_name_ko text,
  add column if not exists venue_name_en text;

comment on column public.projects.venue_name is
  'Optional place/building name. Distinct from host_name (who is putting on the show).';
comment on column public.projects.venue_name_ko is
  'Optional venue name (Korean). Distinct from host_name (who).';
comment on column public.projects.venue_name_en is
  'Optional venue name (English). Distinct from host_name (who).';

commit;
