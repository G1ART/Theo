-- QA 2026-06-27 — 외부(초대 전) 작가의 공개 표기명이 제3자에게 안 보이던 버그.
--
-- 증상: 갤러리가 아직 온보딩하지 않은 작가 이름을 넣고 초대 후 업로드하면,
--   비로그인/제3자 뷰어에게는 작가 자리에 외부 작가명(예: 김수철)이 아니라
--   업로더 계정명(예: 지원닷아트코리아)이 노출됨.
--
-- 원인: claims 는 public SELECT 가 열려 있으나 external_artists 는
--   `external_artists_all_own (invited_by = auth.uid())` 정책 하나뿐이라
--   초대한 갤러리 본인만 읽을 수 있었다. 그래서 피드/상세/전시의
--   `claims(..., external_artists(display_name, ...))` 임베드가 제3자에게는
--   external_artists 행을 null 로 반환했고, 표시 로직은 외부명이 없으면
--   artworks.artist_id(=갤러리)로 폴백 → 갤러리명이 작가 자리에 출력.
--
-- 수정 방침 (A안):
--   1) external_artists 를 "공개 claim 에서 참조되는 행" 한정으로 공개
--      SELECT 허용 → display_name 이 모두에게 보이게 한다.
--   2) invite_email(PII)은 컬럼 권한을 anon/authenticated 에서 회수해
--      절대 공개로 새지 않게 한다(공개 정책이 행을 열어도 컬럼이 막힘).
--   3) 소유자(초대자)가 편집 화면에서 쓰던 invite_email 프리필은
--      SECURITY DEFINER RPC 로만 제공한다(invited_by = auth.uid() 검증).

begin;

-- == SECTION 1 == 공개 표기명 노출용 SELECT 정책
-- 공개(visibility='public')이며 confirmed(또는 status null)인 claim 에서
-- 참조되는 external_artists 행만 누구나 읽을 수 있다. claims 의 공개 분기
-- (claims_select_visibility_or_owner)와 동일한 가시성 기준.
drop policy if exists external_artists_select_public on public.external_artists;
create policy external_artists_select_public on public.external_artists
  for select
  to public
  using (
    exists (
      select 1
      from public.claims c
      where c.external_artist_id = external_artists.id
        and c.visibility = 'public'
        and (c.status is null or c.status = 'confirmed')
    )
  );

-- == SECTION 2 == invite_email(PII) 컬럼 차단
-- 공개 정책이 행을 열어주더라도 invite_email 은 PostgREST 경로
-- (anon/authenticated 롤)로 절대 선택되지 않도록 한다.
--
-- 주의: Postgres 에서 "테이블 레벨 SELECT" 권한이 있으면 컬럼 레벨
-- REVOKE 는 무효다. 따라서 테이블 SELECT 를 먼저 회수하고, invite_email
-- 을 제외한 컬럼에만 SELECT 를 다시 부여한다. (INSERT/UPDATE/DELETE 권한은
-- 건드리지 않으며 쓰기는 기존 RLS 가 계속 차단.)
-- 소유자도 PostgREST 직접 임베드로는 더 이상 invite_email 을 못 읽고,
-- 아래 SECTION 3 의 RPC 만 사용한다.
revoke select on public.external_artists from anon;
revoke select on public.external_artists from authenticated;
grant select (
  id, display_name, website, instagram,
  invited_by, created_at, status, claimed_profile_id
) on public.external_artists to anon;
grant select (
  id, display_name, website, instagram,
  invited_by, created_at, status, claimed_profile_id
) on public.external_artists to authenticated;

-- == SECTION 3 == 소유자 전용 invite_email 조회 RPC
-- 편집 화면 프리필용. 초대자 본인(invited_by = auth.uid())만 자신이
-- 초대한 외부 작가의 invite_email 을 돌려받는다. 그 외에는 null.
create or replace function public.get_external_artist_invite_email(
  p_external_artist_id uuid
) returns text
language sql
security definer
stable
set search_path = public
as $a$
  select ea.invite_email
  from public.external_artists ea
  where ea.id = p_external_artist_id
    and ea.invited_by = auth.uid();
$a$;

revoke all on function public.get_external_artist_invite_email(uuid) from public;
grant execute on function public.get_external_artist_invite_email(uuid) to authenticated;

commit;
