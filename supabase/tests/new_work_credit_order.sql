-- Rolled-back check for 20261017215517_new_work_credit_and_order_first.
--
-- Throwaway accounts only. Always ends by raising, so nothing it writes
-- is kept and no real account gets an alert. Run the whole file as one
-- query. Success ends with "new_work_credit_order: ok"; any other
-- message is the first failed check.

do $t$
declare
  v_tag text := substr(md5(random()::text), 1, 8);
  v_gallery uuid := gen_random_uuid();
  v_artist uuid := gen_random_uuid();
  v_curator uuid := gen_random_uuid();
  v_f1 uuid := gen_random_uuid();
  v_f2 uuid := gen_random_uuid();
  v_ext uuid := gen_random_uuid();
  v_ext2 uuid := gen_random_uuid();
  v_tab uuid := gen_random_uuid();
  v_tab2 uuid := gen_random_uuid();
  v_g1 uuid := gen_random_uuid();
  v_g2 uuid := gen_random_uuid();
  v_x1 uuid := gen_random_uuid();
  v_x2 uuid := gen_random_uuid();
  v_w1 uuid := gen_random_uuid();
  v_w2 uuid := gen_random_uuid();
  v_w3 uuid := gen_random_uuid();
  v_w4 uuid := gen_random_uuid();
  v_w5 uuid := gen_random_uuid();
  v_alert jsonb;
  v_digest jsonb;
  v_order text[];
  v_tab_ids jsonb;
