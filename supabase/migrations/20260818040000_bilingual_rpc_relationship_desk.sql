-- QA 2026-08-17 (14) — 이중언어(KO/EN) RPC patch: Relationship Desk / Card
--
-- 배경
-- ----
-- 감사(13) 에서 client 는 `formatDisplayName(row, t, locale)` /
-- `pickLocalizedBio` 로 라우팅했지만, `get_relationship_desk_for_owner`
-- 와 `get_relationship_card_for_owner` 는 여전히 legacy `display_name`
-- (+ card 의 경우 `bio`) 만 반환해서 pickLocalized 가 뽑을 값이 없었다.
-- 아래 두 RPC 의 jsonb payload 에 KO/EN 슬롯을 additive 로 주입한다.
--
-- 반환 타입은 모두 `jsonb` 이라 signature 변경 없이 `create or replace`
-- 만으로 충분. 원본과 동일하게 SECURITY DEFINER + stable + acting-as
-- (`p_owner_profile_id`) 검증 로직 그대로 유지. `is_active_account_delegate_writer`
-- 헬퍼도 그대로 사용.
--
-- 릴리즈 룰
--   - 이 파일에 PL/pgSQL 함수 정의가 2개 → `-- == SECTION N ==` 배너
--     로 분리, letters-only dollar tag 사용 (`$a$`, `$b$`).
--   - Supabase dashboard 로 붙여넣을 때는 SECTION 단위로 highlight → Run.

begin;

