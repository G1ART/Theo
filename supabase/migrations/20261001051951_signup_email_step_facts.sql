-- 온보딩 이메일 1단계가 볼 사실.
--
-- 앱의 decideSignupEmailStep 이 login / continue 를 고른다.
-- 이 함수는 계정 유무, 이메일 확인, 온보딩 완료만 돌려준다.
-- 완료 기준은 get_my_auth_state 와 같다. 프로필이 있고, 임시 아이디가
-- 아니며, 표시 이름·역할·주 역할이 있다.
-- 초대 고스트, 이메일 미확인, 프로필이 비어 있는 계정은 완료가 아니다.
-- 모르는 이메일은 account_exists = false.
--
-- 적용: Dashboard SQL Editor 에서 아래 섹션만 highlight → Run.
-- 한꺼번에 다른 마이그레이션과 붙이지 않는다.
-- dollar tag 는 letters only.

-- ===========================================================================
-- == SECTION 1 == signup_email_step_facts
-- ===========================================================================
create or replace function public.signup_email_step_facts(p_email text)
returns table (
  account_exists boolean,
  email_confirmed boolean,
  onboarding_finished boolean
)
language plpgsql
stable
security definer
set search_path = public
as $signupemail$
declare
  v_email text := nullif(lower(trim(p_email)), '');
  v_uid uuid;
  v_confirmed boolean;
  v_finished boolean;
begin
  if v_email is null or position('@' in v_email) = 0 then
    account_exists := false;
    email_confirmed := false;
    onboarding_finished := false;
    return next;
    return;
  end if;

  v_uid := (
    select u.id
      from auth.users u
     where lower(trim(u.email)) = v_email
     limit 1
  );

  if v_uid is null then
    account_exists := false;
    email_confirmed := false;
    onboarding_finished := false;
    return next;
    return;
  end if;

  v_confirmed := (
    select (u.email_confirmed_at is not null)
      from auth.users u
     where u.id = v_uid
  );

  v_finished := exists (
    select 1
      from public.profiles p
     where p.id = v_uid
       and p.username is not null
       and btrim(p.username) <> ''
       and coalesce(public.is_placeholder_username(p.username), false) = false
       and btrim(coalesce(p.display_name, '')) <> ''
       and p.roles is not null
       and array_length(p.roles, 1) is not null
       and p.main_role is not null
       and btrim(p.main_role::text) <> ''
  );

  account_exists := true;
  email_confirmed := coalesce(v_confirmed, false);
  onboarding_finished := coalesce(v_finished, false);
  return next;
end;
$signupemail$;

revoke all on function public.signup_email_step_facts(text) from public, anon, authenticated;
grant execute on function public.signup_email_step_facts(text) to service_role;