begin
  insert into auth.users (id, email)
  select x.u, 'nw-credit-' || v_tag || '-' || x.i || '@example.invalid'
    from unnest(array[v_gallery, v_artist, v_curator, v_f1, v_f2]) with ordinality as x(u, i);
  insert into public.profiles (id, username, display_name)
  select x.u, 'nw_credit_' || v_tag || '_' || x.i, 'NW credit ' || v_tag || ' ' || x.i
    from unnest(array[v_gallery, v_artist, v_curator, v_f1, v_f2]) with ordinality as x(u, i)
  on conflict (id) do update
    set username = excluded.username,
        display_name = excluded.display_name;
  insert into public.external_artists (id, display_name, display_name_ko, display_name_en, invited_by)
  values (v_ext, 'NW 외부 ' || v_tag, 'NW 외부 ' || v_tag, 'NW Outside ' || v_tag, v_gallery),
         (v_ext2, 'NW 둘째 ' || v_tag, null, null, v_gallery);

  -- Works that were already public, then the manual orders and tabs.
  insert into public.artworks (id, artist_id, created_by, title, visibility)
  values (v_g1, v_gallery, v_gallery, 'NW credit g1', 'public'),
         (v_g2, v_gallery, v_gallery, 'NW credit g2', 'public'),
         (v_x1, v_artist, v_artist, 'NW credit x1', 'public'),
         (v_x2, v_artist, v_artist, 'NW credit x2', 'public');
  insert into public.profile_artwork_orders (profile_id, artwork_id, sort_order)
  values (v_gallery, v_g1, 0), (v_gallery, v_g2, 1);
  update public.artworks set artist_sort_order = 0 where id = v_x1;
  update public.artworks set artist_sort_order = 1 where id = v_x2;
  update public.profiles
     set profile_details = coalesce(profile_details, '{}'::jsonb) || jsonb_build_object(
           'studio_portfolio', jsonb_build_object(
             'version', 1,
             'custom_tabs', jsonb_build_array(
               jsonb_build_object('id', v_tab, 'label', 'A', 'public', true, 'kind', 'artwork',
                                  'artwork_ids', jsonb_build_array(v_g1::text, v_g2::text)),
               jsonb_build_object('id', v_tab2, 'label', 'B', 'public', true, 'kind', 'artwork',
                                  'artwork_ids', jsonb_build_array(v_g2::text))
             )
           )
         )
   where id = v_gallery;
  insert into public.follows (follower_id, following_id) values (v_f1, v_gallery), (v_f2, v_artist);

  -- 1. Single upload of an external artist's work by the gallery:
  --    insert as public, then the external claim, then the tab.
  perform set_config('request.jwt.claim.sub', v_gallery::text, true);
  insert into public.artworks (id, artist_id, created_by, title, visibility)
  values (v_w1, v_gallery, v_gallery, 'NW credit w1', 'public');
  insert into public.claims (subject_profile_id, claim_type, work_id, external_artist_id, visibility, status)
  values (v_gallery, 'INVENTORY', v_w1, v_ext, 'public', 'confirmed');
  perform public.file_artworks_into_existing_tab(v_gallery, v_tab, array[v_w1]);
  v_alert := (select n.payload from public.notifications n where n.user_id = v_f1 and n.type = 'new_work');
  if v_alert->'count' <> '1'::jsonb
     or v_alert->'listed_ids' <> jsonb_build_array(v_w1::text)
     or v_alert->'external_artist'->>'id' is distinct from v_ext::text then
    raise exception 'FAIL 1 external single upload %', v_alert;
  end if;
  v_order := array(select o.artwork_id::text from public.profile_artwork_orders o where o.profile_id = v_gallery order by o.sort_order);
  if v_order <> array[v_w1::text, v_g1::text, v_g2::text] then
    raise exception 'FAIL 1 gallery order %', v_order;
  end if;
  v_tab_ids := (select p.profile_details #> '{studio_portfolio,custom_tabs}' from public.profiles p where p.id = v_gallery);
  if v_tab_ids->0->'artwork_ids' <> jsonb_build_array(v_w1::text, v_g1::text, v_g2::text)
     or v_tab_ids->1->'artwork_ids' <> jsonb_build_array(v_g2::text) then
    raise exception 'FAIL 1 tabs %', v_tab_ids;
  end if;

  -- 2. Bulk: a second work by the same external artist, claimed as a
  --    draft and then published.
  insert into public.artworks (id, artist_id, created_by, title, visibility)
  values (v_w2, v_gallery, v_gallery, 'NW credit w2', 'draft');
  insert into public.claims (subject_profile_id, claim_type, work_id, external_artist_id, visibility, status)
  values (v_gallery, 'INVENTORY', v_w2, v_ext, 'public', 'confirmed');
  update public.artworks set visibility = 'public' where id = v_w2;
  v_alert := (select n.payload from public.notifications n where n.user_id = v_f1 and n.type = 'new_work');
  if v_alert->'count' <> '2'::jsonb
     or v_alert->'listed_ids' <> jsonb_build_array(v_w1::text, v_w2::text)
     or v_alert->'external_artist'->>'id' is distinct from v_ext::text then
    raise exception 'FAIL 2 same external artist %', v_alert;
  end if;

  -- 3. A work by a second external artist: no single name any more.
  insert into public.artworks (id, artist_id, created_by, title, visibility)
  values (v_w3, v_gallery, v_gallery, 'NW credit w3', 'draft');
  insert into public.claims (subject_profile_id, claim_type, work_id, external_artist_id, visibility, status)
  values (v_gallery, 'INVENTORY', v_w3, v_ext2, 'public', 'confirmed');
  update public.artworks set visibility = 'public' where id = v_w3;
  v_alert := (select n.payload from public.notifications n where n.user_id = v_f1 and n.type = 'new_work');
  v_digest := (
    select d.payload from public.digest_events d
     where d.user_id = v_f1 and d.event_type = 'new_work' and d.sent_at is null
  );
  if v_alert->'count' <> '3'::jsonb
     or jsonb_array_length(v_alert->'listed_ids') <> 3
     or v_alert->'external_artist' <> 'null'::jsonb then
    raise exception 'FAIL 3 two external artists %', v_alert;
  end if;
  if v_digest->'count' <> '3'::jsonb
     or v_digest->'listed_ids' <> v_alert->'listed_ids'
     or v_digest->'external_artist' <> 'null'::jsonb
     or v_digest->'artwork_ids' <> v_alert->'artwork_ids' then
    raise exception 'FAIL 3 digest %', v_digest;
  end if;
  v_order := array(select o.artwork_id::text from public.profile_artwork_orders o where o.profile_id = v_gallery order by o.sort_order);
  if v_order <> array[v_w3::text, v_w2::text, v_w1::text, v_g1::text, v_g2::text] then
    raise exception 'FAIL 3 gallery order %', v_order;
  end if;

  -- 4. A curator uploads an onboarded artist's work: inserted under the
  --    curator, then the claim moves it to the artist.
  perform set_config('request.jwt.claim.sub', v_curator::text, true);
  insert into public.artworks (id, artist_id, created_by, title, visibility)
  values (v_w4, v_curator, v_curator, 'NW credit w4', 'public');
  insert into public.claims (subject_profile_id, claim_type, work_id, artist_profile_id, visibility, status)
  values (v_curator, 'CURATED', v_w4, v_artist, 'public', 'confirmed');
  v_alert := (select n.payload from public.notifications n where n.user_id = v_f2 and n.type = 'new_work');
  if v_alert->'count' <> '1'::jsonb
     or v_alert->'listed_ids' <> '[]'::jsonb
     or v_alert->'external_artist' <> 'null'::jsonb then
    raise exception 'FAIL 4 onboarded artist alert %', v_alert;
  end if;
  v_order := array(select o.artwork_id::text from public.profile_artwork_orders o where o.profile_id = v_artist order by o.sort_order);
  if v_order <> array[v_w4::text] then
    raise exception 'FAIL 4 artist legacy order %', v_order;
  end if;
  if exists (select 1 from public.profile_artwork_orders o where o.profile_id = v_curator) then
    raise exception 'FAIL 4 curator without a manual order got one';
  end if;

  -- 5. A draft filed into a tab goes to the end, and to the front when
  --    it is published.
  perform set_config('request.jwt.claim.sub', v_gallery::text, true);
  insert into public.artworks (id, artist_id, created_by, title, visibility)
  values (v_w5, v_gallery, v_gallery, 'NW credit w5', 'draft');
  perform public.file_artworks_into_existing_tab(v_gallery, v_tab, array[v_w5]);
  v_tab_ids := (select p.profile_details #> '{studio_portfolio,custom_tabs}' from public.profiles p where p.id = v_gallery);
  if v_tab_ids->0->'artwork_ids' <> jsonb_build_array(v_w1::text, v_g1::text, v_g2::text, v_w5::text) then
    raise exception 'FAIL 5 draft filed %', v_tab_ids;
  end if;
  update public.artworks set visibility = 'public' where id = v_w5;
  v_tab_ids := (select p.profile_details #> '{studio_portfolio,custom_tabs}' from public.profiles p where p.id = v_gallery);
  if v_tab_ids->0->'artwork_ids' <> jsonb_build_array(v_w5::text, v_w1::text, v_g1::text, v_g2::text)
     or v_tab_ids->1->'artwork_ids' <> jsonb_build_array(v_g2::text) then
    raise exception 'FAIL 5 tabs after publish %', v_tab_ids;
  end if;
  v_alert := (select n.payload from public.notifications n where n.user_id = v_f1 and n.type = 'new_work');
  if v_alert->'count' <> '4'::jsonb
     or jsonb_array_length(v_alert->'listed_ids') <> 3
     or v_alert->'external_artist' <> 'null'::jsonb then
    raise exception 'FAIL 5 mixed alert %', v_alert;
  end if;

  -- 6. Private and public again moves nothing.
  v_order := array(select o.artwork_id::text from public.profile_artwork_orders o where o.profile_id = v_gallery order by o.sort_order);
  update public.artworks set visibility = 'private' where id = v_w1;
  update public.artworks set visibility = 'public' where id = v_w1;
  if array(select o.artwork_id::text from public.profile_artwork_orders o where o.profile_id = v_gallery order by o.sort_order) <> v_order
     or v_order <> array[v_w5::text, v_w3::text, v_w2::text, v_w1::text, v_g1::text, v_g2::text] then
    raise exception 'FAIL 6 republish moved the order %', v_order;
  end if;
  if (select p.profile_details #> '{studio_portfolio,custom_tabs}' from public.profiles p where p.id = v_gallery) <> v_tab_ids then
    raise exception 'FAIL 6 republish moved a tab';
  end if;

  raise exception 'new_work_credit_order: ok order=% tab=% alert=%', v_order, v_tab_ids->0->'artwork_ids', v_alert;
end;
$t$;