-- == SECTION 1 == get_relationship_desk_for_owner — desk row 프로필 KO/EN 추가
--
-- 원본 (20260610000000 SECTION 1) 과 로직 동일. 최종 select 의
-- jsonb_build_object 안에 `display_name_ko` / `display_name_en` 두 키만
-- 추가한다. desk row 는 profile-level 만 노출 (bio 는 card 에서만).
create or replace function public.get_relationship_desk_for_owner(
  p_owner_profile_id uuid    default null,
  p_limit            integer default 50,
  p_offset           integer default 0,
  p_status           text    default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $a$
declare
  v_uid    uuid := auth.uid();
  v_owner  uuid;
  v_status text := nullif(coalesce(p_status, ''), 'all');
  v_limit  int  := greatest(1, least(coalesce(p_limit,  50), 200));
  v_offset int  := greatest(0, coalesce(p_offset, 0));
  v_result jsonb;
begin
  if v_uid is null then
    return '[]'::jsonb;
  end if;

  v_owner := coalesce(p_owner_profile_id, v_uid);

  if v_owner <> v_uid
     and not public.is_active_account_delegate_writer(v_owner) then
    return '[]'::jsonb;
  end if;

  with raw_events as (
    select ar.requester_profile_id as related_profile_id,
           ar.created_at           as activity_at,
           'access_request'::text  as activity_type,
           coalesce(a.title, '*')  as subject_title,
           ar.status               as evt_status
    from public.access_requests ar
    left join public.artworks a
      on a.id = ar.subject_id and ar.subject_type = 'artwork'
    where ar.owner_profile_id = v_owner

    union all

    select pi.inquirer_id          as related_profile_id,
           pi.created_at           as activity_at,
           'inquiry'::text         as activity_type,
           coalesce(a.title, '*')  as subject_title,
           pi.inquiry_status       as evt_status
    from public.price_inquiries pi
    join public.artworks a on a.id = pi.artwork_id
    where a.artist_id = v_owner

    union all

    select ag.grantee_profile_id   as related_profile_id,
           ag.created_at           as activity_at,
           'grant'::text           as activity_type,
           coalesce(a.title, s.title, '*') as subject_title,
           'active'::text          as evt_status
    from public.access_grants ag
    left join public.artworks a
      on a.id = ag.subject_id and ag.subject_type = 'artwork'
    left join public.shortlists s
      on s.id = ag.subject_id and ag.subject_type = 'room'
    where ag.owner_profile_id = v_owner

    union all

    select f.follower_id           as related_profile_id,
           f.created_at            as activity_at,
           'follow'::text          as activity_type,
           null::text              as subject_title,
           f.status                as evt_status
    from public.follows f
    where f.following_id = v_owner
      and f.status = 'accepted'

    union all

    select rpn.target_profile_id   as related_profile_id,
           rpn.updated_at          as activity_at,
           'note'::text            as activity_type,
           null::text              as subject_title,
           'active'::text          as evt_status
    from public.relationship_private_notes rpn
    where rpn.owner_profile_id = v_owner
  ),
  events as (
    select * from raw_events where related_profile_id is not null
  ),
  filtered as (
    select * from events
    where v_status is null or activity_type = v_status
  ),
  latest as (
    select related_profile_id,
           max(activity_at) as last_activity_at
    from filtered
    group by related_profile_id
  ),
  latest_meta as (
    select distinct on (e.related_profile_id)
      e.related_profile_id,
      e.activity_at,
      e.activity_type,
      e.subject_title
    from filtered e
    join latest l
      on l.related_profile_id = e.related_profile_id
     and l.last_activity_at = e.activity_at
    order by e.related_profile_id, e.activity_at desc, e.activity_type
  ),
  counts as (
    select related_profile_id,
      count(*) filter (where activity_type = 'access_request' and evt_status = 'pending') as pending_access_request_count,
      count(*) filter (where activity_type = 'inquiry' and evt_status <> 'closed')         as open_inquiry_count,
      count(*) filter (where activity_type = 'grant')                                       as active_grant_count
    from events
    group by related_profile_id
  ),
  page as (
    select lm.related_profile_id,
           lm.activity_at,
           lm.activity_type,
           lm.subject_title
    from latest_meta lm
    order by lm.activity_at desc
    limit v_limit offset v_offset
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'profile_id', p.id,
      'display_name', p.display_name,
      'display_name_ko', p.display_name_ko,
      'display_name_en', p.display_name_en,
      'username', p.username,
      'avatar_url', p.avatar_url,
      'role_label', p.main_role,
      'relationship_status', case
        when exists (
          select 1 from public.follows f1
          where f1.follower_id = v_owner and f1.following_id = p.id and f1.status = 'accepted')
         and exists (
          select 1 from public.follows f2
          where f2.follower_id = p.id and f2.following_id = v_owner and f2.status = 'accepted')
          then 'mutual'
        when exists (
          select 1 from public.follows f2
          where f2.follower_id = p.id and f2.following_id = v_owner and f2.status = 'accepted')
          then 'follower'
        when exists (
          select 1 from public.follows f1
          where f1.follower_id = v_owner and f1.following_id = p.id and f1.status = 'accepted')
          then 'following'
        when exists (
          select 1 from public.access_grants g
          where g.owner_profile_id = v_owner and g.grantee_profile_id = p.id
            and (g.expires_at is null or g.expires_at > now()))
          then 'approved'
        else 'none'
      end,
      'last_activity_at', pg.activity_at,
      'last_activity_type', pg.activity_type,
      'last_subject_title', pg.subject_title,
      'pending_access_request_count', coalesce(c.pending_access_request_count, 0),
      'open_inquiry_count',          coalesce(c.open_inquiry_count, 0),
      'active_grant_count',          coalesce(c.active_grant_count, 0),
      'has_private_note', exists (
        select 1 from public.relationship_private_notes rpn
        where rpn.owner_profile_id = v_owner
          and rpn.target_profile_id = p.id
      ),
      'private_note_updated_at', (
        select rpn.updated_at
        from public.relationship_private_notes rpn
        where rpn.owner_profile_id = v_owner
          and rpn.target_profile_id = p.id
        limit 1
      )
    )
    order by pg.activity_at desc
  ), '[]'::jsonb)
  into v_result
  from page pg
  join public.profiles p on p.id = pg.related_profile_id
  left join counts c on c.related_profile_id = pg.related_profile_id;

  return coalesce(v_result, '[]'::jsonb);
end;
$a$;

grant execute on function public.get_relationship_desk_for_owner(uuid, integer, integer, text) to authenticated;

