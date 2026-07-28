-- QA 2026-07-28 Phase B — external_artist_email_exists (PII-safe existence probe)
--
-- 목적
-- ----
-- attribution 업로드 흐름에서 큐레이터가 external artist 이메일을 입력할 때,
-- "이 이메일로 이미 다른 사람이 초대해둔 unclaimed 외부 작가가 있다"는
-- 사실만을 boolean 으로 알려주는 최소 RPC. 이 사실을 알아야 큐레이터가
-- "새 초대장이 발송된다"고 오해하지 않고 기존 작가 계정에 자기 작품을
-- 이어서 연결한다는 것을 이해할 수 있다.
--
-- 프라이버시 (필수)
-- ----------------
--   * 반환값은 boolean 만. 초대자, 이름, 초대 시각, 작품 수 등 어떤
--     식별 정보도 노출하지 않는다.
--   * `invited_by` 무관하게 전역 lookup 이지만, 반환값에 그 정보는
--     담기지 않음 → PII 우회 채널이 되지 않는다.
--   * `claimed_profile_id is null` 인 행만 대상. 이미 온보딩된 계정은
--     프로필 검색으로 나오므로 이 채널로 별도 노출할 필요가 없다.
--
-- SECURITY DEFINER 사용 이유: `external_artists` 는 RLS 상 `invited_by =
-- auth.uid()` 아니면 read 못 하도록 restrictive 하다 (`invite_email` 은
-- 이미 PostgREST 노출 X). 이 RPC 는 그 boundary 안에서 boolean 만 리턴.

begin;

create or replace function public.external_artist_email_exists(
  p_email text
)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $a$
declare
  v_email text := nullif(trim(p_email), '');
  v_hit   int;
begin
  if v_email is null or auth.uid() is null then
    -- 로그인 안 된 세션에서는 이 채널을 노출하지 않는다.
    return false;
  end if;
  select 1 into v_hit
    from public.external_artists
   where claimed_profile_id is null
     and lower(trim(invite_email)) = lower(v_email)
   limit 1;
  return v_hit is not null;
end;
$a$;

grant execute on function public.external_artist_email_exists(text) to authenticated;

commit;
