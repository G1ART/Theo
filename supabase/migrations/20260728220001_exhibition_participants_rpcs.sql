-- QA 2026-07-28 — 전시 참여자 RPC (list / remove)
--
-- 배경
-- ----
-- 20260728220000 에서 project-scope CURATED claim 을 참여자 진실원으로
-- 승격 (unique index + idempotent RPC). 이 파일은 그 데이터를 UI 가 사용할
-- 수 있게 만드는 두 개의 SECURITY DEFINER RPC 를 추가한다:
--
--   * list_exhibition_participants(p_project_id) — /add 페이지 hydration.
--   * remove_exhibition_participant(p_claim_id, p_delete_external) —
--     명단에서 빼기 버튼. work-scope claim 이 있으면 `works_present`.
--
-- 권한 모델
-- ---------
-- 두 RPC 모두 caller 가 다음 중 하나여야 한다:
--   (a) `projects.curator_id = auth.uid()` (오너 큐레이터)
--   (b) `projects.host_profile_id = auth.uid()` (호스트 갤러리)
--   (c) 프로젝트 스코프 delegation writer (`manage_works` 또는
--       `edit_metadata`) — 위임받은 대행자.
--
-- PII 정책
-- --------
-- `invite_email` 은 오너 (curator/host) 에게만 노출. 대행자 (delegate) 는
-- 다른 external_artists RPC 와 동일하게 email 을 볼 수 없다.
--
-- 스타일: letters-only dollar tag, SECTION 배너, SECURITY DEFINER + set
-- search_path = public.

begin;

-- == SECTION 1 == 헬퍼: 이 프로젝트에 대해 caller 가 관리자인가?
--
-- 인라인 EXISTS 3개보다 헬퍼 하나로 두 RPC 에서 공유. 반환 컬럼 `owner`
-- 는 curator/host 여부(참) vs 대행자(거짓) 구분 — PII 게이팅용.

create or replace function public.is_exhibition_manager(
  p_project_id uuid,
  out is_manager boolean,
  out is_owner   boolean
)
language plpgsql
stable
security definer
set search_path = public
as $a$
declare
  v_uid uuid := auth.uid();
begin
  is_manager := false;
  is_owner   := false;

  if v_uid is null or p_project_id is null then
    return;
  end if;

  -- 오너 판정: curator/host
  is_owner := exists (
    select 1 from public.projects p
     where p.id = p_project_id
       and (p.curator_id = v_uid or p.host_profile_id = v_uid)
  );

  if is_owner then
    is_manager := true;
    return;
  end if;

  -- 대행자 판정: 활성 프로젝트 delegation (manage_works 또는 edit_metadata)
  is_manager := exists (
    select 1 from public.delegations d
     where d.project_id          = p_project_id
       and d.delegate_profile_id = v_uid
       and d.scope_type          = 'project'
       and d.status              = 'active'
       and ('manage_works' = any(d.permissions)
            or 'edit_metadata' = any(d.permissions))
  );
end;
$a$;

grant execute on function public.is_exhibition_manager(uuid) to authenticated;


-- == SECTION 2 == list_exhibition_participants
--
-- /add 페이지가 마운트마다 이걸 호출해 참여자 명단을 hydrate.
-- profile 참여자(kind='profile') 는 검색으로 추가된 온보딩 작가,
-- external 참여자(kind='external') 는 초대된 외부 작가. 순서는 claim
-- created_at 오름차순 (사용자가 추가한 순서 유지).
--
-- `works_count` 는 이 전시에 이미 등록된 작품 중 해당 subject 로 attribute
-- 된 개수. UI 에서 "작품 N점" 배지 및 remove 차단 hint 에 사용.

