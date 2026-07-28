-- QA 2026-07-28 Phase D — 온보딩 후 orphan external artist row 를 본인 계정에 claim
--
-- 문제
-- ----
-- Phase A 로 이메일 있는 외부 초대는 전역 dedupe + auth 트리거로 온보딩 시
-- 자동 이관되지만, 이메일 없이 이름만으로 초대된 external_artists 행
-- (`invited_by, lower(display_name)` per-inviter unique) 은 다음 두 케이스에서
-- 여전히 orphan 상태가 된다:
--
--   1. 큐레이터 여러 명이 같은 작가를 이메일 없이 이름으로만 초대 →
--      각각 별개 행 → A 온보딩 (이메일로) 후 어느 행도 A 와 연결되지 않음
--   2. 어떤 큐레이터가 A 를 이메일 없이 초대했는데 A 가 다른 이메일로
--      가입 → 이메일 매칭이 실패해 auth 트리거가 그 행을 놓침
--
-- 이 마이그레이션은 A 가 명시적으로 "이 초대장은 저에게 온 것" 이라고
-- claim 할 수 있는 두 개의 SECURITY DEFINER RPC 를 도입한다.
--
--   * `search_orphan_external_artists_for_me(p_q text default null)` —
--     caller 의 프로필 display_name (또는 명시적 검색어) 과 이름이 유사한
--     unclaimed external_artists 행을 나열. 초대자 profile display_name /
--     username 은 노출 (공개 정보), invite_email 은 노출하지 않음.
--   * `claim_orphan_external_artist_as_self(p_external_artist_id uuid)` —
--     caller 가 자기 프로필로 그 행을 흡수. 가드:
--       - 인증 필수, 자기 프로필 조회 성공
--       - 대상 행이 unclaimed
--       - 대상 행의 display_name 이 caller 프로필의 display_name 과 정확
--         일치 (case-insensitive, trim). 이 조건은 남의 초대장을 훔치지
--         못 하도록 최소한의 사회공학적 방어. 완벽하지는 않지만 대체
--         (email) 채널이 없는 케이스에서 사용자 자기결정 우선.
--       - 이메일이 있는 orphan 은 대상 아님 (auth 트리거의 관할 → 이미 연결)
--     이관 로직 (auth trigger 와 정확히 동일):
--       - `external_artists.claimed_profile_id = caller, status = 'claimed'`
--       - 관련 `claims` 를 `artist_profile_id = caller, external_artist_id = null`
--       - 관련 `artworks.artist_id = caller`
--     이관 후 원 inviter 에게 notification 전송 (`orphan_external_claimed`).
--
-- 새 notification type `orphan_external_claimed` 를 위한 CHECK 확장 포함.

begin;

-- == SECTION 1 == notifications_type_check 확장
alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type = any (array[
    'like','follow','claim_request','claim_confirmed','claim_rejected',
    'price_inquiry','price_inquiry_reply','new_work','connection_message',
    'board_save','board_public',
    'delegation_invite_received','delegation_accepted',
    'delegation_declined','delegation_revoked',
    'follow_request','follow_request_accepted',
    'delegation_invite_canceled',
    'delegation_resigned',
    'delegation_permissions_updated',
    'delegation_permission_change_requested',
    'delegation_permission_change_dismissed',
    -- Phase D (2026-07-28):
    'orphan_external_claimed'
  ]));

-- == SECTION 2 == search_orphan_external_artists_for_me
create or replace function public.search_orphan_external_artists_for_me(
  p_q text default null
)
returns setof jsonb
language plpgsql
security definer
stable
set search_path = public
as $b$
declare
  v_uid       uuid := auth.uid();
  v_my_name   text;
  v_q         text;
  v_q_lower   text;
  v_pattern   text;
begin
  if v_uid is null then
    return;
  end if;

  select trim(display_name) into v_my_name
    from public.profiles
   where id = v_uid;

  -- caller 검색어가 있으면 그것으로, 없으면 본인 display_name 으로 매칭.
  v_q := coalesce(nullif(trim(p_q), ''), v_my_name);
  if v_q is null or length(v_q) < 2 then
    return;
  end if;
  v_q_lower := lower(v_q);
  v_pattern := '%' || v_q || '%';

  return query
  with hits as (
    select
      ea.id,
      ea.display_name,
      ea.display_name_ko,
      ea.display_name_en,
      ea.invited_by,
      ea.created_at,
      -- 이 external row 에 매달린 claims 중 실제 work 가 연결된 것의 수
      (select count(distinct c.work_id)
         from public.claims c
        where c.external_artist_id = ea.id
          and c.work_id is not null)::int as works_count,
      -- 최근 3개 primary cover (privacy 안전 — public visibility 만)
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
      case
        when lower(coalesce(ea.display_name, '')) = v_q_lower then 0
        when lower(coalesce(ea.display_name_ko, '')) = v_q_lower then 0
        when lower(coalesce(ea.display_name_en, '')) = v_q_lower then 0
        when ea.display_name ilike v_pattern
          or ea.display_name_ko ilike v_pattern
          or ea.display_name_en ilike v_pattern then 1
        else 2
      end as tier
    from public.external_artists ea
    where ea.claimed_profile_id is null
      -- 이메일이 있는 행은 auth trigger 의 관할 이므로 제외
      and nullif(trim(ea.invite_email), '') is null
      and (
        ea.display_name ilike v_pattern
        or ea.display_name_ko ilike v_pattern
        or ea.display_name_en ilike v_pattern
      )
  )
  select jsonb_build_object(
    'id', h.id,
    'display_name', h.display_name,
    'display_name_ko', h.display_name_ko,
    'display_name_en', h.display_name_en,
    'invited_by', h.invited_by,
    'inviter_display_name', p.display_name,
    'inviter_username', p.username,
    'invited_at', h.created_at,
    'works_count', h.works_count,
    'latest_cover_paths', h.latest_cover_paths
  )
  from hits h
  left join public.profiles p on p.id = h.invited_by
  order by h.tier asc, h.created_at desc
  limit 20;
