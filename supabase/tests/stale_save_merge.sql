-- Rolled-back check: a screen opened before new works arrived saves its
-- old snapshot, and the new works keep their place.
--
-- Throwaway accounts only, no follows (so no alerts), and it always ends
-- by raising, so nothing it writes is kept. Steps run as the
-- authenticated role so RLS and grants apply. Success ends with
-- "stale_save_merge: ok"; any other message is the first failed check.

do $t$
declare
  v_tag text := substr(md5(random()::text), 1, 8);
  v_owner uuid := gen_random_uuid();
  v_delegate uuid := gen_random_uuid();
  v_gallery uuid := gen_random_uuid();
  v_t1 text := gen_random_uuid()::text;
  v_t2 text := gen_random_uuid()::text;
  v_t3 text := gen_random_uuid()::text;
  v_tg text := gen_random_uuid()::text;
  v_a1 uuid := gen_random_uuid();
  v_a2 uuid := gen_random_uuid();
  v_a3 uuid := gen_random_uuid();
  v_n1 uuid := gen_random_uuid();
  v_n2 uuid := gen_random_uuid();
  v_g1 uuid := gen_random_uuid();
  v_g2 uuid := gen_random_uuid();
  v_g3 uuid := gen_random_uuid();
  v_x1 uuid := gen_random_uuid();
  v_x2 uuid := gen_random_uuid();
  v_x3 uuid := gen_random_uuid();
  v_loaded jsonb;
  v_loaded_g jsonb;
  v_tabs jsonb;
  v_order text[];
  v_mine jsonb;
