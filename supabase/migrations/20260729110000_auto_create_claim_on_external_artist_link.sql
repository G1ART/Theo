-- QA 2026-07-29 (Part D) — 외부 작가 → 프로필 연결 시 CREATED claim 자동 보장.
--
-- 배경
-- ----
-- `price_inquiry_artist_id` (`p0_price_inquiry_artist_id_triple_fallback.sql`)
-- 는 work 의 진짜 창작자를 찾을 때 CREATED claim 의 `subject_profile_id` 를
-- 1순위 fallback 으로 사용한다. 그런데 갤러리/큐레이터가 외부 작가를
-- OWNS/INVENTORY/CURATED 로 업로드한 경우 CREATED claim 자체가 없을 수
-- 있고, 이후 그 외부 작가가 온보딩해도 (자동 링크 트리거 / orphan claim /
-- 수동 link RPC 중 어느 경로든) CREATED claim 이 저절로 생기지 않는다.
-- 이 갭은 향후 기능(판매 로열티 분배, 작가-인증 배지, CREATED 와
-- OWNS/INVENTORY 를 구분해 보여주는 provenance 렌더링)이 모두 CREATED
-- claim 의 존재를 전제하므로 지금 메워둔다.
--
-- 이 마이그레이션 (release-workflow.mdc — PL/pgSQL 함수 4개 → SECTION
-- 배너로 분리, dollar tag letters-only):
--
--   SECTION 1 — ensure_created_claims_for_linked_artist(uuid, uuid[]):
--               공용 헬퍼. work 목록 중 CREATED claim 이 아직 없는
--               work 에 한해 새 CREATED claim 을 만든다(idempotent, per
--               `uq_claims_one_created_per_work` 부분 유니크 인덱스 —
--               `p0_claims.sql` SECTION 4 참고. NOT EXISTS 와 정합적).
--               **의도적으로 authenticated 에 grant 하지 않는다** — 이
--               헬퍼는 work 소유권을 스스로 검증하지 않으므로, 이미
--               검증을 마친 SECURITY DEFINER 트리거/RPC(SECTION 2-4)
--               내부에서만 호출되어야 한다. 직접 grant 시 임의 사용자가
--               아무 work 에나 자신을 창작자로 자칭하는 CREATED claim 을
--               만들 수 있는 심각한 권한 상승 경로가 된다.
--   SECTION 2 — handle_auth_user_created_link_external_artist (auth
--               트리거): 이메일 매칭 자동 링크 후 CREATED claim 보장.
--   SECTION 3 — claim_orphan_external_artist_as_self: orphan(무이메일)
--               자가 claim 후 CREATED claim 보장.
--   SECTION 4 — link_external_artist_to_profile: 초대자 수동 링크 후
--               CREATED claim 보장.
--
-- 안전성 체크리스트
-- ------------------
--   * 기존 INVENTORY/CURATED claim 의 `subject_profile_id` 는 절대 건드리지
--     않는다 — 헬퍼는 새 CREATED claim 을 INSERT 할 뿐, 다른 claim 을
--     UPDATE 하지 않는다.
--   * `not exists (select 1 from claims where work_id = a.id and
--     claim_type = 'CREATED')` 가드로 이미 CREATED 가 있는 work 는
--     건드리지 않는다(idempotent, 재실행 안전).
--   * `uq_claims_one_created_per_work` 부분 유니크 인덱스
--     (`work_id` unique where `claim_type = 'CREATED'`) 가 이미 존재하므로
--     NOT EXISTS 가드와 결합해 unique violation 가능성이 없다.
--   * 검증 쿼리(적용 후 실행): 아래는 0 행이어야 한다.
--       select count(*) from public.claims
--        where claim_type = 'CREATED'
--        group by work_id having count(*) > 1;
--
begin;

-- ────────────────────────────────────────────────────────────────────
-- == SECTION 1 == ensure_created_claims_for_linked_artist (내부 헬퍼)
-- ────────────────────────────────────────────────────────────────────
create or replace function public.ensure_created_claims_for_linked_artist(
  p_subject_profile_id uuid,
  p_work_ids uuid[]
) returns void
language plpgsql
security definer
set search_path = public
as $ensurecreated$
begin
  if p_subject_profile_id is null
     or p_work_ids is null
     or array_length(p_work_ids, 1) is null then
    return;
  end if;

  -- price_inquiry_artist_id (p0_price_inquiry_artist_id_triple_fallback.sql)
  -- 는 CREATED claim 의 subject 를 1순위 fallback 으로 쓴다. 그 슬롯을
  -- 정확히 채워두면 판매 로열티 분배, 작가-인증 배지, CREATED 대
  -- OWNS/INVENTORY 를 구분하는 provenance 렌더링 등 향후 기능이 진짜
  -- 창작자를 신뢰성 있게 찾을 수 있다.
  insert into public.claims (
    subject_profile_id, claim_type, work_id, status, visibility, period_status
  )
  select
    p_subject_profile_id,
    'CREATED',
    a.id,
    'confirmed',
    'public',
    null
  from public.artworks a
  where a.id = any(p_work_ids)
    and not exists (
      select 1 from public.claims c
      where c.work_id = a.id and c.claim_type = 'CREATED'
    );
