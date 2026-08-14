-- Additive invited curator credit on exhibitions — 2026-08-16
-- 전시에 Theo 미가입 큐레이터를 초대 크레딧으로 붙일 수 있게 한다.
--
-- EN: projects.external_curator_id → external_artists(id), nullable.
--     curator_id stays required (creating operator or onboarded curator)
--     so existing queries do not break. Exhibition owner UPDATE policies
--     already cover this column (no extra policy).
--
-- Dashboard: paste the whole file and Run once. No PL/pgSQL functions.

alter table public.projects
  add column if not exists external_curator_id uuid
    references public.external_artists (id) on delete set null;

create index if not exists idx_projects_external_curator_id
  on public.projects (external_curator_id);

comment on column public.projects.external_curator_id is
  'Optional invited (not-yet-onboarded) curator credit. Distinct from platform_admins. curator_id remains the creating operator or selected onboarded curator.';
