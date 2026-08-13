-- Theo Board — 2026-08-14
-- 테오 보드 (소식/공지/이벤트) 초기 스키마.
--
-- EN: Community board tables. This release does NOT open INSERT to all
--     authenticated users. Public reads live posts only; writes go through
--     the Next.js API with SUPABASE_SERVICE_ROLE_KEY (bypasses RLS),
--     gated by THEO_BOARD_PUBLISH_TOKEN (CLI now; Slack later).
-- KO: 이번 릴리즈는 인증 사용자 INSERT 를 열지 않는다. 공개 SELECT 는
--     라이브 글만. 쓰기는 서비스 롤 키를 쓰는 API 로만 한다.
--
-- ===========================================================================
--  HOW TO APPLY (Supabase Dashboard SQL Editor)
-- ===========================================================================
-- Safe to paste the WHOLE file and Run once. No PL/pgSQL functions —
-- no SECTION split needed. Idempotent where possible
-- (`create table if not exists`, `create index if not exists`,
-- `drop policy if exists` then recreate).
-- User must run this in the Dashboard; do not rely on auto-apply.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Posts
-- ---------------------------------------------------------------------------

create table if not exists public.theo_board_posts (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('announcement', 'event', 'feature', 'community', 'news')),
  title text not null check (char_length(title) between 1 and 120),
  body_md text,
  summary text,
  href text,
  author_id uuid references public.profiles (id) on delete set null,
  published_at timestamptz,
  expires_at timestamptz,
  pinned boolean not null default false,
  hidden_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists theo_board_posts_live_idx
  on public.theo_board_posts (pinned desc, published_at desc)
  where hidden_at is null and published_at is not null;

comment on table public.theo_board_posts is
  'Theo Board posts. published_at null = draft; hidden_at set = soft-hidden. Writes via service role only.';

-- ---------------------------------------------------------------------------
-- Reports (community phase 2 — table only this release; unused in UI)
-- ---------------------------------------------------------------------------

create table if not exists public.theo_board_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.theo_board_posts (id) on delete cascade,
  reporter_id uuid references public.profiles (id) on delete set null,
  reason text not null check (char_length(reason) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists theo_board_reports_post_idx
  on public.theo_board_reports (post_id, created_at desc);

comment on table public.theo_board_reports is
  'Theo Board abuse reports. Prepared for community phase; no public SELECT this release.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.theo_board_posts enable row level security;
alter table public.theo_board_reports enable row level security;

drop policy if exists theo_board_posts_select_live on public.theo_board_posts;
create policy theo_board_posts_select_live
  on public.theo_board_posts
  for select
  to anon, authenticated
  using (
    hidden_at is null
    and published_at is not null
    and (expires_at is null or expires_at > now())
  );

-- No INSERT/UPDATE/DELETE policies on theo_board_posts for anon/authenticated.
-- Service role (API) bypasses RLS.

drop policy if exists theo_board_reports_insert_own on public.theo_board_reports;
create policy theo_board_reports_insert_own
  on public.theo_board_reports
  for insert
  to authenticated
  with check (reporter_id = auth.uid());

-- No public SELECT on reports.

revoke all on table public.theo_board_posts from anon, authenticated;
grant select on table public.theo_board_posts to anon, authenticated;

revoke all on table public.theo_board_reports from anon, authenticated;
grant insert on table public.theo_board_reports to authenticated;

commit;
