-- Signup v2 Phase 1 (2026-08-19) — extend `upsert_my_profile` to accept
-- the columns that Phase 0 (`20260820020000_signup_v2_profile_columns.sql`)
-- added to `public.profiles`:
--
--   * full_name             — Step 3 "이름" 슬롯.
--   * age_band              — 지금까지 `profile_details` jsonb blob 에
--                              들어가던 값을 물리 컬럼으로 정식 승격.
--   * tos_accepted_at       — 최초 계정 생성 시 stamp 하는 passive consent.
--   * profile_completed_at  — Step 3 완료 시 stamp; Phase 4 banner SSOT.
--
-- 편차 사유 (spec §11 대비): 부모 태스크의 HANDOFF 초안에는 "Supabase SQL:
-- 없음 (Phase 0 스키마 재사용)" 이라고 적혀 있었으나, Phase 0 은 컬럼만
-- 추가했고 RPC 를 확장하지 않았다. 클라이언트에는 `/rest/v1/profiles` 직접
-- 쓰기를 차단하는 `createGuardedFetch` guard (src/lib/supabase/client.ts) 가
-- 있으므로, 이 컬럼들을 저장하려면 RPC 를 반드시 확장해야 한다. 이 마이그
-- 레이션이 그 배관 gap 을 메운다.
--
-- 원칙:
--   * additive — 기존 base key 는 그대로. 옛 caller (settings, onboarding,
--     identity finish, artist statement 편집기) 는 이 파일 이후에도 시그
-- 니처가 동일하므로 재컴파일 불필요.
--   * `tos_accepted_at` / `profile_completed_at` 은 이미 값이 있으면 덮어
--     쓰지 않는다 (`coalesce(p.tos_accepted_at, now())` — first-write wins).
--   * `age_band` 는 `nullif(trim(...), '')` 으로 clear 가능.
--
-- 이 마이그레이션은 PL/pgSQL 함수 정의 1개만 포함하므로 릴리즈 워크플로
-- 규칙에 따른 SECTION 배너는 필요 없다.

begin;

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
      artist_statement_updated_at = case
        when (p_base ? 'artist_statement')
          or (p_base ? 'artist_statement_ko')
          or (p_base ? 'artist_statement_en')
        then now()
        else p.artist_statement_updated_at end,
      -- Signup v2 (2026-08-19) additions.
      full_name = case when (p_base ? 'full_name')
        then nullif(trim(p_base->>'full_name'), '')
        else p.full_name end,
      age_band = case when (p_base ? 'age_band')
        then nullif(trim(p_base->>'age_band'), '')
        else p.age_band end,
      -- ToS consent is first-write-wins: once stamped, we never bump the
      -- timestamp. Passing `tos_accepted_at: true` in p_base stamps
      -- `now()` if the column is currently NULL, no-op otherwise.
      tos_accepted_at = case
        when (p_base ? 'tos_accepted_at')
          and (p_base->>'tos_accepted_at') in ('true', 'now')
        then coalesce(p.tos_accepted_at, now())
        else p.tos_accepted_at end,
      -- profile_completed_at is idempotent: pass `true` to stamp `now()`
      -- when NULL, no-op if already stamped. Wizard "Complete profile"
      -- resume flow reuses the same stamp semantics.
      profile_completed_at = case
        when (p_base ? 'profile_completed_at')
          and (p_base->>'profile_completed_at') in ('true', 'now')
        then coalesce(p.profile_completed_at, now())
        else p.profile_completed_at end,
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

commit;