-- == SECTION 2 == get_relationship_card_for_owner — profile KO/EN + bio KO/EN 추가
--
-- 원본 (20260610000000 SECTION 2) 과 로직 동일. `v_profile` 을 만들 때
-- display_name / bio 옆에 KO/EN 슬롯을 additive 로 추가한다.
create or replace function public.get_relationship_card_for_owner(
  p_owner_profile_id  uuid default null,
  p_target_profile_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $b$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_target uuid := p_target_profile_id;
  v_profile jsonb;
  v_relationship_status text;
  v_requests jsonb;
  v_grants jsonb;
  v_inquiries jsonb;
  v_rooms jsonb;
  v_note jsonb;
begin
  if v_uid is null then
    return null;
  end if;
  v_owner := coalesce(p_owner_profile_id, v_uid);
  if v_owner <> v_uid
     and not public.is_active_account_delegate_writer(v_owner) then
    return null;
  end if;
  if v_target is null or v_target = v_owner then
    return null;
  end if;

  select jsonb_build_object(
    'id', p.id,
    'username', p.username,
    'display_name', p.display_name,
    'display_name_ko', p.display_name_ko,
    'display_name_en', p.display_name_en,
    'avatar_url', p.avatar_url,
    'bio', p.bio,
    'bio_ko', p.bio_ko,
    'bio_en', p.bio_en,
    'main_role', p.main_role,
    'roles', p.roles
  ) into v_profile
  from public.profiles p
  where p.id = v_target;

  if v_profile is null then
    return null;
  end if;

  v_relationship_status := case
    when exists (
      select 1 from public.follows f1
      where f1.follower_id = v_owner and f1.following_id = v_target and f1.status = 'accepted')
     and exists (
      select 1 from public.follows f2
      where f2.follower_id = v_target and f2.following_id = v_owner and f2.status = 'accepted')
      then 'mutual'
    when exists (
      select 1 from public.follows f2
      where f2.follower_id = v_target and f2.following_id = v_owner and f2.status = 'accepted')
      then 'follower'
    when exists (
      select 1 from public.follows f1
      where f1.follower_id = v_owner and f1.following_id = v_target and f1.status = 'accepted')
      then 'following'
    when exists (
      select 1 from public.access_grants g
      where g.owner_profile_id = v_owner and g.grantee_profile_id = v_target
        and (g.expires_at is null or g.expires_at > now()))
      then 'approved'
    else 'none'
  end;

  v_requests := (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', ar.id,
        'subject_type', ar.subject_type,
        'subject_id', ar.subject_id,
        'field_key', ar.field_key,
        'request_type', ar.request_type,
        'status', ar.status,
        'created_at', ar.created_at,
        'updated_at', ar.updated_at,
        'subject_title', a.title
      ) order by ar.created_at desc
    ), '[]'::jsonb)
    from (
      select * from public.access_requests
      where owner_profile_id = v_owner
        and requester_profile_id = v_target
      order by created_at desc
      limit 20
    ) ar
    left join public.artworks a
      on a.id = ar.subject_id and ar.subject_type = 'artwork'
  );

  v_grants := (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', ag.id,
        'subject_type', ag.subject_type,
        'subject_id', ag.subject_id,
        'field_key', ag.field_key,
        'grant_type', ag.grant_type,
        'expires_at', ag.expires_at,
        'created_at', ag.created_at,
        'subject_title', coalesce(a.title, s.title)
      ) order by ag.created_at desc
    ), '[]'::jsonb)
    from (
      select * from public.access_grants
      where owner_profile_id = v_owner
        and grantee_profile_id = v_target
      order by created_at desc
      limit 20
    ) ag
    left join public.artworks a
      on a.id = ag.subject_id and ag.subject_type = 'artwork'
    left join public.shortlists s
      on s.id = ag.subject_id and ag.subject_type = 'room'
  );

  v_inquiries := (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', pi.id,
        'artwork_id', pi.artwork_id,
        'inquiry_status', pi.inquiry_status,
        'created_at', pi.created_at,
        'last_message_at', pi.last_message_at,
        'subject_title', a.title
      ) order by coalesce(pi.last_message_at, pi.created_at) desc
    ), '[]'::jsonb)
    from public.price_inquiries pi
    join public.artworks a
      on a.id = pi.artwork_id and a.artist_id = v_owner
    where pi.inquirer_id = v_target
    limit 20
  );

  v_rooms := (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'room_id', s.id,
        'title', s.title,
        'has_active_grant', exists (
          select 1 from public.access_grants ag
          where ag.owner_profile_id = v_owner
            and ag.grantee_profile_id = v_target
            and ag.subject_type = 'room'
            and ag.subject_id = s.id
            and (ag.expires_at is null or ag.expires_at > now())
        ),
        'was_shared_or_granted', true
      ) order by s.updated_at desc
    ), '[]'::jsonb)
    from public.shortlists s
    where s.owner_id = v_owner
      and exists (
        select 1 from public.access_grants ag
        where ag.owner_profile_id = v_owner
          and ag.grantee_profile_id = v_target
          and ag.subject_type = 'room'
          and ag.subject_id = s.id
      )
    limit 20
  );

  v_note := (
    select jsonb_build_object(
      'id', rpn.id,
      'note', rpn.note,
      'updated_at', rpn.updated_at
    )
    from public.relationship_private_notes rpn
    where rpn.owner_profile_id = v_owner
      and rpn.target_profile_id = v_target
    limit 1
  );

  return jsonb_build_object(
    'profile', v_profile,
    'relationship_status', v_relationship_status,
    'requests', v_requests,
    'grants', v_grants,
    'inquiries', v_inquiries,
    'rooms', v_rooms,
    'private_note', v_note
  );
end;
$b$;

grant execute on function public.get_relationship_card_for_owner(uuid, uuid) to authenticated;

commit;
