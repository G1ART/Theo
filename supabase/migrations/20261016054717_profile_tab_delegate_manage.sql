-- Public profile tabs live in profiles.profile_details.studio_portfolio.
-- update_my_profile_details writes only auth.uid(), and profiles_update_own
-- is the same check, so an account delegate could not create, rename,
-- reorder, or delete tabs on the profile they manage.
--
-- Allowed callers:
--   * the profile owner
--   * an active account-scope delegate whose permissions include
--     manage_artworks (operations / "all permissions", and content)
--     or edit_profile_public_content (content / profile management)
-- Revoked, declined, pending, expired (status or expires_at), project-scope,
-- and view-only delegations are refused. A cancelled delegation fails the
-- next call; nothing is cached in the function.
--
-- Artwork row delete during tab removal only deletes works that this
-- profile is the artist of and that are still listed on one of its custom
-- tabs. work_kind updates stay limited to that artist's works so feed
-- exclusion (goods / collected) still follows the stored kind.
--
-- Safe to re-run. Highlight each section and Run it on its own.
-- Dollar tags are letters only.

-- == SECTION 1 == can_manage_profile_tabs
-- Highlight this section and Run by itself.

create or replace function public.can_manage_profile_tabs(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $canmanage$
  select
    p_profile_id is not null
    and auth.uid() is not null
    and (
      auth.uid() = p_profile_id
      or exists (
        select 1
        from public.delegations d
        where d.delegator_profile_id = p_profile_id
          and d.delegate_profile_id = auth.uid()
          and d.scope_type = 'account'::public.delegation_scope_type
          and d.status = 'active'::public.delegation_status_type
          and (d.expires_at is null or d.expires_at > now())
          and (
            'manage_artworks' = any (d.permissions)
            or 'edit_profile_public_content' = any (d.permissions)
          )
      )
    );
$canmanage$;

revoke all on function public.can_manage_profile_tabs(uuid) from public, anon;
grant execute on function public.can_manage_profile_tabs(uuid) to authenticated;

-- == SECTION 2 == save_profile_studio_portfolio
-- Highlight this section and Run by itself.

create or replace function public.save_profile_studio_portfolio(
  p_profile_id uuid,
  p_portfolio jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $saveport$
declare
  v_details jsonb;
  v_order jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.can_manage_profile_tabs(p_profile_id) then
    raise exception 'not_allowed';
  end if;
  if p_portfolio is null or jsonb_typeof(p_portfolio) is distinct from 'object' then
    raise exception 'invalid_portfolio';
  end if;

  select p.profile_details
    into v_details
  from public.profiles p
  where p.id = p_profile_id
  for update;

  if not found then
    raise exception 'profile_missing';
  end if;

  if jsonb_typeof(p_portfolio -> 'tab_strip_order') = 'array' then
    select coalesce(jsonb_agg(to_jsonb(e.token) order by e.ord), '[]'::jsonb)
      into v_order
    from jsonb_array_elements_text(p_portfolio -> 'tab_strip_order')
      with ordinality as e(token, ord)
    where e.token in (
      'all', 'exhibitions', 'CREATED', 'OWNS', 'INVENTORY', 'CURATED'
    );
  end if;

  v_details := jsonb_set(
    coalesce(v_details, '{}'::jsonb),
    '{studio_portfolio}',
    p_portfolio,
    true
  );
  v_details := jsonb_set(v_details, '{tab_order}', coalesce(v_order, '[]'::jsonb), true);

  update public.profiles
  set profile_details = v_details,
      profile_updated_at = now(),
      updated_at = now()
  where id = p_profile_id;
end;
$saveport$;

revoke all on function public.save_profile_studio_portfolio(uuid, jsonb) from public, anon;
grant execute on function public.save_profile_studio_portfolio(uuid, jsonb) to authenticated;

-- == SECTION 3 == delete_profile_tab_artworks
-- Highlight this section and Run by itself.

create or replace function public.delete_profile_tab_artworks(
  p_profile_id uuid,
  p_artwork_ids uuid[]
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $deltab$
declare
  v_deleted uuid[];
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.can_manage_profile_tabs(p_profile_id) then
    raise exception 'not_allowed';
  end if;
  if p_artwork_ids is null or cardinality(p_artwork_ids) = 0 then
    return '{}'::uuid[];
  end if;

  with removed as (
    delete from public.artworks a
    where a.id = any (p_artwork_ids)
      and a.artist_id = p_profile_id
      and exists (
        select 1
        from public.profiles p
        cross join lateral jsonb_array_elements(
          case
            when jsonb_typeof(p.profile_details #> '{studio_portfolio,custom_tabs}') = 'array'
              then p.profile_details #> '{studio_portfolio,custom_tabs}'
            else '[]'::jsonb
          end
        ) tab
        cross join lateral jsonb_array_elements_text(
          case
            when jsonb_typeof(tab -> 'artwork_ids') = 'array' then tab -> 'artwork_ids'
            else '[]'::jsonb
          end
        ) listed(id)
        where p.id = p_profile_id
          and lower(listed.id) = a.id::text
      )
    returning a.id
  )
  select coalesce(array_agg(removed.id), '{}'::uuid[])
    into v_deleted
  from removed;

  return coalesce(v_deleted, '{}'::uuid[]);
end;
$deltab$;

revoke all on function public.delete_profile_tab_artworks(uuid, uuid[]) from public, anon;
grant execute on function public.delete_profile_tab_artworks(uuid, uuid[]) to authenticated;

-- == SECTION 4 == set_profile_tab_work_kinds
-- Highlight this section and Run by itself.

create or replace function public.set_profile_tab_work_kinds(
  p_profile_id uuid,
  p_artwork_ids uuid[],
  p_kind text
)
returns integer
language plpgsql
security definer
set search_path = public
as $setkind$
declare
  v_updated integer := 0;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.can_manage_profile_tabs(p_profile_id) then
    raise exception 'not_allowed';
  end if;
  if p_kind is null or p_kind not in ('artwork', 'print_edition', 'art_goods', 'collected') then
    raise exception 'invalid_kind';
  end if;
  if p_artwork_ids is null or cardinality(p_artwork_ids) = 0 then
    return 0;
  end if;

  update public.artworks
  set work_kind = p_kind::public.profile_content_kind
  where id = any (p_artwork_ids)
    and artist_id = p_profile_id;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$setkind$;

revoke all on function public.set_profile_tab_work_kinds(uuid, uuid[], text) from public, anon;
grant execute on function public.set_profile_tab_work_kinds(uuid, uuid[], text) to authenticated;
