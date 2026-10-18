-- Rolled-back check for 20261017235907_invite_signup_merge.
--
-- Throwaway accounts on example.invalid, no mail provider involved, and the
-- block always ends by raising, so nothing it writes is kept. Steps that
-- the app runs as a signed-in gallery use the authenticated role; sign-ups
-- are written the way the auth server writes them (row first, confirmation
-- later). Success ends with "invite_signup_merge: ok"; any other message
-- is the first failed check.

do $t$
declare
  v_tag text := substr(md5(random()::text), 1, 8);
  v_g uuid := gen_random_uuid();
  v_u1 uuid := gen_random_uuid();
  v_u2 uuid := gen_random_uuid();
  v_u3 uuid := gen_random_uuid();
  v_u5 uuid := gen_random_uuid();
  v_u6 uuid := gen_random_uuid();
  v_u7 uuid := gen_random_uuid();
  v_w1 uuid := gen_random_uuid();
  v_w3 uuid := gen_random_uuid();
  v_w5 uuid := gen_random_uuid();
  v_w6 uuid := gen_random_uuid();
  v_w7 uuid := gen_random_uuid();
  v_p uuid := gen_random_uuid();
  v_e1 text := 'Merge-A1-' || v_tag || '@Example.invalid';
  v_e2 text := 'merge-a2-' || v_tag || '@example.invalid';
  v_e3 text := 'merge-a3-' || v_tag || '@example.invalid';
  v_e5 text := 'merge-a5-' || v_tag || '@example.invalid';
  v_e6 text := 'merge-a6-' || v_tag || '@example.invalid';
  v_e7 text := 'merge-a7-' || v_tag || '@example.invalid';
  v_r jsonb;
  v_ext2 uuid;
  v_ext3 uuid;
  v_ext3b uuid;
  v_ext5 uuid;
  v_ext7 uuid;
  v_ext7b uuid;
  v_claim2 uuid;
  v_n int;
