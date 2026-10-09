-- Profile tab kind and the public kind stored on a work.
-- The feed reads artworks.work_kind. Tab kind lives on
-- profile_details.studio_portfolio.custom_tabs[].kind.
-- A tab whose label is exactly 굿즈 is set to art_goods once here.
-- Nothing in the app watches tab names after this.
--
-- Safe to re-run. Highlight each section and Run it on its own.
-- Dollar tags are letters only.

-- == SECTION 1 == enum profile_content_kind
-- Highlight this section and Run by itself.

do $kind$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'profile_content_kind'
  ) then
    create type public.profile_content_kind as enum (
      'artwork',
      'print_edition',
      'art_goods',
      'collected'
    );
  end if;
end
$kind$;

-- == SECTION 2 == artworks.work_kind
-- Highlight this section and Run by itself.

alter table public.artworks
  add column if not exists work_kind public.profile_content_kind not null default 'artwork';

comment on column public.artworks.work_kind is
  'Public listing kind. The main feed and profile 전체 read this column. Goods and collected are not feed posts.';

-- == SECTION 3 == tabs named exactly 굿즈, once
-- Highlight this section and Run by itself.

update public.profiles p
set profile_details = jsonb_set(
  p.profile_details,
  '{studio_portfolio,custom_tabs}',
  (
    select coalesce(
      jsonb_agg(
        case
          when tab->>'label' = '굿즈'
            then jsonb_set(tab, '{kind}', '"art_goods"'::jsonb, true)
          else tab
        end
        order by ord
      ),
      '[]'::jsonb
    )
    from jsonb_array_elements(p.profile_details #> '{studio_portfolio,custom_tabs}')
      with ordinality as src(tab, ord)
  ),
  true
)
where jsonb_typeof(p.profile_details #> '{studio_portfolio,custom_tabs}') = 'array'
  and exists (
    select 1
    from jsonb_array_elements(p.profile_details #> '{studio_portfolio,custom_tabs}') tab
    where tab->>'label' = '굿즈'
      and coalesce(tab->>'kind', '') is distinct from 'art_goods'
  );

update public.artworks a
set work_kind = 'art_goods'
where a.work_kind is distinct from 'art_goods'
  and a.id in (
    select distinct elem::uuid
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
        when jsonb_typeof(tab->'artwork_ids') = 'array' then tab->'artwork_ids'
        else '[]'::jsonb
      end
    ) elem
    where tab->>'label' = '굿즈'
      and coalesce(tab->>'kind', 'art_goods') = 'art_goods'
      and elem ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

-- == SECTION 4 == file works into a tab that already exists
-- Highlight this section and Run by itself.
-- Does not create a tab. A collected tab does not overwrite the artist's public kind.

create or replace function public.file_artworks_into_existing_tab(
  p_profile_id uuid,
  p_tab_id uuid,
  p_artwork_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $filetab$
declare
  v_uid uuid := auth.uid();
  v_details jsonb;
  v_tabs jsonb;
  v_next jsonb := '[]'::jsonb;
  v_tab jsonb;
  v_found boolean := false;
  v_kind text := 'artwork';
  v_ids jsonb;
  v_aid uuid;
  v_cap integer := 300;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_profile_id is null then
    raise exception 'missing_tab';
  end if;
  if p_artwork_ids is null or cardinality(p_artwork_ids) = 0 then
    return;
  end if;

  if p_profile_id is distinct from v_uid
     and not public.is_active_account_delegate_writer(p_profile_id) then
    if exists (
      select 1
      from unnest(p_artwork_ids) as aid(id)
      where not exists (
        select 1
        from public.artworks a
        where a.id = aid.id
          and (a.created_by = v_uid or a.artist_id = v_uid)
      )
    ) then
      raise exception 'not_allowed';
    end if;
  end if;

  select p.profile_details
    into v_details
  from public.profiles p
  where p.id = p_profile_id
  for update;

  if v_details is null then
    raise exception 'profile_missing';
  end if;

  v_tabs := v_details #> '{studio_portfolio,custom_tabs}';
  if jsonb_typeof(v_tabs) is distinct from 'array' then
    raise exception 'tab_missing';
  end if;

  for v_tab in
    select value from jsonb_array_elements(v_tabs)
  loop
    v_ids := coalesce(v_tab->'artwork_ids', '[]'::jsonb);
    if jsonb_typeof(v_ids) is distinct from 'array' then
      v_ids := '[]'::jsonb;
    end if;
    v_ids := (
      select coalesce(jsonb_agg(to_jsonb(e.x)), '[]'::jsonb)
      from jsonb_array_elements_text(v_ids) as e(x)
      where not exists (
        select 1
        from unnest(p_artwork_ids) as u(id)
        where u.id::text = e.x
      )
    );
    if p_tab_id is not null and (v_tab->>'id') = p_tab_id::text then
      v_found := true;
      v_kind := coalesce(v_tab->>'kind', 'artwork');
      for v_aid in
        select u.id from unnest(p_artwork_ids) as u(id)
      loop
        if jsonb_array_length(v_ids) >= v_cap then
          exit;
        end if;
        v_ids := v_ids || to_jsonb(v_aid::text);
      end loop;
    end if;
    v_tab := jsonb_set(v_tab, '{artwork_ids}', coalesce(v_ids, '[]'::jsonb), true);
    v_next := v_next || jsonb_build_array(v_tab);
  end loop;

  if p_tab_id is not null and not v_found then
    raise exception 'tab_missing';
  end if;

  v_details := jsonb_set(v_details, '{studio_portfolio,custom_tabs}', v_next, true);

  update public.profiles
  set profile_details = v_details,
      updated_at = now()
  where id = p_profile_id;

  if p_tab_id is null then
    update public.artworks
    set work_kind = 'artwork'
    where id = any (p_artwork_ids);
  elsif v_kind is distinct from 'collected' then
    update public.artworks
    set work_kind = v_kind::public.profile_content_kind
    where id = any (p_artwork_ids);
  end if;
end;
$filetab$;

grant execute on function public.file_artworks_into_existing_tab(uuid, uuid, uuid[]) to authenticated;
