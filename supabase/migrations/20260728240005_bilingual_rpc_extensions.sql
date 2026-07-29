-- QA 2026-07-28 — RPC 확장: bilingual 인자 · 반환 확장 (Track B)
--
-- 이 마이그레이션은 PL/pgSQL 본문이 4개 이상이라 SECTION 배너를 사용한다
-- (release-workflow.mdc). SQL Editor 에서 섹션 단위로 highlight → Run.
--
-- 담당 변경
-- ----------
--   SECTION 1: upsert_my_profile — bilingual 컬럼 (display_name_ko/en,
--              bio_ko/en, artist_statement_ko/en) 을 p_base 에서 수용.
--              legacy 컬럼은 240004 트리거가 KO 우선 sync.
--   SECTION 2: get_or_create_external_artist — display_name_ko/en 을
--              accept. 새 행 insert 시 두 슬롯도 채우고, 재사용 행이
--              슬롯이 비어 있으면 backfill (never overwrite).
--   SECTION 3: create_external_artist_and_claim — 동일 파라미터를 receive
--              해서 helper 로 forward. RPC 시그니처는 keyword-default 라
--              옛 캐 알라 호출은 그대로 동작 (arg count 는 변하지만 옛
--              positional 호출자는 없음 — 클라이언트 코드가 모두 keyword).
--   SECTION 4: list_exhibition_participants — profile 참여자에도
--              display_name_ko/en 반환.
--   SECTION 5: handle_auth_user_created_link_external_artist — 온보딩 시
--              external row 의 KO/EN 슬롯을 profile 로 상속 (프로필 슬롯이
--              비어 있을 때만).
--
-- 원칙: additive · 옛 호출자를 부수지 않는다.

begin;