end;
$ensurecreated$;

-- 의도적으로 public/authenticated 에 grant 하지 않는다 (위 헤더 설명 참고).
revoke all on function public.ensure_created_claims_for_linked_artist(uuid, uuid[]) from public, authenticated, anon;

-- ────────────────────────────────────────────────────────────────────
-- == SECTION 2 == handle_auth_user_created_link_external_artist + CREATED 보장
-- ────────────────────────────────────────────────────────────────────
--
-- 20260728240005 SECTION 5 (KO/EN 상속 포함) 위에 CREATED claim 보장
-- 한 단계만 추가한다. 나머지 로직은 그대로.
create or replace function public.handle_auth_user_created_link_external_artist()
returns trigger
language plpgsql
security definer
set search_path = public
as $linktrigger$
declare
  v_email text;
  v_user_id uuid;
  v_ext_ids uuid[];
  v_work_ids uuid[];
  v_ext_ko text;
  v_ext_en text;
begin
  v_user_id := new.id;
  v_email := coalesce(trim(new.email), '');
  if v_email = '' then
    return new;
  end if;

  insert into public.profiles (id, is_public, roles, profile_completeness, profile_details, profile_updated_at, updated_at)
  values (v_user_id, true, '{}'::text[], 0, '{}'::jsonb, now(), now())
  on conflict (id) do nothing;

  update public.external_artists
  set claimed_profile_id = v_user_id, status = 'claimed'
  where lower(trim(invite_email)) = lower(v_email) and claimed_profile_id is null;

  select array_agg(id) into v_ext_ids
  from public.external_artists
  where claimed_profile_id = v_user_id;

  if v_ext_ids is null or array_length(v_ext_ids, 1) is null then
    return new;
  end if;

  -- 후보 external 행이 여러 개면 KO/EN 은 첫 non-null 을 쓴다 (임의 하나).
  select
    max(nullif(trim(coalesce(display_name_ko, '')), '')) filter (where display_name_ko is not null),
    max(nullif(trim(coalesce(display_name_en, '')), '')) filter (where display_name_en is not null)
    into v_ext_ko, v_ext_en
    from public.external_artists
   where id = any(v_ext_ids);

  -- profile 의 슬롯이 null 일 때만 상속. 사용자가 이미 세팅한 값은 존중.
  update public.profiles
     set display_name_ko = coalesce(display_name_ko, v_ext_ko),
         display_name_en = coalesce(display_name_en, v_ext_en)
   where id = v_user_id
     and (
       (display_name_ko is null and v_ext_ko is not null)
       or (display_name_en is null and v_ext_en is not null)
     );

  select array_agg(work_id) into v_work_ids
  from public.claims
  where external_artist_id = any(v_ext_ids) and work_id is not null;

  update public.claims
  set artist_profile_id = v_user_id, external_artist_id = null
  where external_artist_id = any(v_ext_ids);

  if v_work_ids is not null and array_length(v_work_ids, 1) > 0 then
    update public.artworks
    set artist_id = v_user_id
    where id = any(v_work_ids);

    -- QA 2026-07-29 (Part D) — 이관된 work 들 중 CREATED claim 이 없는
    -- 것에 한해 새로 만든다(idempotent).
    perform public.ensure_created_claims_for_linked_artist(v_user_id, v_work_ids);
  end if;

  return new;
end;
$linktrigger$;

drop trigger if exists on_auth_user_created_link_external_artist on auth.users;
create trigger on_auth_user_created_link_external_artist
  after insert on auth.users
  for each row execute function public.handle_auth_user_created_link_external_artist();

-- ────────────────────────────────────────────────────────────────────
-- == SECTION 3 == claim_orphan_external_artist_as_self + CREATED 보장
-- ────────────────────────────────────────────────────────────────────
create or replace function public.claim_orphan_external_artist_as_self(
  p_external_artist_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $orphanclaim$
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

    -- QA 2026-07-29 (Part D) — CREATED claim 보장 (idempotent).
    perform public.ensure_created_claims_for_linked_artist(v_uid, v_work_ids);
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
$orphanclaim$;

grant execute on function public.claim_orphan_external_artist_as_self(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────────
-- == SECTION 4 == link_external_artist_to_profile + CREATED 보장
-- ────────────────────────────────────────────────────────────────────
create or replace function public.link_external_artist_to_profile(
  p_external_artist_id uuid,
  p_target_profile_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $manuallink$
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

    -- QA 2026-07-29 (Part D) — CREATED claim 보장 (idempotent).
    perform public.ensure_created_claims_for_linked_artist(p_target_profile_id, v_work_ids);
  end if;

  return jsonb_build_object(
    'external_artist_id', p_external_artist_id,
    'target_profile_id', p_target_profile_id,
    'claims_migrated', v_claims,
    'works_moved', coalesce(array_length(v_work_ids, 1), 0)
  );
end;
$manuallink$;

grant execute on function public.link_external_artist_to_profile(uuid, uuid) to authenticated;

commit;
