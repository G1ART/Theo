-- QA 2026-07-28 — KO/EN 병기 확장: projects.host_name (Track A · Foundation)
--
-- projects.title 은 이미 bilingual (20260727200000). host_name 만 남았음.
-- 240004 트리거가 legacy host_name 을 KO 우선으로 sync.

begin;

alter table public.projects
  add column if not exists host_name_ko text,
  add column if not exists host_name_en text;

comment on column public.projects.host_name_ko is
  'QA 2026-07-28 bilingual: 한국어 호스트/베뉴 라벨. legacy host_name 은 240004 트리거가 KO 우선 sync.';
comment on column public.projects.host_name_en is
  'QA 2026-07-28 bilingual: English host/venue label (e.g. "Studio One").';

create index if not exists projects_host_name_ko_lower_idx
  on public.projects (lower(host_name_ko));
create index if not exists projects_host_name_en_lower_idx
  on public.projects (lower(host_name_en));

commit;
