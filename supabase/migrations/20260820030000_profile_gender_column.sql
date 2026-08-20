-- Signup v2 wireframe pass (2026-08-20) — add optional `gender` column
-- to `public.profiles` and extend `upsert_my_profile` so the wizard's
-- Step 3 payload can persist it.
--
-- Free-form `text` (not an enum) so the taxonomy can evolve without
-- another migration. The Signup v2 UI restricts writes to a closed
-- set { woman | man | non_binary | prefer_not_to_say } but downstream
-- consumers should treat the column as unrestricted string.
--
-- RLS: the existing owner-scoped UPDATE policy
-- (`profiles_update_rls.sql`) plus the SELECT policy
-- (`profiles_required_columns_triggers_rls.sql`) automatically cover
-- new columns, so nothing new is required here.
--
-- This file contains a single PL/pgSQL function definition, so the
-- release-workflow `SECTION` banners are not needed.

begin;

alter table public.profiles
  add column if not exists gender text;

comment on column public.profiles.gender is
  'Signup v2 (2026-08-20): optional self-declared gender. Free-form text so downstream taxonomy can expand; the UI presently restricts writes to woman | man | non_binary | prefer_not_to_say.';

-- Extend the RPC so Signup v2's `saveProfileUnified` payload can write
-- the new column. `gender` is nullable and safely clearable via the
-- `nullif(trim(...), '')` pattern shared with `age_band` / `full_name`.
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
      -- Signup v2 wireframe pass (2026-08-20) addition.
      gender = case when (p_base ? 'gender')
        then nullif(trim(p_base->>'gender'), '')
        else p.gender end,
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