begin
  insert into auth.users (id, email, email_confirmed_at)
  values (v_g, 'merge-g-' || v_tag || '@example.invalid', now());
  insert into public.profiles (id, username, display_name, main_role, roles)
  values (v_g, 'merge_g_' || v_tag, 'Merge Gallery ' || v_tag, 'gallerist', array['gallerist'])
  on conflict (id) do update set username = excluded.username, display_name = excluded.display_name;
  insert into public.artworks (id, artist_id, created_by, title, visibility) values
    (v_w1, v_g, v_g, 'Merge W1 ' || v_tag, 'public'),
    (v_w3, v_g, v_g, 'Merge W3 ' || v_tag, 'public'),
    (v_w5, v_g, v_g, 'Merge W5 ' || v_tag, 'public'),
    (v_w6, v_g, v_g, 'Merge W6 ' || v_tag, 'public'),
    (v_w7, v_g, v_g, 'Merge W7 ' || v_tag, 'public');
  insert into public.projects (id, project_type, title, status, curator_id)
  values (v_p, 'exhibition', 'Merge show ' || v_tag, 'live', v_g);

  -- The gallery, signed in.
  perform set_config('request.jwt.claim.sub', v_g::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_g, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  -- 1) Upload with the artist's email (typed in mixed case), work in a show.
  perform public.create_external_artist_and_claim(
    p_display_name => 'Merge A1 ' || v_tag, p_invite_email => v_e1, p_work_id => v_w1,
    p_claim_type => 'INVENTORY', p_display_name_ko => '머지 작가1', p_display_name_en => 'Merge Artist One');
  insert into public.exhibition_works (exhibition_id, work_id, added_by_profile_id) values (v_p, v_w1, v_g);

  -- 2) Exhibition participant: the name saves on blur, the email on the next save.
  v_r := public.create_external_artist_and_claim(
    p_display_name => 'Merge A2 ' || v_tag, p_project_id => v_p, p_claim_type => 'CURATED',
    p_period_status => 'current');
  v_ext2 := (v_r -> 'external_artist' ->> 'id')::uuid;
  v_claim2 := (v_r -> 'claim' ->> 'id')::uuid;
  v_r := public.create_external_artist_and_claim(
    p_display_name => 'Merge A2 ' || v_tag, p_invite_email => v_e2, p_project_id => v_p,
    p_claim_type => 'CURATED', p_period_status => 'current', p_external_artist_id => v_ext2);
  if (v_r -> 'claim' ->> 'id')::uuid is distinct from v_claim2 then
    raise exception 'FAIL participant re-save did not return the same claim';
  end if;

  -- 3) Artwork edit: a name-only artist gets an email later (the edit screen
  --    resolves the artist by name and email, then points its claim there).
  v_r := public.create_external_artist_and_claim(
    p_display_name => 'Merge A3 ' || v_tag, p_work_id => v_w3, p_claim_type => 'INVENTORY');
  v_ext3 := (v_r -> 'external_artist' ->> 'id')::uuid;
  v_ext3b := public.get_or_create_external_artist(
    'Merge A3 ' || v_tag, v_e3, null::text, null::text, false, false);
  if v_ext3b is distinct from v_ext3 then
    raise exception 'FAIL edit did not reuse the name-only artist';
  end if;
  update public.claims set external_artist_id = v_ext3b
   where work_id = v_w3 and external_artist_id = v_ext3 and subject_profile_id = v_g;

  -- 4) Upload for an artist whose address is signed up with but never confirmed.
  v_r := public.create_external_artist_and_claim(
    p_display_name => 'Merge A5 ' || v_tag, p_invite_email => v_e5, p_work_id => v_w5,
    p_claim_type => 'INVENTORY');
  v_ext5 := (v_r -> 'external_artist' ->> 'id')::uuid;

  -- 5) Upload for an artist who signs in with Google (verified at creation).
  perform public.create_external_artist_and_claim(
    p_display_name => 'Merge A6 ' || v_tag, p_invite_email => v_e6, p_work_id => v_w6,
    p_claim_type => 'INVENTORY');

  -- 6) Participant saved by name, then given an email another open invite
  --    already holds: the participant becomes that invite, once.
  v_r := public.create_external_artist_and_claim(
    p_display_name => 'Merge A7 ' || v_tag, p_invite_email => v_e7, p_work_id => v_w7,
    p_claim_type => 'INVENTORY');
  v_ext7 := (v_r -> 'external_artist' ->> 'id')::uuid;
  v_r := public.create_external_artist_and_claim(
    p_display_name => 'Merge A7 typed ' || v_tag, p_project_id => v_p, p_claim_type => 'CURATED',
    p_period_status => 'current');
  v_ext7b := (v_r -> 'external_artist' ->> 'id')::uuid;
  v_r := public.create_external_artist_and_claim(
    p_display_name => 'Merge A7 typed ' || v_tag, p_invite_email => v_e7, p_project_id => v_p,
    p_claim_type => 'CURATED', p_period_status => 'current', p_external_artist_id => v_ext7b);
  if (v_r -> 'external_artist' ->> 'id')::uuid is distinct from v_ext7 then
    raise exception 'FAIL participant did not move to the invite that holds the email';
  end if;
  v_n := (select count(*) from public.claims
           where project_id = v_p and work_id is null and claim_type = 'CURATED'
             and external_artist_id in (v_ext7, v_ext7b));
  if v_n <> 1 then
    raise exception 'FAIL participant A7 has % CURATED rows, expected 1', v_n;
  end if;

  -- Sign-ups, written the way the auth server writes them.
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  if (select lower(invite_email) from public.external_artists where id = v_ext2) is distinct from v_e2 then
    raise exception 'FAIL participant email was not stored on the second save';
  end if;

  insert into auth.users (id, email) values
    (v_u1, lower(v_e1)), (v_u2, v_e2), (v_u3, v_e3), (v_u5, v_e5), (v_u7, v_e7);
  insert into auth.users (id, email, email_confirmed_at) values (v_u6, v_e6, now());

  if (select claimed_profile_id from public.external_artists where id = v_ext5) is not null then
    raise exception 'FAIL an unconfirmed sign-up claimed the invite';
  end if;
  if (select artist_id from public.artworks where id = v_w5) is distinct from v_g then
    raise exception 'FAIL an unconfirmed sign-up took the work';
  end if;
  if (select artist_id from public.artworks where id = v_w6) is distinct from v_u6 then
    raise exception 'FAIL a sign-up verified at creation did not get the work';
  end if;

  -- Opening the activation mail confirms the address; then the profile is saved.
  update auth.users set email_confirmed_at = now() where id in (v_u1, v_u2, v_u3, v_u7);
  update public.profiles set display_name = coalesce(display_name, 'Profile')
   where id in (v_u1, v_u2, v_u3, v_u7);

  if (select artist_id from public.artworks where id = v_w1) is distinct from v_u1 then
    raise exception 'FAIL upload work did not move to the new account';
  end if;
  if exists (select 1 from public.claims where work_id = v_w1 and external_artist_id is not null) then
    raise exception 'FAIL upload claim still points at the invite';
  end if;
  if not exists (select 1 from public.claims where work_id = v_w1 and claim_type = 'INVENTORY'
                  and subject_profile_id = v_g and artist_profile_id = v_u1) then
    raise exception 'FAIL gallery claim does not credit the new account';
  end if;
  if not exists (select 1 from public.claims where work_id = v_w1 and claim_type = 'CREATED'
                  and subject_profile_id = v_u1 and status = 'confirmed') then
    raise exception 'FAIL no CREATED claim for the new account';
  end if;
  if (select display_name_ko from public.profiles where id = v_u1) is distinct from '머지 작가1'
     or (select display_name_en from public.profiles where id = v_u1) is distinct from 'Merge Artist One' then
    raise exception 'FAIL KO/EN names were not carried to the profile';
  end if;
  if not exists (select 1 from public.exhibition_works ew join public.artworks a on a.id = ew.work_id
                  where ew.exhibition_id = v_p and a.artist_id = v_u1) then
    raise exception 'FAIL the exhibited work lost its exhibition';
  end if;
  if not exists (select 1 from public.claims where project_id = v_p and claim_type = 'CURATED'
                  and work_id is null and artist_profile_id = v_u2) then
    raise exception 'FAIL exhibition participant credit did not move to the new account';
  end if;
  if (select artist_id from public.artworks where id = v_w3) is distinct from v_u3 then
    raise exception 'FAIL edit-path work did not move to the new account';
  end if;
  if not exists (select 1 from public.claims where project_id = v_p and claim_type = 'CURATED'
                  and work_id is null and artist_profile_id = v_u7)
     or (select artist_id from public.artworks where id = v_w7) is distinct from v_u7 then
    raise exception 'FAIL artist A7 did not get both the work and the participant credit';
  end if;

  update auth.users set email_confirmed_at = now() where id = v_u5;
  if (select artist_id from public.artworks where id = v_w5) is distinct from v_u5 then
    raise exception 'FAIL confirming later did not move the work';
  end if;

  raise exception 'invite_signup_merge: ok';
end
$t$;
