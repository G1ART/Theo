-- QA 2026-07 (Phase 3) — 통합 검색 RPC: 온보딩 유저 + 초대 대기 외부 작가
--
-- 배경
-- ----
-- QA 4 근본 문제: 외부(초대 대기) 작가는 이미 `external_artists` +
-- `get_or_create_external_artist` dedupe 로 서버 층에서는 안정적인
-- 엔티티로 존재한다. 그러나 attribution UI 는 온보딩 유저만 검색하고
-- 외부 작가는 매번 "이름 + 이메일" 을 재입력해야 했다. 결과:
--   * 갤러리스트가 같은 작가의 새 작품을 올릴 때마다 새 초대장이
--     발송되는 것으로 오해 (실제로는 서버 dedupe 로 재사용됨).
--   * 이름 미묘한 오타/공백으로 새 external_artists 행이 생겨
--     피드가 한 작가를 여러 명으로 분리해서 보여줌.
--
-- 해결
-- ----
-- attribution 검색을 "온보딩 유저 + 내가 이미 초대한 외부 작가"
-- 로 확장. 결과 shape 에 `kind` 필드를 넣어 클라이언트가 한 리스트로
-- 표시하면서 external 결과에는 "초대 대기 · 작품 N점" 배지 + 최근
-- 작품 커버 3개 미니 스트립을 노출한다.
--
-- 프라이버시 (필수)
-- ----------------
-- external 결과는 `invited_by = auth.uid()` (혹은 명시적 p_inviter_id
-- = 자신) 인 행만 반환한다. SECURITY DEFINER 함수이지만 본문에서
-- 강제 필터하므로, 남이 초대한 외부 작가 목록이 이 채널로 새어나가지
-- 않는다. `invite_email` 은 결과에 포함하지 않는다 (필요 시 별도
-- `get_external_artist_invite_email` 사용).
--
-- 반환 shape (JSONB)
-- ------------------
-- {
--   kind: 'profile' | 'external',
--   id: uuid,
--   display_name: text | null,
--   username: text | null,            -- profile only
--   avatar_url: text | null,          -- profile only
--   main_role: text | null,           -- profile only
--   roles: text[] | null,             -- profile only
--   works_count: int,                 -- external: claims 카운트 / profile: 0
--   latest_cover_paths: text[],       -- external: 최근 3개 작품 primary cover / profile: []
--   invited_at: timestamptz | null    -- external only
-- }
--
-- 클라이언트 사용 지점: src/lib/supabase/artists.ts → searchPeopleWithExternal
-- 소비처: 업로드 attribution 검색 (bulk/single), 전시 add 스텝 1 참여작가.
-- `search_people` (기존) 는 그대로 유지 — 다른 검색 소비처(위임 위자드,
-- 컬렉터 검색 등)는 외부 결과를 원하지 않는다.

begin;

-- == SECTION 1 == 통합 검색 함수
create or replace function public.search_people_with_external(
  p_q text,
  p_roles text[] default '{}',
  p_include_external boolean default false,
  p_inviter_id uuid default null,
  p_limit int default 15
)
returns setof jsonb
language plpgsql
security definer
stable
set search_path = public
as $a$
declare
  v_uid      uuid := auth.uid();
  v_q        text := coalesce(trim(p_q), '');
  v_q_lower  text;
  v_pattern  text;
  v_prefix   text;
  v_roles    text[] := coalesce(p_roles, '{}');
  v_limit    int := least(greatest(coalesce(p_limit, 15), 1), 30);
  v_inviter  uuid;