create or replace function public.list_exhibition_participants(
  p_project_id uuid
)
returns table (
  kind                text,
  claim_id            uuid,
  profile_id          uuid,
  external_artist_id  uuid,
  display_name        text,
  display_name_ko     text,
  display_name_en     text,
  username            text,
  invite_email        text,
  works_count         integer,
  created_at          timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $b$
declare
  v_uid      uuid := auth.uid();
  v_manager  boolean;
  v_owner    boolean;
begin
  if v_uid is null then
    raise exception 'auth.uid() is null';
  end if;
  if p_project_id is null then
    raise exception 'p_project_id required';
  end if;

  select im.is_manager, im.is_owner
    into v_manager, v_owner
    from public.is_exhibition_manager(p_project_id) im;

  if not v_manager then
    raise exception 'forbidden: caller is not a manager of this exhibition';
  end if;

  return query
  -- 온보딩된 참여자
  select
    'profile'::text                                          as kind,
    c.id                                                     as claim_id,
    pr.id                                                    as profile_id,
    null::uuid                                               as external_artist_id,
    pr.display_name                                          as display_name,
    null::text                                               as display_name_ko,
    null::text                                               as display_name_en,
    pr.username                                              as username,
    null::text                                               as invite_email,
    (
      select count(*)::int from public.exhibition_works ew
        join public.artworks a on a.id = ew.work_id
       where ew.exhibition_id = p_project_id
         and (a.artist_id = pr.id
              or exists (
                select 1 from public.claims cc
                 where cc.work_id = a.id
                   and cc.artist_profile_id = pr.id
                   and cc.claim_type = 'CURATED'
              ))
    )                                                        as works_count,
    c.created_at                                             as created_at
    from public.claims c
    join public.profiles pr on pr.id = c.artist_profile_id
   where c.project_id = p_project_id
     and c.work_id is null
     and c.claim_type = 'CURATED'
     and c.artist_profile_id is not null

  union all

  -- 외부 (미온보딩) 참여자. invite_email 은 오너에게만.
  select
    'external'::text                                         as kind,
    c.id                                                     as claim_id,
    null::uuid                                               as profile_id,
    ea.id                                                    as external_artist_id,
    ea.display_name                                          as display_name,
    ea.display_name_ko                                       as display_name_ko,
    ea.display_name_en                                       as display_name_en,
    null::text                                               as username,
    case when v_owner then ea.invite_email else null end     as invite_email,
    (
      select count(*)::int from public.exhibition_works ew
        join public.claims cc on cc.work_id = ew.work_id
       where ew.exhibition_id = p_project_id
         and cc.external_artist_id = ea.id
         and cc.claim_type = 'CURATED'
    )                                                        as works_count,
    c.created_at                                             as created_at
    from public.claims c
    join public.external_artists ea on ea.id = c.external_artist_id
   where c.project_id = p_project_id
     and c.work_id is null
     and c.claim_type = 'CURATED'
     and c.external_artist_id is not null

  order by created_at asc;
end;
$b$;

grant execute on function public.list_exhibition_participants(uuid) to authenticated;


-- == SECTION 3 == remove_exhibition_participant
--
-- 명단 × 버튼. 삭제 대상은 project-only CURATED claim 1개.
-- 이 전시에 이미 subject 의 작품이 있으면 `works_present` 로 raise —
-- UI 는 그 사유로 remove 를 막고 사용자에게 "작품 먼저 정리" 안내.
--
-- p_delete_external=true 이고 external_artist 의 남은 claim 이 0 이면
-- external_artists row 자체도 삭제. 그렇지 않으면 명단만 정리하고 external
-- row 는 보존 (다른 전시에서 참조 중일 수 있음).

create or replace function public.remove_exhibition_participant(
  p_claim_id         uuid,
  p_delete_external  boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $c$
declare
  v_uid              uuid := auth.uid();
  v_manager          boolean;
  v_project_id       uuid;
  v_work_id          uuid;
  v_claim_type       text;
  v_ext_id           uuid;
  v_prof_id          uuid;
  v_works_present    integer;
  v_remaining_claims integer;
  v_ext_deleted      boolean := false;
begin
  if v_uid is null then
    raise exception 'auth.uid() is null';
  end if;
  if p_claim_id is null then
    raise exception 'p_claim_id required';
  end if;

  select c.project_id, c.work_id, c.claim_type, c.external_artist_id, c.artist_profile_id
    into v_project_id, v_work_id, v_claim_type, v_ext_id, v_prof_id
    from public.claims c
   where c.id = p_claim_id;

  if v_project_id is null then
    raise exception 'claim not found or not a project-scope claim';
  end if;
  if v_work_id is not null then
    raise exception 'refuse to delete work-scope claim via this RPC';
  end if;
  if v_claim_type <> 'CURATED' then
    raise exception 'refuse to delete non-CURATED project claim via this RPC';
  end if;

  select im.is_manager
    into v_manager
    from public.is_exhibition_manager(v_project_id) im;
  if not v_manager then
    raise exception 'forbidden: caller is not a manager of this exhibition';
  end if;

  -- work-scope claim (같은 subject × 이 전시에 등록된 작품) 이 있으면 차단.
  if v_ext_id is not null then
    v_works_present := (
      select count(*)::int from public.claims cc
        join public.exhibition_works ew on ew.work_id = cc.work_id
       where ew.exhibition_id = v_project_id
         and cc.external_artist_id = v_ext_id
         and cc.claim_type = 'CURATED'
    );
  elsif v_prof_id is not null then
    v_works_present := (
      select count(*)::int from public.exhibition_works ew
        join public.artworks a on a.id = ew.work_id
       where ew.exhibition_id = v_project_id
         and (a.artist_id = v_prof_id
              or exists (
                select 1 from public.claims cc
                 where cc.work_id = a.id
                   and cc.artist_profile_id = v_prof_id
                   and cc.claim_type = 'CURATED'
              ))
    );
  else
    v_works_present := 0;
  end if;

  if v_works_present > 0 then
    raise exception 'works_present: % work(s) still attached to this participant', v_works_present
      using errcode = 'P0001';
  end if;

  delete from public.claims where id = p_claim_id;

  -- 요청 시 external_artists 도 정리 (남은 참조가 전혀 없을 때만).
  if p_delete_external and v_ext_id is not null then
    v_remaining_claims := (
      select count(*)::int from public.claims cc
       where cc.external_artist_id = v_ext_id
    );
    if v_remaining_claims = 0 then
      delete from public.external_artists
       where id = v_ext_id
         and claimed_profile_id is null
         and invited_by = v_uid;
      if found then
        v_ext_deleted := true;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'removed', true,
    'external_artist_deleted', v_ext_deleted
  );
end;
$c$;

grant execute on function public.remove_exhibition_participant(uuid, boolean) to authenticated;

commit;
