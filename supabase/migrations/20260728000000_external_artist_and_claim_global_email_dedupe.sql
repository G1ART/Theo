-- QA 2026-07-28 hotfix — create_external_artist_and_claim 이 전역 email dedupe 를 우회하던 버그 수정
--
-- 배경
-- ----
-- 시나리오: 갤러리 B가 미온보딩 작가 A(email=a@x.com) 를 업로드 흐름으로
-- 초대해 external_artists row 1개를 생성. 이후 큐레이터 C 가 다른 전시에서
-- A 를 참조하며 같은 이름·이메일로 업로드.
--
-- 20260702000000 에서 도입된 partial unique index
-- `uq_external_artists_email_global (lower(trim(invite_email))) where
-- invite_email is not null and claimed_profile_id is null` 는 email 있는
-- unclaimed 행을 **전역으로 1행** 만 허용한다. 같이 배포된
-- `get_or_create_external_artist(name, email)` RPC 는 이 전역 dedupe 를
-- 존중해 초대자에 상관없이 기존 행을 반환하고 `unique_violation` 도
-- retry 로 안전하게 흡수한다.
--
-- 그러나 Phase 3 (`20260727000000` SECTION 2) 에서 도입된
-- `create_external_artist_and_claim` v3 는 fallback lookup 을 **per-inviter**
-- (`invited_by = v_uid`) 로 인라인 재작성했다. 결과:
--   1. C 의 fallback lookup: `invited_by=C AND email=a@x.com` → miss (B 소유)
--   2. C 의 인라인 INSERT: `uq_external_artists_email_global` 위반
--   3. RPC 는 `exception when unique_violation` handler 가 없어 그대로 실패
--   4. C 의 업로드/전시 초대 자체가 실패 → C 의 작품은 draft 로 남거나
--      onboarding-safe claim이 아예 만들어지지 않아 A 온보딩 시 이관되지 않음
--
-- 해결
-- ----
-- fallback path 를 `get_or_create_external_artist` 호출로 교체한다.
-- 이렇게 하면:
--   * email 있는 경우 B 의 row 를 재사용 → 새 claim 이 그 row 에 붙어
--     A 온보딩 시 auth 트리거가 정상 이관.
--   * email 없는 경우 per-inviter 흡수 (기존 동작 유지). D phase 에서
--     추가로 온보딩 후 후보 claim UI 를 도입해 orphan no-email row 도
--     복구 가능하게 한다.
--   * `unique_violation` race 는 helper 내부에서 이미 catch → RPC 자체는
--     성공.
--
-- 명시적 `p_external_artist_id` 경로 (Phase 3-4 재선택) 는 그대로 유지.
--
-- SECURITY DEFINER + `set search_path = public` 유지. 오버로드 방지를
-- 위해 옛 시그니처는 drop 없이 v4 로 replace (arg count 동일).

begin;

create or replace function public.create_external_artist_and_claim(
  p_display_name       text,
  p_invite_email       text default null,
  p_work_id            uuid default null,
  p_project_id         uuid default null,
  p_claim_type         text default 'OWNS',
  p_website            text default null,
  p_instagram          text default null,
  p_visibility         text default 'public',
  p_period_status      text default null,
  p_subject_profile_id uuid default null,
  p_external_artist_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $a$
declare
  v_uid        uuid := auth.uid();
  v_subject    uuid;
  v_ext_id     uuid;
  v_email      text;
  v_ext_row    jsonb;
  v_claim_row  jsonb;
  v_check      uuid;
begin
  if v_uid is null then
    raise exception 'auth.uid() is null';
  end if;
  if p_display_name is null or length(trim(p_display_name)) < 2 then
    raise exception 'display_name must be at least 2 characters';
  end if;
  if (p_work_id is null and p_project_id is null)
     or (p_work_id is not null and p_project_id is not null) then
    raise exception 'exactly one of work_id, project_id required';
  end if;
  if p_visibility is null then
    p_visibility := 'public';
  end if;
  if p_period_status is not null
     and p_period_status not in ('past', 'current', 'future') then
    raise exception 'period_status must be past, current, or future';
  end if;

  v_subject := coalesce(p_subject_profile_id, v_uid);
  if v_subject <> v_uid then
    if not public.is_active_writer_for(v_subject) then
      raise exception 'forbidden: caller is not an active account delegate writer for subject_profile_id';
    end if;
  end if;

  v_email := nullif(trim(p_invite_email), '');

  -- Phase 3-4: 명시적 external_artist_id 우선.
  -- 유효 조건: 존재하고, unclaimed, invited_by == (자기 자신 또는 acting principal).
  if p_external_artist_id is not null then
    select ea.id
      into v_check
      from public.external_artists ea
     where ea.id = p_external_artist_id
       and ea.claimed_profile_id is null
       and ea.invited_by in (v_uid, v_subject)
     limit 1;
    if v_check is not null then
      v_ext_id := v_check;
      update public.external_artists
         set website      = coalesce(nullif(trim(website), ''), nullif(trim(p_website), '')),
             instagram    = coalesce(nullif(trim(instagram), ''), nullif(trim(p_instagram), '')),
             invite_email = coalesce(nullif(trim(invite_email), ''), v_email)
       where id = v_ext_id;
    end if;
  end if;

  -- v4 fix: fallback 은 전역 dedupe helper 를 사용해 다른 초대자가 이미
  -- 이 email 로 초대해둔 row 를 재사용한다. 이렇게 해야 C 의 업로드가
  -- 실패하지 않고, 같은 row 에 claim 이 쌓여 A 온보딩 시 auth trigger 가
  -- 모든 작품을 A 프로필로 이관할 수 있다.
  if v_ext_id is null then
    v_ext_id := public.get_or_create_external_artist(
      trim(p_display_name),
      v_email
    );

    -- website / instagram 은 helper 가 채우지 않으므로 여기서 backfill
    -- (기존 값을 덮어쓰지 않도록 coalesce). 재사용된 row 의 초대자·이메일은
    -- 그대로 유지하되, 새 값이 있으면 비어있던 슬롯만 보충한다.
    if v_ext_id is not null and (
         nullif(trim(coalesce(p_website, '')), '') is not null
         or nullif(trim(coalesce(p_instagram, '')), '') is not null
       ) then
      update public.external_artists
         set website   = coalesce(nullif(trim(website), ''),   nullif(trim(p_website), '')),
             instagram = coalesce(nullif(trim(instagram), ''), nullif(trim(p_instagram), ''))
       where id = v_ext_id;
    end if;
  end if;

  if v_ext_id is null then
    -- helper 도 실패한 경우 (예: display_name 검증) 명시적으로 raise.
    raise exception 'failed to resolve external_artist for display_name=% email=%',
      p_display_name, coalesce(v_email, '<none>');
  end if;

  insert into public.claims (
    subject_profile_id, claim_type, work_id, project_id,
    external_artist_id, visibility, period_status
  )
  values (
    v_subject, p_claim_type, p_work_id, p_project_id,
    v_ext_id, p_visibility, p_period_status
  );

  select to_jsonb(e.*) into v_ext_row from public.external_artists e where e.id = v_ext_id;
  select to_jsonb(c.*) into v_claim_row
    from public.claims c
   where c.subject_profile_id = v_subject
     and c.external_artist_id = v_ext_id
   order by c.created_at desc
   limit 1;

  return jsonb_build_object('external_artist', v_ext_row, 'claim', v_claim_row);
end;
$a$;

grant execute on function public.create_external_artist_and_claim(text, text, uuid, uuid, text, text, text, text, text, uuid, uuid)
  to authenticated;

commit;