begin
  if v_q = '' then
    return;
  end if;

  v_q_lower := lower(v_q);
  v_pattern := '%' || v_q || '%';
  v_prefix  := v_q || '%';

  -- external 조회 대상 결정. 미로그인 상태이거나 p_include_external=false
  -- 이면 external 은 반환하지 않는다. p_inviter_id 가 주어졌으면 delegate
  -- writer 자격을 검증하고 그 principal 의 초대 목록을, 아니면 auth.uid()
  -- 본인의 초대 목록만 반환한다.
  if p_include_external and v_uid is not null then
    v_inviter := coalesce(p_inviter_id, v_uid);
    if v_inviter <> v_uid then
      if not public.is_active_writer_for(v_inviter) then
        v_inviter := v_uid;
      end if;
    end if;
  else
    v_inviter := null;
  end if;

  return query
  with profile_hits as (
    select
      'profile'::text as kind,
      p.id,
      p.display_name,
      p.username,
      p.avatar_url,
      p.main_role,
      p.roles,
      0::int as works_count,
      '{}'::text[] as latest_cover_paths,
      null::timestamptz as invited_at,
      case
        when lower(coalesce(p.username, '')) = v_q_lower then 0
        when lower(coalesce(p.display_name, '')) = v_q_lower then 1
        when lower(coalesce(p.username, '')) like lower(v_prefix)
          or lower(coalesce(p.display_name, '')) like lower(v_prefix) then 2
        when p.username ilike v_pattern or p.display_name ilike v_pattern then 3
        else 4
      end as tier,
      greatest(
        similarity(coalesce(p.username, ''), v_q),
        similarity(coalesce(p.display_name, ''), v_q)
      ) as sim
    from profiles p
    where (
        p.username ilike v_pattern or p.display_name ilike v_pattern
        or similarity(coalesce(p.username, ''), v_q) > 0.2
        or similarity(coalesce(p.display_name, ''), v_q) > 0.2
      )
      and (array_length(v_roles, 1) is null or array_length(v_roles, 1) = 0
           or (p.main_role::text = any(v_roles))
           or (coalesce(p.roles, '{}'::text[]) && v_roles))
  ),
  external_hits as (
    select
      'external'::text as kind,
      ea.id,
      ea.display_name,
      null::text as username,
      null::text as avatar_url,
      null::text as main_role,
      null::text[] as roles,
      -- 작품 수: 이 external artist 에 연결된 claims 중 work_id 있는 것.
      -- 여러 claim 타입(CREATED/OWNS 등)이 있어도 각 work 하나만 세도록 distinct.
      (
        select count(distinct c.work_id)
          from public.claims c
         where c.external_artist_id = ea.id
           and c.work_id is not null
      )::int as works_count,
      -- 최근 3개 primary cover paths. primary 가 없으면 sort_order 첫 이미지.
      (
        select coalesce(array_agg(cover_path order by rn), '{}'::text[])
          from (
            select ai.storage_path as cover_path,
                   row_number() over (
                     partition by a.id
                     order by (case when ai.view_type = 'wall_mounted' then 0 else 1 end),
                              coalesce(ai.sort_order, 999),
                              ai.created_at asc
                   ) as ri,
                   row_number() over (
                     order by a.created_at desc, a.id desc
                   ) as rn
              from public.claims c
              join public.artworks a on a.id = c.work_id
              join public.artwork_images ai on ai.artwork_id = a.id
             where c.external_artist_id = ea.id
               and c.work_id is not null
               and a.visibility = 'public'
          ) t
         where t.ri = 1
           and t.rn <= 3
      ) as latest_cover_paths,
      ea.created_at as invited_at,
      case
        when lower(coalesce(ea.display_name, '')) = v_q_lower then 0
        when lower(coalesce(ea.display_name, '')) like lower(v_prefix) then 2
        when ea.display_name ilike v_pattern then 3
        else 4
      end as tier,
      similarity(coalesce(ea.display_name, ''), v_q) as sim
    from public.external_artists ea
    where v_inviter is not null
      and ea.claimed_profile_id is null
      and ea.invited_by = v_inviter
      and (
        ea.display_name ilike v_pattern
        or similarity(coalesce(ea.display_name, ''), v_q) > 0.2
      )
  ),
  combined as (
    select * from profile_hits
    union all
    select * from external_hits
  )
  select jsonb_build_object(
    'kind', c.kind,
    'id', c.id,
    'display_name', c.display_name,
    'username', c.username,
    'avatar_url', c.avatar_url,
    'main_role', c.main_role,
    'roles', c.roles,
    'works_count', c.works_count,
    'latest_cover_paths', c.latest_cover_paths,
    'invited_at', c.invited_at
  )
  from combined c
  order by c.tier asc, c.sim desc nulls last, c.kind desc  -- 'profile' before 'external' on ties
  limit v_limit;
