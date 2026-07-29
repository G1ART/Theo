-- QA 2026-07-29 hotfix — Feed 500 두 갈래 원인 봉인:
--
-- 1) external_artists 의 새 bilingual 컬럼 (display_name_ko / display_name_en)
--    이 anon / authenticated 에 SELECT 로 노출되지 않아 PostgREST 의
--    `claims(external_artists(display_name, display_name_ko, display_name_en))`
--    nested join 이 "permission denied for table external_artists" 로 실패.
--    Root cause: `20260627000000_external_artist_public_credit.sql` 이 PII
--    보호를 위해 테이블 SELECT 를 revoke 하고 컬럼 allowlist 로 재부여했는데,
--    이후 추가된 KO/EN 컬럼은 그 allowlist 에 포함되지 않았음.
--
-- 2) `get_my_auth_state()` (2026-04-21 migration) 의 needs_identity_setup 분기
--    가 `btrim(p.main_role)` 을 호출. `main_role` 은 `public.main_role` enum
--    이라 Postgres 가 btrim(text) 오버로드로 자동 매칭 못 하고
--    "function btrim(main_role) does not exist" 로 실패. `p.main_role IS NULL`
--    branch 는 short-circuit 으로 통과했지만 main_role 이 non-null 인 유저
--    (=대부분 온보딩 완료 유저) 에게 25건 이상 반복 오류. 명시 cast 추가.
--
-- 두 fix 모두 idempotent 하며 additive (기존 스키마/시그니처 유지).

begin;

-- == SECTION 1 == external_artists KO/EN 컬럼 SELECT grant
-- PII 보호는 그대로. invite_email 은 여전히 anon/authenticated 로부터
-- SELECT 제외 (SECURITY DEFINER RPC 경유).
grant select (display_name_ko) on public.external_artists to anon;
grant select (display_name_en) on public.external_artists to anon;
grant select (display_name_ko) on public.external_artists to authenticated;
grant select (display_name_en) on public.external_artists to authenticated;

-- == SECTION 2 == get_my_auth_state() enum cast fix
-- 다른 필드는 원본 그대로 유지. `btrim(p.main_role::text) = ''` 만 변경.
create or replace function public.get_my_auth_state()
returns table(
  user_id                  uuid,
  has_password             boolean,
  is_email_confirmed       boolean,
  needs_onboarding         boolean,
  username                 text,
  display_name             text,
  is_placeholder_username  boolean,
  needs_identity_setup     boolean
)
language plpgsql
stable
security definer
set search_path = public
as $get_my_auth_state$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return;
  end if;

  return query
  select
    v_uid                                                                         as user_id,
    (au.encrypted_password is not null and au.encrypted_password <> '')::boolean  as has_password,
    (au.email_confirmed_at is not null)::boolean                                  as is_email_confirmed,
    not exists (select 1 from public.profiles p where p.id = v_uid)               as needs_onboarding,
    (select p.username     from public.profiles p where p.id = v_uid)             as username,
    (select p.display_name from public.profiles p where p.id = v_uid)             as display_name,
    coalesce(
      public.is_placeholder_username(
        (select p.username from public.profiles p where p.id = v_uid)
      ),
      false
    )                                                                             as is_placeholder_username,
    (
      not exists (select 1 from public.profiles p where p.id = v_uid)
      or exists (
        select 1
          from public.profiles p
         where p.id = v_uid
           and (
             public.is_placeholder_username(p.username)
             or btrim(coalesce(p.display_name, '')) = ''
             or p.roles is null
             or array_length(p.roles, 1) is null
             or p.main_role is null
             or btrim(p.main_role::text) = ''
           )
      )
    )                                                                             as needs_identity_setup
    from auth.users au
   where au.id = v_uid;
end;
$get_my_auth_state$;

grant execute on function public.get_my_auth_state() to anon, authenticated;

commit;