begin
  insert into auth.users (id, email)
  select x.u, 'nw-stale-' || v_tag || '-' || x.i || '@example.invalid'
    from unnest(array[v_owner, v_delegate, v_gallery]) with ordinality as x(u, i);
  insert into public.profiles (id, username, display_name)
  select x.u, 'nw_stale_' || v_tag || '_' || x.i, 'NW stale ' || v_tag || ' ' || x.i
    from unnest(array[v_owner, v_delegate, v_gallery]) with ordinality as x(u, i)
  on conflict (id) do update
    set username = excluded.username,
        display_name = excluded.display_name;
  insert into public.delegations (delegator_profile_id, delegate_profile_id, delegate_email, scope_type, permissions, status)
  values (v_owner, v_delegate, 'nw-stale-' || v_tag || '-2@example.invalid', 'account',
          array['view', 'manage_artworks', 'manage_exhibitions', 'edit_profile_public_content'], 'active');

  -- What the screens read: works, tabs, manual orders, exhibitions.
  insert into public.artworks (id, artist_id, created_by, title, visibility)
  values (v_a1, v_owner, v_owner, 'NW stale a1', 'public'),
         (v_a2, v_owner, v_owner, 'NW stale a2', 'public'),
         (v_a3, v_owner, v_owner, 'NW stale a3', 'public'),
         (v_g1, v_gallery, v_gallery, 'NW stale g1', 'public'),
         (v_g2, v_gallery, v_gallery, 'NW stale g2', 'public');
  update public.profiles
     set profile_details = coalesce(profile_details, '{}'::jsonb) || jsonb_build_object(
           'studio_portfolio', jsonb_build_object(
             'version', 1,
             'tab_strip_order', jsonb_build_array('all', 'c:' || v_t1, 'c:' || v_t2),
             'custom_tabs', jsonb_build_array(
               jsonb_build_object('id', v_t1, 'label', 'A', 'public', true, 'kind', 'artwork',
                                  'artwork_ids', jsonb_build_array(v_a1::text, v_a2::text)),
               jsonb_build_object('id', v_t2, 'label', 'B', 'public', true, 'kind', 'artwork',
                                  'artwork_ids', jsonb_build_array(v_a3::text))
             )
           )
         )
   where id = v_owner;
  update public.profiles
     set profile_details = coalesce(profile_details, '{}'::jsonb) || jsonb_build_object(
           'studio_portfolio', jsonb_build_object(
             'version', 1,
             'custom_tabs', jsonb_build_array(
               jsonb_build_object('id', v_tg, 'label', 'G', 'public', true, 'kind', 'artwork',
                                  'artwork_ids', jsonb_build_array(v_g1::text))
             )
           )
         )
   where id = v_gallery;
  insert into public.profile_artwork_orders (profile_id, artwork_id, sort_order)
  values (v_owner, v_a1, 0), (v_owner, v_a2, 1), (v_owner, v_a3, 2),
         (v_gallery, v_g1, 0), (v_gallery, v_g2, 1);
  insert into public.projects (id, title, curator_id)
  values (v_x1, 'NW stale x1', v_owner), (v_x2, 'NW stale x2', v_owner);
  insert into public.profile_exhibition_orders (profile_id, exhibition_id, sort_order)
  values (v_owner, v_x1, 0), (v_owner, v_x2, 1);

  v_loaded := (
    select coalesce(jsonb_agg(jsonb_build_object('id', t.tab->>'id', 'artwork_ids', t.tab->'artwork_ids') order by t.ord), '[]'::jsonb)
      from public.profiles p,
           jsonb_array_elements(p.profile_details #> '{studio_portfolio,custom_tabs}') with ordinality as t(tab, ord)
     where p.id = v_owner
  );
  v_loaded_g := (
    select coalesce(jsonb_agg(jsonb_build_object('id', t.tab->>'id', 'artwork_ids', t.tab->'artwork_ids') order by t.ord), '[]'::jsonb)
      from public.profiles p,
           jsonb_array_elements(p.profile_details #> '{studio_portfolio,custom_tabs}') with ordinality as t(tab, ord)
     where p.id = v_gallery
  );

  -- After the screens opened: new works reach tabs and orders, a tab is
  -- made on another device, a new exhibition appears.
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  insert into public.artworks (id, artist_id, created_by, title, visibility)
  values (v_n1, v_owner, v_owner, 'NW stale n1', 'draft');
  perform public.file_artworks_into_existing_tab(v_owner, v_t1::uuid, array[v_n1]);
  update public.artworks set visibility = 'public' where id = v_n1;
  insert into public.artworks (id, artist_id, created_by, title, visibility)
  values (v_n2, v_owner, v_owner, 'NW stale n2', 'public');
  perform public.file_artworks_into_existing_tab(v_owner, v_t2::uuid, array[v_n2]);
  update public.profiles
     set profile_details = jsonb_set(
           profile_details,
           '{studio_portfolio,custom_tabs}',
           (profile_details #> '{studio_portfolio,custom_tabs}') || jsonb_build_array(
             jsonb_build_object('id', v_t3, 'label', 'C', 'public', true, 'kind', 'artwork', 'artwork_ids', '[]'::jsonb)
           )
         )
   where id = v_owner;
  insert into public.projects (id, title, curator_id) values (v_x3, 'NW stale x3', v_owner);
  perform set_config('request.jwt.claim.sub', v_gallery::text, true);
  insert into public.artworks (id, artist_id, created_by, title, visibility)
  values (v_g3, v_gallery, v_gallery, 'NW stale g3', 'public');
  perform public.file_artworks_into_existing_tab(v_gallery, v_tg::uuid, array[v_g3]);

  v_tabs := (select p.profile_details #> '{studio_portfolio,custom_tabs}' from public.profiles p where p.id = v_owner);
  if v_tabs->0->'artwork_ids' <> jsonb_build_array(v_n1::text, v_a1::text, v_a2::text)
     or v_tabs->1->'artwork_ids' <> jsonb_build_array(v_n2::text, v_a3::text) then
    raise exception 'FAIL setup tabs %', v_tabs;
  end if;

  -- 1. Owner, stale tab screen: reorders tab A, saves the old snapshot.
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  v_mine := jsonb_build_object(
    'version', 1,
    'tab_strip_order', jsonb_build_array('all', 'c:' || v_t2, 'c:' || v_t1),
    'tab_labels', '{}'::jsonb,
    'tab_public', '{}'::jsonb,
    'custom_tabs', jsonb_build_array(
      jsonb_build_object('id', v_t1, 'label', 'A', 'public', true, 'kind', 'artwork',
                         'artwork_ids', jsonb_build_array(v_a2::text, v_a1::text)),
      jsonb_build_object('id', v_t2, 'label', 'B2', 'public', true, 'kind', 'artwork',
                         'artwork_ids', jsonb_build_array(v_a3::text))
    )
  );
  perform public.save_profile_studio_portfolio(v_owner, v_mine, null, v_loaded);
  perform set_config('role', 'postgres', true);
  v_tabs := (select p.profile_details #> '{studio_portfolio,custom_tabs}' from public.profiles p where p.id = v_owner);
  if jsonb_array_length(v_tabs) <> 3
     or v_tabs->0->'artwork_ids' <> jsonb_build_array(v_n1::text, v_a2::text, v_a1::text)
     or v_tabs->1->'artwork_ids' <> jsonb_build_array(v_n2::text, v_a3::text)
     or v_tabs->1->>'label' <> 'B2'
     or v_tabs->2->>'id' <> v_t3 then
    raise exception 'FAIL 1 owner stale tab save %', v_tabs;
  end if;

  -- 2. Delegate, stale tab screen: removes a1 from tab A, same snapshot.
  perform set_config('request.jwt.claim.sub', v_delegate::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_delegate, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  v_mine := jsonb_set(v_mine, '{custom_tabs,0,artwork_ids}', jsonb_build_array(v_a2::text));
  perform public.save_profile_studio_portfolio(v_owner, v_mine, v_owner, v_loaded);
  perform set_config('role', 'postgres', true);
  v_tabs := (select p.profile_details #> '{studio_portfolio,custom_tabs}' from public.profiles p where p.id = v_owner);
  if v_tabs->0->'artwork_ids' <> jsonb_build_array(v_n1::text, v_a2::text)
     or v_tabs->1->'artwork_ids' <> jsonb_build_array(v_n2::text, v_a3::text)
     or v_tabs->2->>'id' <> v_t3 then
    raise exception 'FAIL 2 delegate stale tab save %', v_tabs;
  end if;

  -- 3. Gallery, stale tab screen.
  perform set_config('request.jwt.claim.sub', v_gallery::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_gallery, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.save_profile_studio_portfolio(
    v_gallery,
    jsonb_build_object('version', 1, 'custom_tabs', jsonb_build_array(
      jsonb_build_object('id', v_tg, 'label', 'G', 'public', true, 'kind', 'artwork',
                         'artwork_ids', jsonb_build_array(v_g1::text))
    )),
    null,
    v_loaded_g
  );
  perform set_config('role', 'postgres', true);
  v_tabs := (select p.profile_details #> '{studio_portfolio,custom_tabs}' from public.profiles p where p.id = v_gallery);
  if v_tabs->0->'artwork_ids' <> jsonb_build_array(v_g3::text, v_g1::text) then
    raise exception 'FAIL 3 gallery stale tab save %', v_tabs;
  end if;

  -- 4. Owner, stale order screen through the client path (rows of the
  --    works it knew are deleted and rewritten 0..n-1).
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  delete from public.profile_artwork_orders
   where profile_id = v_owner and artwork_id = any(array[v_a3, v_a1, v_a2]);
  insert into public.profile_artwork_orders (profile_id, artwork_id, sort_order)
  values (v_owner, v_a3, 0), (v_owner, v_a1, 1), (v_owner, v_a2, 2);
  perform set_config('role', 'postgres', true);
  v_order := array(select o.artwork_id::text from public.profile_artwork_orders o where o.profile_id = v_owner order by o.sort_order);
  if v_order <> array[v_n2::text, v_n1::text, v_a3::text, v_a1::text, v_a2::text] then
    raise exception 'FAIL 4 owner stale order save %', v_order;
  end if;

  -- 5. Delegate, stale order screen through save_profile_artwork_order.
  perform set_config('request.jwt.claim.sub', v_delegate::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_delegate, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.save_profile_artwork_order(v_owner, v_owner, array[v_a2, v_a3, v_a1]);
  perform set_config('role', 'postgres', true);
  v_order := array(select o.artwork_id::text from public.profile_artwork_orders o where o.profile_id = v_owner order by o.sort_order);
  if v_order <> array[v_n2::text, v_n1::text, v_a2::text, v_a3::text, v_a1::text] then
    raise exception 'FAIL 5 delegate stale order save %', v_order;
  end if;

  -- 6. Gallery, stale order screen.
  perform set_config('request.jwt.claim.sub', v_gallery::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_gallery, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  delete from public.profile_artwork_orders
   where profile_id = v_gallery and artwork_id = any(array[v_g2, v_g1]);
  insert into public.profile_artwork_orders (profile_id, artwork_id, sort_order)
  values (v_gallery, v_g2, 0), (v_gallery, v_g1, 1);
  perform set_config('role', 'postgres', true);
  v_order := array(select o.artwork_id::text from public.profile_artwork_orders o where o.profile_id = v_gallery order by o.sort_order);
  if v_order <> array[v_g3::text, v_g2::text, v_g1::text] then
    raise exception 'FAIL 6 gallery stale order save %', v_order;
  end if;

  -- 7. Exhibition order: owner client path and delegate RPC with the old
  --    list. The new exhibition is neither dropped nor given a row.
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  delete from public.profile_exhibition_orders
   where profile_id = v_owner and exhibition_id = any(array[v_x2, v_x1]);
  insert into public.profile_exhibition_orders (profile_id, exhibition_id, sort_order)
  values (v_owner, v_x2, 0), (v_owner, v_x1, 1);
  perform set_config('request.jwt.claim.sub', v_delegate::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_delegate, 'role', 'authenticated')::text, true);
  perform public.save_profile_exhibition_order(v_owner, v_owner, array[v_x1, v_x2]);
  perform set_config('role', 'postgres', true);
  v_order := array(select o.exhibition_id::text from public.profile_exhibition_orders o where o.profile_id = v_owner order by o.sort_order);
  if v_order <> array[v_x1::text, v_x2::text]
     or not exists (select 1 from public.projects where id = v_x3) then
    raise exception 'FAIL 7 exhibition order %', v_order;
  end if;

  -- 8. Without the loaded tabs the old replace still applies, which is
  --    how a stale screen used to drop new works.
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.save_profile_studio_portfolio(v_owner, v_mine, null);
  perform set_config('role', 'postgres', true);
  v_tabs := (select p.profile_details #> '{studio_portfolio,custom_tabs}' from public.profiles p where p.id = v_owner);
  if v_tabs->0->'artwork_ids' <> jsonb_build_array(v_a2::text) or jsonb_array_length(v_tabs) <> 2 then
    raise exception 'FAIL 8 replace without loaded tabs %', v_tabs;
  end if;

  raise exception 'stale_save_merge: ok';
end;
$t$;