end;
$a$;

grant execute on function public.search_people_with_external(text, text[], boolean, uuid, int)
  to authenticated;
-- anon은 external 결과를 절대 못 얻게 두되(v_inviter 조건에서 자연 차단),
-- 프로필 검색만은 허용해 프리로그인 검색 UX 를 유지한다.
grant execute on function public.search_people_with_external(text, text[], boolean, uuid, int)
  to anon;

-- == SECTION 2 == create_external_artist_and_claim — 명시적 external_artist_id 지원
--
-- Phase 3-4: attribution UI 에서 외부 작가를 "재선택" 했을 때는 이름/이메일
-- 재조회 dedupe 를 건너뛰고 그 id 를 그대로 쓴다. 이렇게 하면
--   (a) 이름 오타로 dedupe 가 놓쳐 새 행이 생기는 race 를 원천 차단.
--   (b) attribution UI 가 이미 "이 external artist" 라고 확정한 결정이
--       서버 dedupe 로직에 의해 뒤바뀌지 않음.
-- 지정된 id 는 반드시 (a) claimed_profile_id is null 이고
--                    (b) invited_by = 실행자(또는 delegate principal) 인 것만 허용.
-- 그렇지 않으면 dedupe 로직으로 fallback (기존 동작 보존).
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
as $b$
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
      -- 기존 dedupe 대신 명시적 id 사용 → 이름 오타/공백 race 없음.
      update public.external_artists
         set website      = coalesce(nullif(trim(website), ''), nullif(trim(p_website), '')),
             instagram    = coalesce(nullif(trim(instagram), ''), nullif(trim(p_instagram), '')),
             invite_email = coalesce(nullif(trim(invite_email), ''), v_email)
       where id = v_ext_id;
    end if;
  end if;

  if v_ext_id is null then
    -- 명시 id 가 없거나 무효면 기존 dedupe 로 진입 (이메일 → 이름).
    if v_email is not null then
      select id
        into v_ext_id
        from public.external_artists
       where invited_by = v_uid
         and claimed_profile_id is null
         and lower(trim(invite_email)) = lower(v_email)
       order by created_at asc
       limit 1;
    else
      select id
        into v_ext_id
        from public.external_artists
       where invited_by = v_uid
         and claimed_profile_id is null
         and lower(trim(display_name)) = lower(trim(p_display_name))
         and nullif(trim(invite_email), '') is null
       order by created_at asc
       limit 1;
    end if;
  end if;

  if v_ext_id is null then
    insert into public.external_artists (display_name, website, instagram, invite_email, invited_by, status)
    values (
      trim(p_display_name),
      nullif(trim(p_website), ''),
      nullif(trim(p_instagram), ''),
      v_email,
      v_uid,
      'invited'
    )
    returning id into v_ext_id;
  else
    -- 재사용 케이스에서 비어 있는 메타데이터만 보충 (덮어쓰지 않음).
    update public.external_artists
       set website      = coalesce(nullif(trim(website), ''), nullif(trim(p_website), '')),
           instagram    = coalesce(nullif(trim(instagram), ''), nullif(trim(p_instagram), '')),
           invite_email = coalesce(nullif(trim(invite_email), ''), v_email)
     where id = v_ext_id;
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
$b$;

-- 새 시그니처(11개 arg)에 grant. 이전 10-arg 오버로드는 함수 시그니처 변경으로
-- 자동 대체된다(같은 이름이지만 arg count 다름 → 별도 오버로드로 남을 수 있음).
-- 남아 있는 옛 오버로드는 별도 drop 없이도 새 것을 우선 호출한다면 문제 없지만,
-- 명시적으로 옛 오버로드도 drop 해 signature 중복을 없앤다.
drop function if exists public.create_external_artist_and_claim(text, text, uuid, uuid, text, text, text, text, text, uuid);

grant execute on function public.create_external_artist_and_claim(text, text, uuid, uuid, text, text, text, text, text, uuid, uuid)
  to authenticated;

commit;