-- ────────────────────────────────────────────────────────────────────
-- == SECTION 1 == upsert_my_profile: KO/EN 슬롯 수용
-- ────────────────────────────────────────────────────────────────────
create or replace function public.upsert_my_profile(
  p_base jsonb,
  p_details jsonb,
  p_completeness int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $a$
declare
  v_uid uuid := auth.uid();
  v_row jsonb;
  v_username text;
  v_main_role text;
begin
  if v_uid is null then
    raise exception 'auth.uid() is null';
  end if;

  v_username := case
    when (p_base ? 'username') and nullif(trim(lower(p_base->>'username')), '') is not null
    then nullif(trim(lower(p_base->>'username')), '')
    else null
  end;

  v_main_role := nullif(trim(coalesce(p_base->>'main_role', '')), '');

  insert into public.profiles (id, is_public, roles, profile_completeness, profile_details, profile_updated_at, updated_at)
  values (v_uid, true, '{}'::text[], coalesce(p_completeness, 0), coalesce(p_details, '{}'::jsonb), now(), now())
  on conflict (id) do nothing;

  with updated as (
    update public.profiles p
    set
      display_name = case when (p_base ? 'display_name') then nullif(trim(p_base->>'display_name'), '') else p.display_name end,
      -- QA 2026-07-28 bilingual (240000). Setting a KO/EN slot fires the
      -- 240004 trigger which mirrors the winner into legacy display_name.
      -- Empty string collapses to NULL — matches nullif(trim(...), '')
      -- for the other columns.
      display_name_ko = case when (p_base ? 'display_name_ko') then nullif(trim(p_base->>'display_name_ko'), '') else p.display_name_ko end,
      display_name_en = case when (p_base ? 'display_name_en') then nullif(trim(p_base->>'display_name_en'), '') else p.display_name_en end,
      bio          = case when (p_base ? 'bio') then nullif(trim(p_base->>'bio'), '') else p.bio end,
      bio_ko       = case when (p_base ? 'bio_ko') then nullif(trim(p_base->>'bio_ko'), '') else p.bio_ko end,
      bio_en       = case when (p_base ? 'bio_en') then nullif(trim(p_base->>'bio_en'), '') else p.bio_en end,
      location     = case when (p_base ? 'location') then nullif(trim(p_base->>'location'), '') else p.location end,
      website      = case when (p_base ? 'website') then nullif(trim(p_base->>'website'), '') else p.website end,
      avatar_url   = case when (p_base ? 'avatar_url') then nullif(trim(p_base->>'avatar_url'), '') else p.avatar_url end,
      is_public    = case when (p_base ? 'is_public') then coalesce((p_base->>'is_public')::boolean, p.is_public) else p.is_public end,
      main_role    = case when v_main_role is not null then v_main_role::public.main_role else p.main_role end,
      roles        = case when (p_base ? 'roles') and jsonb_typeof(p_base->'roles') = 'array' then
                      (select coalesce(array_agg(x), p.roles) from jsonb_array_elements_text(p_base->'roles') as x)
                    else p.roles end,
      education    = case when (p_base ? 'education') then (p_base->'education') else p.education end,
      username     = coalesce(v_username, p.username),
      cover_image_url = case when (p_base ? 'cover_image_url')
        then nullif(trim(p_base->>'cover_image_url'), '')
        else p.cover_image_url end,
      cover_image_position_y = case when (p_base ? 'cover_image_position_y')
        then case
          when p_base->>'cover_image_position_y' is null then p.cover_image_position_y
          when (p_base->>'cover_image_position_y') ~ '^-?[0-9]+(\.[0-9]+)?$'
            then greatest(0::numeric, least(100::numeric, (p_base->>'cover_image_position_y')::numeric))
          else p.cover_image_position_y
        end
        else p.cover_image_position_y end,
      artist_statement = case when (p_base ? 'artist_statement')
        then nullif(trim(p_base->>'artist_statement'), '')
        else p.artist_statement end,
      artist_statement_ko = case when (p_base ? 'artist_statement_ko')
        then nullif(trim(p_base->>'artist_statement_ko'), '')
        else p.artist_statement_ko end,
      artist_statement_en = case when (p_base ? 'artist_statement_en')
        then nullif(trim(p_base->>'artist_statement_en'), '')
        else p.artist_statement_en end,
      artist_statement_hero_image_url = case when (p_base ? 'artist_statement_hero_image_url')
        then nullif(trim(p_base->>'artist_statement_hero_image_url'), '')
        else p.artist_statement_hero_image_url end,
      -- Stamp statement edited-at whenever any statement key was present
      -- in the patch (legacy or KO/EN) — matches user intent.
      artist_statement_updated_at = case
        when (p_base ? 'artist_statement')
          or (p_base ? 'artist_statement_ko')
          or (p_base ? 'artist_statement_en')
        then now()
        else p.artist_statement_updated_at end,
      profile_details = jsonb_strip_nulls(coalesce(p.profile_details, '{}'::jsonb) || coalesce(p_details, '{}'::jsonb)),
      profile_completeness = coalesce(p_completeness, p.profile_completeness),
      profile_updated_at = now(),
      updated_at = now()
    where p.id = v_uid
    returning to_jsonb(p.*) as j
  )
  select j into v_row from updated;

  if v_row is null then
    select to_jsonb(p.*) into v_row from public.profiles p where p.id = v_uid;
  end if;

  return coalesce(v_row, '{}'::jsonb);
end;
$a$;

grant execute on function public.upsert_my_profile(jsonb, jsonb, int) to authenticated;


-- ────────────────────────────────────────────────────────────────────
-- == SECTION 2 == get_or_create_external_artist: KO/EN 슬롯 수용
-- ────────────────────────────────────────────────────────────────────
--
-- 옛 시그니처 (display_name, invite_email) 는 override 시 arg count 가 달라져
-- 함수 오버로드가 만들어진다. 명시적으로 DROP 하지 않고 새 시그니처만 사용
-- (기존 caller 는 create_external_artist_and_claim 을 통해 helper 를 호출하고,
-- 그 caller 는 SECTION 3 에서 함께 업데이트되므로 오버로드가 남아도 사용
-- 경로에는 영향이 없다).

create or replace function public.get_or_create_external_artist(
  p_display_name   text,
  p_invite_email   text default null,
  p_display_name_ko text default null,
  p_display_name_en text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $b$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_id    uuid;
  v_name_ko text := nullif(trim(coalesce(p_display_name_ko, '')), '');
  v_name_en text := nullif(trim(coalesce(p_display_name_en, '')), '');
begin
  if v_uid is null then
    raise exception 'auth.uid() is null';
  end if;
  if p_display_name is null or length(trim(p_display_name)) < 2 then
    raise exception 'display_name must be at least 2 characters';
  end if;
  v_email := nullif(trim(p_invite_email), '');

  if v_email is not null then
    -- 이메일은 전역 신원: 초대자 무관하게 재사용.
    select id into v_id from public.external_artists
     where claimed_profile_id is null
       and lower(trim(invite_email)) = lower(v_email)
     order by created_at asc limit 1;
    if v_id is not null then
      -- Backfill KO/EN if the reused row has an empty slot. Never
      -- overwrite an existing slot.
      update public.external_artists
         set display_name_ko = coalesce(display_name_ko, v_name_ko),
             display_name_en = coalesce(display_name_en, v_name_en)
       where id = v_id
         and (
           (display_name_ko is null and v_name_ko is not null)
           or (display_name_en is null and v_name_en is not null)
         );
      return v_id;
    end if;
    -- 이메일 행이 아직 없으면, 같은 초대자의 무이메일 동명 행을 흡수(이메일 backfill).
    select id into v_id from public.external_artists
     where invited_by = v_uid and claimed_profile_id is null
       and nullif(trim(invite_email), '') is null
       and lower(trim(display_name)) = lower(trim(p_display_name))
     order by created_at asc limit 1;
    if v_id is not null then
      update public.external_artists
         set invite_email    = v_email,
             display_name_ko = coalesce(display_name_ko, v_name_ko),
             display_name_en = coalesce(display_name_en, v_name_en)
       where id = v_id;
      return v_id;
    end if;
  else
    select id into v_id from public.external_artists
     where invited_by = v_uid and claimed_profile_id is null
       and lower(trim(display_name)) = lower(trim(p_display_name))
       and nullif(trim(invite_email), '') is null
     order by created_at asc limit 1;
    if v_id is not null then
      update public.external_artists
         set display_name_ko = coalesce(display_name_ko, v_name_ko),
             display_name_en = coalesce(display_name_en, v_name_en)
       where id = v_id
         and (
           (display_name_ko is null and v_name_ko is not null)
           or (display_name_en is null and v_name_en is not null)
         );
      return v_id;
    end if;
  end if;

  begin
    insert into public.external_artists (
      display_name, invite_email, invited_by, status,
      display_name_ko, display_name_en
    )
    values (
      trim(p_display_name), v_email, v_uid, 'invited',
      v_name_ko, v_name_en
    )
    returning id into v_id;
  exception when unique_violation then
    if v_email is not null then
      select id into v_id from public.external_artists
       where claimed_profile_id is null
         and lower(trim(invite_email)) = lower(v_email)
       order by created_at asc limit 1;
    else
      select id into v_id from public.external_artists
       where invited_by = v_uid and claimed_profile_id is null
         and lower(trim(display_name)) = lower(trim(p_display_name))
         and nullif(trim(invite_email), '') is null
       order by created_at asc limit 1;
    end if;
    -- Race winner may have empty slots; backfill best-effort.
    if v_id is not null then
      update public.external_artists
         set display_name_ko = coalesce(display_name_ko, v_name_ko),
             display_name_en = coalesce(display_name_en, v_name_en)
       where id = v_id;
    end if;
  end;

  return v_id;
end;
$b$;

grant execute on function public.get_or_create_external_artist(text, text, text, text) to authenticated;


-- ────────────────────────────────────────────────────────────────────
-- == SECTION 3 == create_external_artist_and_claim: KO/EN forward
-- ────────────────────────────────────────────────────────────────────
--
-- 새 파라미터 p_display_name_ko / p_display_name_en 을 마지막에 추가한다.
-- 기존 positional 호출자가 있다면 arg count 차이로 실패한다 — 그러나 클라이언트
-- 코드는 supabase-js 로 keyword 방식(named object)만 호출하므로 안전.

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
  p_external_artist_id uuid default null,
  p_display_name_ko    text default null,
  p_display_name_en    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $c$
declare
  v_uid        uuid := auth.uid();
  v_subject    uuid;
  v_ext_id     uuid;
  v_email      text;
  v_ext_row    jsonb;
  v_claim_row  jsonb;
  v_check      uuid;
  v_name_ko    text := nullif(trim(coalesce(p_display_name_ko, '')), '');
  v_name_en    text := nullif(trim(coalesce(p_display_name_en, '')), '');
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
             invite_email = coalesce(nullif(trim(invite_email), ''), v_email),
             -- Backfill KO/EN best-effort (never overwrite existing).
             display_name_ko = coalesce(display_name_ko, v_name_ko),
             display_name_en = coalesce(display_name_en, v_name_en)
       where id = v_ext_id;
    end if;
  end if;

  if v_ext_id is null then
    v_ext_id := public.get_or_create_external_artist(
      trim(p_display_name),
      v_email,
      v_name_ko,
      v_name_en
    );

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
$c$;

grant execute on function public.create_external_artist_and_claim(
  text, text, uuid, uuid, text, text, text, text, text, uuid, uuid, text, text
) to authenticated;


-- ────────────────────────────────────────────────────────────────────
-- == SECTION 4 == list_exhibition_participants: profile KO/EN 반환
-- ────────────────────────────────────────────────────────────────────

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
as $d$
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
  -- 온보딩된 참여자 — 이제 KO/EN 슬롯을 함께 반환 (240000 이후).
  select
    'profile'::text                                          as kind,
    c.id                                                     as claim_id,
    pr.id                                                    as profile_id,
    null::uuid                                               as external_artist_id,
    pr.display_name                                          as display_name,
    pr.display_name_ko                                       as display_name_ko,
    pr.display_name_en                                       as display_name_en,
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
$d$;

grant execute on function public.list_exhibition_participants(uuid) to authenticated;


-- ────────────────────────────────────────────────────────────────────
-- == SECTION 5 == signup: 큐레이터가 남긴 KO/EN 이름을 신규 profile 로 상속
-- ────────────────────────────────────────────────────────────────────
--
-- external_artists 행이 KO/EN 슬롯을 가지고 있으면 새 profile 의 대응 슬롯이
-- null 인 경우에 한해 이관한다. 이미 사용자가 자기 이름을 직접 세팅해둔 경우
-- (예: 온보딩 UI 가 이 트리거보다 먼저 profile.display_name 을 채운 경우) 는
-- 덮어쓰지 않는다.

create or replace function public.handle_auth_user_created_link_external_artist()
returns trigger
language plpgsql
security definer
set search_path = public
as $e$
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
  end if;

  return new;
end;
$e$;

drop trigger if exists on_auth_user_created_link_external_artist on auth.users;
create trigger on_auth_user_created_link_external_artist
  after insert on auth.users
  for each row execute function public.handle_auth_user_created_link_external_artist();

commit;
