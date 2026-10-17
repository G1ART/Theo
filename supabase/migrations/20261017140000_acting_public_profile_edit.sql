-- Acting-as public profile edits.
--
-- The account owner keeps the existing own-profile RPCs.
-- A delegate may write the public profile only when the request names
-- that profile as the acting subject and an active, unexpired account
-- delegation includes the matching permission:
--   edit_profile_public_content  cover, avatar, bio, statement, CV
--   manage_artworks              artwork order and tabs (tabs already gated)
--   manage_exhibitions           exhibition order on the profile
-- Login, password, account deletion, and delegation admin are not here.
--
-- The operations preset is the studio-manager grant. It listed every
-- account permission except public-profile editing. This migration adds
-- that existing permission to active operations rows that do not have it.
--
-- Safe to re-run. Highlight each section and Run it on its own.
-- Dollar tags are letters only.

-- == SECTION 1 == has_acting_profile_perm
-- Highlight this section and Run by itself.

create or replace function public.has_acting_profile_perm(
  p_profile_id uuid,
  p_acting_profile_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $perm$
  select
    p_profile_id is not null
    and auth.uid() is not null
    and p_permission is not null
    and (
      auth.uid() = p_profile_id
      or (
        p_acting_profile_id is not null
        and p_acting_profile_id = p_profile_id
        and p_acting_profile_id is distinct from auth.uid()
        and exists (
          select 1
          from public.delegations d
          where d.delegator_profile_id = p_profile_id
            and d.delegate_profile_id = auth.uid()
            and d.scope_type = 'account'::public.delegation_scope_type
            and d.status = 'active'::public.delegation_status_type
            and (d.expires_at is null or d.expires_at > now())
            and p_permission = any (d.permissions)
        )
      )
    );
$perm$;

revoke all on function public.has_acting_profile_perm(uuid, uuid, text) from public, anon;
grant execute on function public.has_acting_profile_perm(uuid, uuid, text) to authenticated;

-- == SECTION 2 == save_acting_public_profile
-- Highlight this section and Run by itself.

create or replace function public.save_acting_public_profile(
  p_profile_id uuid,
  p_acting_profile_id uuid,
  p_base jsonb,
  p_details jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $saveprof$
declare
  v_exists uuid;
  v_details jsonb;
  v_key text;
  v_keys text[] := array[
    'career_stage', 'age_band', 'city', 'region', 'country',
    'themes', 'mediums', 'styles', 'keywords', 'price_band',
    'acquisition_channels', 'affiliation', 'program_focus'
  ];
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_acting_profile_perm(
    p_profile_id, p_acting_profile_id, 'edit_profile_public_content'
  ) then
    raise exception 'not_allowed';
  end if;

  v_exists := (
    select p.id
    from public.profiles p
    where p.id = p_profile_id
    for update
  );
  if v_exists is null then
    raise exception 'profile_missing';
  end if;

  update public.profiles
  set
    display_name = case
      when p_base ? 'display_name' then nullif(btrim(p_base->>'display_name'), '')
      else display_name
    end,
    display_name_ko = case
      when p_base ? 'display_name_ko' then nullif(btrim(p_base->>'display_name_ko'), '')
      else display_name_ko
    end,
    display_name_en = case
      when p_base ? 'display_name_en' then nullif(btrim(p_base->>'display_name_en'), '')
      else display_name_en
    end,
    bio = case
      when p_base ? 'bio' then nullif(btrim(p_base->>'bio'), '')
      else bio
    end,
    bio_ko = case
      when p_base ? 'bio_ko' then nullif(btrim(p_base->>'bio_ko'), '')
      else bio_ko
    end,
    bio_en = case
      when p_base ? 'bio_en' then nullif(btrim(p_base->>'bio_en'), '')
      else bio_en
    end,
    location = case
      when p_base ? 'location' then nullif(btrim(p_base->>'location'), '')
      else location
    end,
    website = case
      when p_base ? 'website' then nullif(btrim(p_base->>'website'), '')
      else website
    end,
    avatar_url = case
      when p_base ? 'avatar_url' then nullif(btrim(p_base->>'avatar_url'), '')
      else avatar_url
    end,
    cover_image_url = case
      when p_base ? 'cover_image_url' then nullif(btrim(p_base->>'cover_image_url'), '')
      else cover_image_url
    end,
    cover_image_position_y = case
      when p_base ? 'cover_image_position_y'
        and (p_base->>'cover_image_position_y') ~ '^[0-9]+(\.[0-9]+)?$'
        then least(100, greatest(0, (p_base->>'cover_image_position_y')::numeric))
      else cover_image_position_y
    end,
    artist_statement = case
      when p_base ? 'artist_statement' then nullif(btrim(p_base->>'artist_statement'), '')
      else artist_statement
    end,
    artist_statement_ko = case
      when p_base ? 'artist_statement_ko' then nullif(btrim(p_base->>'artist_statement_ko'), '')
      else artist_statement_ko
    end,
    artist_statement_en = case
      when p_base ? 'artist_statement_en' then nullif(btrim(p_base->>'artist_statement_en'), '')
      else artist_statement_en
    end,
    artist_statement_hero_image_url = case
      when p_base ? 'artist_statement_hero_image_url'
        then nullif(btrim(p_base->>'artist_statement_hero_image_url'), '')
      else artist_statement_hero_image_url
    end,
    username = case
      when p_base ? 'username' and btrim(p_base->>'username') <> ''
        then lower(btrim(p_base->>'username'))
      else username
    end,
    is_public = case
      when p_base ? 'is_public' then (p_base->>'is_public') in ('true', 't', '1')
      else is_public
    end,
    main_role = case
      when p_base ? 'main_role'
        and p_base->>'main_role' in ('artist', 'collector', 'curator', 'gallerist')
        then (p_base->>'main_role')::public.main_role
      else main_role
    end,
    roles = case
      when p_base ? 'roles' and jsonb_typeof(p_base->'roles') = 'array'
        then (
          select coalesce(array_agg(r.txt), '{}'::text[])
          from jsonb_array_elements_text(p_base->'roles') as r(txt)
        )
      else roles
    end,
    profile_updated_at = now(),
    updated_at = now()
  where id = p_profile_id;

  v_details := coalesce(
    (select p.profile_details from public.profiles p where p.id = p_profile_id),
    '{}'::jsonb
  );
  foreach v_key in array v_keys loop
    if p_details ? v_key then
      v_details := jsonb_set(v_details, array[v_key], p_details->v_key, true);
    end if;
  end loop;

  update public.profiles
  set profile_details = v_details,
      profile_updated_at = now(),
      updated_at = now()
  where id = p_profile_id;
end;
$saveprof$;

revoke all on function public.save_acting_public_profile(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_acting_public_profile(uuid, uuid, jsonb, jsonb) to authenticated;

-- == SECTION 3 == save_acting_profile_cv
-- Highlight this section and Run by itself.

create or replace function public.save_acting_profile_cv(
  p_profile_id uuid,
  p_acting_profile_id uuid,
  p_education jsonb default null,
  p_exhibitions jsonb default null,
  p_awards jsonb default null,
  p_residencies jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $savecv$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_acting_profile_perm(
    p_profile_id, p_acting_profile_id, 'edit_profile_public_content'
  ) then
    raise exception 'not_allowed';
  end if;

  update public.profiles
  set
    education = case when p_education is not null then p_education else education end,
    exhibitions = case when p_exhibitions is not null then p_exhibitions else exhibitions end,
    awards = case when p_awards is not null then p_awards else awards end,
    residencies = case when p_residencies is not null then p_residencies else residencies end,
    profile_updated_at = now(),
    updated_at = now()
  where id = p_profile_id;

  if not found then
    raise exception 'profile_missing';
  end if;
end;
$savecv$;

revoke all on function public.save_acting_profile_cv(uuid, uuid, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_acting_profile_cv(uuid, uuid, jsonb, jsonb, jsonb, jsonb) to authenticated;

-- == SECTION 4 == save_acting_cv_pdf_path
-- Highlight this section and Run by itself.

create or replace function public.save_acting_cv_pdf_path(
  p_profile_id uuid,
  p_acting_profile_id uuid,
  p_path text
)
returns void
language plpgsql
security definer
set search_path = public
as $savecvpdf$
declare
  v_path text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_acting_profile_perm(
    p_profile_id, p_acting_profile_id, 'edit_profile_public_content'
  ) then
    raise exception 'not_allowed';
  end if;

  v_path := nullif(btrim(coalesce(p_path, '')), '');
  if v_path is not null and split_part(v_path, '/', 1) is distinct from p_profile_id::text then
    raise exception 'invalid_path';
  end if;

  update public.profiles
  set cv_pdf_path = v_path,
      profile_updated_at = now(),
      updated_at = now()
  where id = p_profile_id;

  if not found then
    raise exception 'profile_missing';
  end if;
end;
$savecvpdf$;

revoke all on function public.save_acting_cv_pdf_path(uuid, uuid, text) from public, anon;
grant execute on function public.save_acting_cv_pdf_path(uuid, uuid, text) to authenticated;

-- == SECTION 5 == save_profile_artwork_order
-- Highlight this section and Run by itself.

create or replace function public.save_profile_artwork_order(
  p_profile_id uuid,
  p_acting_profile_id uuid,
  p_artwork_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $saveorder$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_acting_profile_perm(
    p_profile_id, p_acting_profile_id, 'manage_artworks'
  ) then
    raise exception 'not_allowed';
  end if;
  if p_artwork_ids is null or cardinality(p_artwork_ids) = 0 then
    return;
  end if;

  delete from public.profile_artwork_orders
  where profile_id = p_profile_id
    and artwork_id = any (p_artwork_ids);

  insert into public.profile_artwork_orders (profile_id, artwork_id, sort_order, updated_at)
  select p_profile_id, e.id, e.ord - 1, now()
  from unnest(p_artwork_ids) with ordinality as e(id, ord);

  update public.artworks a
  set artist_sort_order = e.ord - 1,
      artist_sort_updated_at = now()
  from unnest(p_artwork_ids) with ordinality as e(id, ord)
  where a.id = e.id
    and a.artist_id = p_profile_id;
end;
$saveorder$;

revoke all on function public.save_profile_artwork_order(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.save_profile_artwork_order(uuid, uuid, uuid[]) to authenticated;

-- == SECTION 6 == save_profile_exhibition_order
-- Highlight this section and Run by itself.

create or replace function public.save_profile_exhibition_order(
  p_profile_id uuid,
  p_acting_profile_id uuid,
  p_exhibition_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $saveexh$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_acting_profile_perm(
    p_profile_id, p_acting_profile_id, 'manage_exhibitions'
  ) then
    raise exception 'not_allowed';
  end if;
  if p_exhibition_ids is null or cardinality(p_exhibition_ids) = 0 then
    delete from public.profile_exhibition_orders
    where profile_id = p_profile_id;
    return;
  end if;

  delete from public.profile_exhibition_orders
  where profile_id = p_profile_id
    and exhibition_id = any (p_exhibition_ids);

  insert into public.profile_exhibition_orders (profile_id, exhibition_id, sort_order, updated_at)
  select p_profile_id, e.id, e.ord - 1, now()
  from unnest(p_exhibition_ids) with ordinality as e(id, ord);
end;
$saveexh$;

revoke all on function public.save_profile_exhibition_order(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.save_profile_exhibition_order(uuid, uuid, uuid[]) to authenticated;

-- == SECTION 7 == operations preset backfill
-- Highlight this section and Run by itself.
-- Adds the existing public-profile permission to active operations grants
-- that were seeded without it. Custom rows that are not the operations
-- preset are left alone.

update public.delegations
set permissions = permissions || array['edit_profile_public_content']::text[],
    updated_at = now()
where preset = 'operations'
  and scope_type = 'account'::public.delegation_scope_type
  and status = 'active'::public.delegation_status_type
  and not ('edit_profile_public_content' = any (permissions));
