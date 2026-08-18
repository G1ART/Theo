-- QA 2026-08-17 (14) — 이중언어(KO/EN) RPC patch: `lookup_profile_by_username`
--
-- 배경
-- ----
-- 감사(13) 에서 client 는 `PrivateProfileCard` / `ProfilePublic` 를
-- `display_name_ko/en` + `bio_ko/en` 슬롯을 포함하도록 확장했지만,
-- `lookup_profile_by_username` 은 여전히 두 브랜치(public/private) 에서
-- legacy `display_name` / `bio` 만 반환했다. 이 패치로 두 브랜치 모두
-- KO/EN 슬롯을 additive 로 노출한다.
--
-- 원본 (20260626300000) 대비 변경 항목:
--   - profiles 컬럼 select 에 `display_name_ko`, `display_name_en`,
--     `bio_ko`, `bio_en` 4개 컬럼 추가.
--   - public jsonb payload 에 4개 key 추가.
--   - private jsonb payload 에 4개 key 추가.
--
-- 보안 posture 유지:
--   - SECURITY DEFINER, stable, search_path=public
--   - grant execute to authenticated + anon (원본과 동일)
--   - viewer_follow_status 계산 로직 그대로 유지 (v_status = 'none')
--
-- 반환 타입이 jsonb 라 signature 변경 없이 `create or replace` 만으로
-- 충분. dashboard 로 붙여넣을 때는 파일 전체를 highlight → Run.

begin;

create or replace function public.lookup_profile_by_username(p_username text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $a$
declare
  rec record;
  sp jsonb;
  v_uid uuid := auth.uid();
  v_status text := 'none';
begin
  select id, username, display_name, display_name_ko, display_name_en,
         main_role, avatar_url, is_public,
         bio, bio_ko, bio_en, location, website, roles, profile_details,
         cover_image_url, cover_image_position_y, artist_statement,
         artist_statement_hero_image_url, artist_statement_updated_at,
         education, exhibitions, awards, residencies, cv_pdf_path
    into rec
    from profiles
   where lower(username) = lower(trim(p_username))
   limit 1;

  if not found then
    return null;
  end if;

  if v_uid is not null and v_uid <> rec.id then
    select status into v_status
      from public.follows
     where follower_id = v_uid
       and following_id = rec.id
     limit 1;
    v_status := coalesce(v_status, 'none');
  end if;

  if rec.is_public = true then
    sp := null;
    if rec.profile_details is not null
       and jsonb_typeof(rec.profile_details) = 'object' then
      sp := rec.profile_details->'studio_portfolio';
    end if;
    return jsonb_build_object(
      'id', rec.id,
      'username', rec.username,
      'display_name', rec.display_name,
      'display_name_ko', rec.display_name_ko,
      'display_name_en', rec.display_name_en,
      'main_role', rec.main_role,
      'avatar_url', rec.avatar_url,
      'bio', rec.bio,
      'bio_ko', rec.bio_ko,
      'bio_en', rec.bio_en,
      'location', rec.location,
      'website', rec.website,
      'roles', rec.roles,
      'is_public', true,
      'studio_portfolio', case when sp is null or jsonb_typeof(sp) = 'null' then null else sp end,
      'cover_image_url', rec.cover_image_url,
      'cover_image_position_y', rec.cover_image_position_y,
      'artist_statement', rec.artist_statement,
      'artist_statement_hero_image_url', rec.artist_statement_hero_image_url,
      'artist_statement_updated_at', rec.artist_statement_updated_at,
      'education', coalesce(rec.education, '[]'::jsonb),
      'exhibitions_cv', coalesce(rec.exhibitions, '[]'::jsonb),
      'awards', coalesce(rec.awards, '[]'::jsonb),
      'residencies', coalesce(rec.residencies, '[]'::jsonb),
      'cv_pdf_path', rec.cv_pdf_path,
      'viewer_follow_status', v_status
    );
  else
    return jsonb_build_object(
      'id', rec.id,
      'username', rec.username,
      'display_name', rec.display_name,
      'display_name_ko', rec.display_name_ko,
      'display_name_en', rec.display_name_en,
      'main_role', rec.main_role,
      'avatar_url', rec.avatar_url,
      'roles', rec.roles,
      'bio', rec.bio,
      'bio_ko', rec.bio_ko,
      'bio_en', rec.bio_en,
      'is_public', false,
      'viewer_follow_status', v_status
    );
  end if;
end;
$a$;

grant execute on function public.lookup_profile_by_username(text) to authenticated;
grant execute on function public.lookup_profile_by_username(text) to anon;

commit;