end;
$b$;

grant execute on function public.search_orphan_external_artists_for_me(text) to authenticated;

-- == SECTION 3 == claim_orphan_external_artist_as_self
create or replace function public.claim_orphan_external_artist_as_self(
  p_external_artist_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $c$
declare
  v_uid              uuid := auth.uid();
  v_my_name          text;
  v_row              public.external_artists;
  v_ext_name_norm    text;
  v_my_name_norm     text;
  v_ko_norm          text;
  v_en_norm          text;
  v_work_ids         uuid[];
  v_claim_count      int := 0;
  v_work_count       int := 0;
begin
  if v_uid is null then
    raise exception 'auth.uid() is null';
  end if;
  if p_external_artist_id is null then
    raise exception 'external_artist_id required';
  end if;

  select trim(display_name) into v_my_name
    from public.profiles
   where id = v_uid;

  if v_my_name is null or length(v_my_name) < 2 then
    raise exception 'caller profile display_name is missing or too short';
  end if;

  select * into v_row
    from public.external_artists
   where id = p_external_artist_id
   for update;

  if v_row.id is null then
    raise exception 'external_artist not found';
  end if;
  if v_row.claimed_profile_id is not null then
    raise exception 'external_artist already claimed';
  end if;

  -- 이메일이 있는 orphan 은 auth trigger 의 관할. 여기서 임의 claim 을
  -- 허용하면 이메일 신원과 어긋난 계정이 흡수해 신원 무결성이 깨진다.
  if nullif(trim(v_row.invite_email), '') is not null then
    raise exception 'external_artist has an invite_email — must be claimed via auth trigger (email match)';
  end if;

  -- 이름 매칭 검증. legacy display_name / KO / EN 중 어느 하나가
  -- caller 프로필 display_name 과 case-insensitive 로 정확 일치해야 함.
  -- 이 조건은 남의 orphan 을 훔치는 것을 막는 최소 방어선.
  v_my_name_norm  := lower(trim(v_my_name));
  v_ext_name_norm := lower(trim(coalesce(v_row.display_name, '')));
  v_ko_norm       := lower(trim(coalesce(v_row.display_name_ko, '')));
  v_en_norm       := lower(trim(coalesce(v_row.display_name_en, '')));

  if v_my_name_norm <> v_ext_name_norm
     and v_my_name_norm <> v_ko_norm
     and v_my_name_norm <> v_en_norm then
    raise exception 'caller display_name does not match external_artist display_name (any language). claim rejected.';
  end if;

  -- 이관 로직 (auth trigger 와 동일 구조)
  update public.external_artists
     set claimed_profile_id = v_uid,
         status = 'claimed'
   where id = v_row.id;

  select array_agg(distinct c.work_id) into v_work_ids
    from public.claims c
   where c.external_artist_id = v_row.id
     and c.work_id is not null;

  with upd as (
    update public.claims
       set artist_profile_id = v_uid,
           external_artist_id = null
     where external_artist_id = v_row.id
     returning 1
  )
  select count(*) into v_claim_count from upd;

  if v_work_ids is not null and array_length(v_work_ids, 1) > 0 then
    with upd_art as (
      update public.artworks
         set artist_id = v_uid
       where id = any(v_work_ids)
       returning 1
    )
    select count(*) into v_work_count from upd_art;
  end if;

  -- 원 inviter 에게 notification. 실패해도 claim 자체는 이미 완료.
  if v_row.invited_by is not null and v_row.invited_by <> v_uid then
    begin
      insert into public.notifications (user_id, type, actor_id, payload)
      values (
        v_row.invited_by,
        'orphan_external_claimed',
        v_uid,
        jsonb_build_object(
          'external_artist_id', v_row.id,
          'external_display_name', v_row.display_name,
          'claimed_by_profile_id', v_uid,
          'works_moved', v_work_count,
          'claims_migrated', v_claim_count
        )
      );
    exception when others then
      -- notification insert 실패는 claim 을 롤백하지 않는다.
      null;
    end;
  end if;

  return jsonb_build_object(
    'external_artist_id', v_row.id,
    'target_profile_id', v_uid,
    'claims_migrated', v_claim_count,
    'works_moved', v_work_count
  );
end;
$c$;

grant execute on function public.claim_orphan_external_artist_as_self(uuid) to authenticated;

commit;
