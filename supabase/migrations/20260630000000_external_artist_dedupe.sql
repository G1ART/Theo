-- QA 2026-06-30 — 외부(초대 전) 작가 엔티티 정규화(dedupe).
--
-- 배경
-- ----
-- 비온보딩 작가의 작품을 싱글/벌크로 업로드할 때마다
-- create_external_artist_and_claim 이 매번 새 external_artists 행을
-- 생성한다(난수 id 발급). 그래서 같은 작가("김수철")의 작품이
-- external_artist_id 기준으로는 작품 수만큼 쪼개지고, 전시 페이지의
-- "작가별 섹션" 그룹핑이 한 작가를 여러 섹션으로 분해했다.
--
-- 방침 (사용자 승인 A안)
-- ---------------------
--   1) 백필: 기존 중복 external_artists 를 "작가당 1행"으로 병합한다.
--      - 병합 키는 정규화된 display_name(소문자/trim). 현재 유저 수가
--        적어 동명이인이 없음을 확인했으므로 이름 기준 병합이 안전.
--      - 단, 같은 이름인데 서로 다른 non-null 이메일이 2개 이상이면
--        동명이인 가능성이 있으므로 병합을 건너뛴다(가드).
--      - canonical 행은 이메일 보유 행을 우선(가입 시 invite_email
--        매칭 트리거가 계속 동작해야 하므로), 없으면 최초 생성행.
--      - 이미 온보딩(claimed_profile_id not null)된 행은 건드리지 않는다.
--   2) 업로드 dedupe: create_external_artist_and_claim 이 같은 초대자에
--      대해 (이메일 있으면 이메일, 없으면 이름) 기준으로 기존 행을
--      재사용하도록 한다. → 앞으로 external_artist_id 가 작가당 안정적.
--
-- 그룹핑(클라이언트)은 이 마이그레이션 적용 후 external_artist_id 를
-- 안정 키로 사용한다(src/lib/supabase/artworks.ts).
--
-- 후속 검토 과제(별도): 비온보딩 작가를 매 업로드마다 재초대하는 UX
-- 자체를 개선(작가 선택/재사용 UI, 초대 이메일 필수화 등).
--
-- 적용 안내: 이 파일은 PL/pgSQL 본문이 2개(SECTION 1 DO 블록,
-- SECTION 2 함수)이므로, Supabase SQL Editor 에서는 SECTION 단위로
-- highlight → Run 한다(release-workflow 규칙).

begin;

-- == SECTION 1 == 기존 중복 external_artists 병합 (이름 기준, 이메일 가드)
do $a$
declare
  g record;
  v_canonical uuid;
  v_email_count int;
begin
  for g in
    select lower(trim(display_name)) as name_key
      from public.external_artists
     where claimed_profile_id is null
       and coalesce(trim(display_name), '') <> ''
     group by lower(trim(display_name))
    having count(*) > 1
  loop
    -- 동명이인 가드: 서로 다른 non-null 이메일이 2개 이상이면 병합 보류
    select count(distinct lower(trim(invite_email)))
      into v_email_count
      from public.external_artists
     where claimed_profile_id is null
       and lower(trim(display_name)) = g.name_key
       and nullif(trim(invite_email), '') is not null;

    if v_email_count >= 2 then
      raise notice 'external_artist dedupe: skip "%": % distinct emails (possible homonyms)',
        g.name_key, v_email_count;
      continue;
    end if;

    -- canonical: 이메일 보유 행 우선, 그 다음 최초 생성행
    select id
      into v_canonical
      from public.external_artists
     where claimed_profile_id is null
       and lower(trim(display_name)) = g.name_key
     order by (nullif(trim(invite_email), '') is null), created_at asc, id asc
     limit 1;

    -- canonical 의 비어 있는 메타데이터를 그룹에서 보충
    update public.external_artists c
       set invite_email = coalesce(nullif(trim(c.invite_email), ''), src.invite_email),
           website      = coalesce(nullif(trim(c.website), ''), src.website),
           instagram    = coalesce(nullif(trim(c.instagram), ''), src.instagram)
      from (
        select
          max(nullif(trim(invite_email), '')) as invite_email,
          max(nullif(trim(website), ''))      as website,
          max(nullif(trim(instagram), ''))    as instagram
          from public.external_artists
         where claimed_profile_id is null
           and lower(trim(display_name)) = g.name_key
      ) src
     where c.id = v_canonical;

    -- 모든 claim 을 canonical 로 재지정
    update public.claims
       set external_artist_id = v_canonical
     where external_artist_id in (
       select id
         from public.external_artists
        where claimed_profile_id is null
          and lower(trim(display_name)) = g.name_key
          and id <> v_canonical
     );

    -- 참조가 사라진 중복 행 삭제
    delete from public.external_artists
     where claimed_profile_id is null
       and lower(trim(display_name)) = g.name_key
       and id <> v_canonical;
  end loop;
end;
$a$;

-- == SECTION 2 == create_external_artist_and_claim — 업로드 시 기존 행 재사용(dedupe)
-- 20260626000000 SECTION 7 과 동일하되, external_artists INSERT 앞에
-- "같은 초대자(invited_by=auth.uid()) + (이메일|이름)" 기준 재사용 로직을
-- 추가했다. 시그니처/writer 가드/반환 형태는 그대로 유지.
create or replace function public.create_external_artist_and_claim(
  p_display_name      text,
  p_invite_email      text default null,
  p_work_id           uuid default null,
  p_project_id        uuid default null,
  p_claim_type        text default 'OWNS',
  p_website           text default null,
  p_instagram         text default null,
  p_visibility        text default 'public',
  p_period_status     text default null,
  p_subject_profile_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $e$
declare
  v_uid        uuid := auth.uid();
  v_subject    uuid;
  v_ext_id     uuid;
  v_email      text;
  v_ext_row    jsonb;
  v_claim_row  jsonb;
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

  -- dedupe: 같은 초대자가 이미 만든 동일 외부 작가가 있으면 재사용한다.
  -- 이메일이 있으면 이메일을, 없으면 (이름 + 이메일 없음) 을 키로 본다.
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
    -- 기존 행의 비어 있는 메타데이터만 보충(덮어쓰지 않음).
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
$e$;

grant execute on function public.create_external_artist_and_claim(text, text, uuid, uuid, text, text, text, text, text, uuid)
  to authenticated;

commit;
