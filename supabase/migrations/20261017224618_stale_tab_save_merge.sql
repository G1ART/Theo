-- 2026-10-17 — A tab settings screen opened earlier no longer drops the
-- works that reached a custom tab after it loaded.
--
-- save_profile_studio_portfolio replaced studio_portfolio with whatever
-- the screen sent. A screen opened before an upload filed a new work into
-- a custom tab, or before first publish moved it to the front, saved its
-- old artwork_ids and the new work left the tab. A tab made on another
-- device disappeared the same way. Owner and acting-as saves both use
-- this function.
--
-- The screen now also sends the custom tabs as it read them
-- (p_loaded_tabs). The saved tabs, labels, order and removals apply to
-- everything the screen knew; what it did not know keeps its place:
--   * an artwork id in a current tab that is in neither p_loaded_tabs nor
--     the new portfolio stays, right after the furthest earlier id that
--     survives (first when none does);
--   * a current tab in neither stays, after the screen's tabs.
-- A save without p_loaded_tabs keeps the old replace behaviour.
--
-- profile_artwork_orders and profile_exhibition_orders saves only rewrite
-- the rows they are given, so works and exhibitions the screen did not
-- know keep their rows; they are unchanged here.
--
-- Two plpgsql functions: in the SQL editor run one section at a time.
-- Dollar tags are letters only.

-- == SECTION 1 == merge the custom tabs a screen saves with the current ones

create or replace function public.studio_tabs_merge(
  p_current jsonb,
  p_next jsonb,
  p_loaded jsonb
) returns jsonb
language plpgsql
immutable
set search_path = public
as $merge$
declare
  v_current jsonb := case when jsonb_typeof(p_current) = 'array' then p_current else '[]'::jsonb end;
  v_next jsonb := case when jsonb_typeof(p_next) = 'array' then p_next else '[]'::jsonb end;
  v_loaded jsonb := case when jsonb_typeof(p_loaded) = 'array' then p_loaded else '[]'::jsonb end;
  v_known text[];
  v_known_tabs text[];
  v_out jsonb := '[]'::jsonb;
  v_tab jsonb;
  v_current_ids jsonb;
  v_ids text[];
  v_id text;
  v_pos integer;
  v_at integer;
begin
  v_known := array(
    select lower(e.x)
      from jsonb_array_elements(v_loaded || v_next) as t(tab)
     cross join lateral jsonb_array_elements_text(
       case when jsonb_typeof(t.tab->'artwork_ids') = 'array' then t.tab->'artwork_ids' else '[]'::jsonb end
     ) as e(x)
  );
  v_known_tabs := array(
    select lower(t.tab->>'id')
      from jsonb_array_elements(v_loaded || v_next) as t(tab)
     where t.tab->>'id' is not null
  );

  for v_tab in
    select t.tab from jsonb_array_elements(v_next) with ordinality as t(tab, ord) order by t.ord
  loop
    v_ids := array(
      select e.x
        from jsonb_array_elements_text(
          case when jsonb_typeof(v_tab->'artwork_ids') = 'array' then v_tab->'artwork_ids' else '[]'::jsonb end
        ) with ordinality as e(x, ord)
       order by e.ord
    );
    v_current_ids := (
      select t.tab->'artwork_ids'
        from jsonb_array_elements(v_current) as t(tab)
       where lower(t.tab->>'id') = lower(v_tab->>'id')
       limit 1
    );
    if jsonb_typeof(v_current_ids) = 'array' then
      v_pos := 0;
      for v_id in
        select e.x from jsonb_array_elements_text(v_current_ids) with ordinality as e(x, ord) order by e.ord
      loop
        if not (lower(v_id) = any(v_known)) then
          v_ids := v_ids[1:v_pos] || v_id || v_ids[v_pos + 1:];
          v_pos := v_pos + 1;
        else
          v_at := array_position(v_ids, v_id);
          if v_at is not null then
            v_pos := greatest(v_pos, v_at);
          end if;
        end if;
      end loop;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_set(v_tab, '{artwork_ids}', to_jsonb(v_ids[1:300]), true));
  end loop;

  v_out := v_out || coalesce((
    select jsonb_agg(t.tab order by t.ord)
      from jsonb_array_elements(v_current) with ordinality as t(tab, ord)
     where not (coalesce(lower(t.tab->>'id'), '') = any(v_known_tabs))
  ), '[]'::jsonb);

  return v_out;
end;
$merge$;

revoke all on function public.studio_tabs_merge(jsonb, jsonb, jsonb) from public, anon, authenticated;

-- == SECTION 2 == save_profile_studio_portfolio takes the tabs the screen read

drop function if exists public.save_profile_studio_portfolio(uuid, jsonb, uuid);

create function public.save_profile_studio_portfolio(
  p_profile_id uuid,
  p_portfolio jsonb,
  p_acting_profile_id uuid default null,
  p_loaded_tabs jsonb default null
) returns void
language plpgsql
security definer
set search_path = public
as $save$
declare
  v_details jsonb;
  v_portfolio jsonb := p_portfolio;
  v_order jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.can_manage_profile_tabs(p_profile_id, p_acting_profile_id) then
    raise exception 'not_allowed';
  end if;
  if p_portfolio is null or jsonb_typeof(p_portfolio) is distinct from 'object' then
    raise exception 'invalid_portfolio';
  end if;

  v_details := (
    select coalesce(p.profile_details, '{}'::jsonb)
      from public.profiles p
     where p.id = p_profile_id
       for update
  );
  if v_details is null then
    raise exception 'profile_missing';
  end if;

  if jsonb_typeof(p_loaded_tabs) = 'array' then
    v_portfolio := jsonb_set(
      v_portfolio,
      '{custom_tabs}',
      public.studio_tabs_merge(
        v_details #> '{studio_portfolio,custom_tabs}',
        v_portfolio->'custom_tabs',
        p_loaded_tabs
      ),
      true
    );
  end if;

  if jsonb_typeof(v_portfolio -> 'tab_strip_order') = 'array' then
    v_order := (
      select coalesce(jsonb_agg(to_jsonb(e.token) order by e.ord), '[]'::jsonb)
        from jsonb_array_elements_text(v_portfolio -> 'tab_strip_order')
          with ordinality as e(token, ord)
       where e.token in ('all', 'exhibitions', 'CREATED', 'OWNS', 'INVENTORY', 'CURATED')
    );
  end if;

  v_details := jsonb_set(v_details, '{studio_portfolio}', v_portfolio, true);
  v_details := jsonb_set(v_details, '{tab_order}', coalesce(v_order, '[]'::jsonb), true);

  update public.profiles
  set profile_details = v_details,
      profile_updated_at = now(),
      updated_at = now()
  where id = p_profile_id;
end;
$save$;

revoke all on function public.save_profile_studio_portfolio(uuid, jsonb, uuid, jsonb) from public, anon;
grant execute on function public.save_profile_studio_portfolio(uuid, jsonb, uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
