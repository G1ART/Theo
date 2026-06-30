-- Phase 2 — 소유자(초대자)용 "외부 작가 → 온보딩 프로필 연결" RPC.
--
-- 배경: 온보딩 자동 연결 트리거는 invite_email 일치로만 동작한다. 이메일 없이
-- 초대했거나, 작가가 다른 이메일로 가입한 경우 자동 연결이 누락된다. 이 RPC 는
-- 초대자(또는 그 계정 위임 writer)가 수동으로 외부 작가 행을 실제 프로필에
-- 이어주게 한다. 연결 의미는 signup 트리거와 동일:
--   claimed_profile_id 설정 → claims 이관(artist_profile_id, external_artist_id=null)
--   → artworks.artist_id 전환(피드/프로필에 작가 본인으로 표시).

begin;

-- == SECTION 1 == 연결 RPC
create or replace function public.link_external_artist_to_profile(
  p_external_artist_id uuid,
  p_target_profile_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $a$
declare
  v_uid       uuid := auth.uid();
  v_inviter   uuid;
  v_claimed   uuid;
  v_work_ids  uuid[];
  v_claims    int;
begin
  if v_uid is null then
    raise exception 'auth.uid() is null';
  end if;

  select invited_by, claimed_profile_id into v_inviter, v_claimed
    from public.external_artists where id = p_external_artist_id;
  if v_inviter is null then
    raise exception 'external_artist not found';
  end if;
  if v_uid <> v_inviter and not public.is_active_writer_for(v_inviter) then
    raise exception 'forbidden: only the inviter or their account delegate may link this artist';
  end if;
  if v_claimed is not null then
    raise exception 'external_artist is already linked to a profile';
  end if;

  perform 1 from public.profiles where id = p_target_profile_id;
  if not found then
    raise exception 'target profile not found';
  end if;

  update public.external_artists
     set claimed_profile_id = p_target_profile_id, status = 'claimed'
   where id = p_external_artist_id;

  select array_agg(work_id) into v_work_ids
    from public.claims
   where external_artist_id = p_external_artist_id and work_id is not null;

  update public.claims
     set artist_profile_id = p_target_profile_id, external_artist_id = null
   where external_artist_id = p_external_artist_id;
  get diagnostics v_claims = row_count;

  if v_work_ids is not null and array_length(v_work_ids, 1) > 0 then
    update public.artworks
       set artist_id = p_target_profile_id
     where id = any(v_work_ids);
  end if;

  return jsonb_build_object(
    'external_artist_id', p_external_artist_id,
    'target_profile_id', p_target_profile_id,
    'claims_migrated', v_claims,
    'works_moved', coalesce(array_length(v_work_ids, 1), 0)
  );
end;
$a$;

grant execute on function public.link_external_artist_to_profile(uuid, uuid) to authenticated;

-- == SECTION 2 == 초대자의 (미연결) 외부 작가 목록 + 작품 수
create or replace function public.list_my_external_artists(
  p_inviter uuid default null
)
returns table (
  id uuid,
  display_name text,
  invite_email text,
  has_email boolean,
  work_count bigint,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $b$
declare
  v_uid     uuid := auth.uid();
  v_inviter uuid;
begin
  if v_uid is null then
    raise exception 'auth.uid() is null';
  end if;
  v_inviter := coalesce(p_inviter, v_uid);
  if v_inviter <> v_uid and not public.is_active_writer_for(v_inviter) then
    raise exception 'forbidden';
  end if;

  return query
    select ea.id,
           ea.display_name,
           ea.invite_email,
           (nullif(trim(ea.invite_email), '') is not null) as has_email,
           (select count(*) from public.claims c
             where c.external_artist_id = ea.id and c.work_id is not null) as work_count,
           ea.created_at
      from public.external_artists ea
     where ea.invited_by = v_inviter
       and ea.claimed_profile_id is null
     order by ea.created_at desc;
end;
$b$;

grant execute on function public.list_my_external_artists(uuid) to authenticated;

commit;
