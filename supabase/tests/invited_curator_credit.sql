-- Rolled-back check for the invited-curator credit (SQL).
--
-- Throwaway accounts on example.invalid, no mail provider involved, and the
-- block always ends by raising, so nothing it writes is kept. Gallery steps
-- run as the authenticated role, visitor reads as anon; sign-ups are written
-- the way the auth server writes them. Success ends with
-- "invited_curator_credit: ok"; any other message is the first failed check.

do $t$
declare
  v_tag text := substr(md5(random()::text), 1, 8);
  v_g uuid := gen_random_uuid();
  v_c1 uuid := gen_random_uuid();
  v_c2 uuid := gen_random_uuid();
  v_c3 uuid := gen_random_uuid();
  v_w uuid := gen_random_uuid();
  v_p1 uuid := gen_random_uuid();
  v_p2 uuid := gen_random_uuid();
  v_p3 uuid := gen_random_uuid();
  v_p4 uuid := gen_random_uuid();
  v_e1 text := 'curator-c1-' || v_tag || '@example.invalid';
  v_e2 text := 'curator-c2-' || v_tag || '@example.invalid';
  v_e3 text := 'curator-c3-' || v_tag || '@example.invalid';
  v_inv1 uuid;
  v_inv2 uuid;
  v_inv3 uuid;
  v_n int;
  v_text text;
  v_denied boolean;
begin
  insert into auth.users (id, email, email_confirmed_at)
  values (v_g, 'curator-g-' || v_tag || '@example.invalid', now());
  insert into public.profiles (id, username, display_name, main_role, roles, is_public)
  values (v_g, 'curator_g_' || v_tag, 'Curator Probe Gallery ' || v_tag, 'gallerist', array['gallerist'], true)
  on conflict (id) do update
    set username = excluded.username, display_name = excluded.display_name, is_public = true;
  insert into public.artworks (id, artist_id, created_by, title, visibility)
  values (v_w, v_g, v_g, 'Curator probe work ' || v_tag, 'public');
  -- Curator 3 already has a verified account before being invited.
  insert into auth.users (id, email, email_confirmed_at) values (v_c3, v_e3, now());

  -- The gallery, signed in, invites curators the way the exhibition form does.
  perform set_config('request.jwt.claim.sub', v_g::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_g, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  v_inv1 := public.get_or_create_external_artist(
    'Curator One ' || v_tag, v_e1, '기획자 하나 ' || v_tag, 'Curator One ' || v_tag, false, false);
  v_inv2 := public.get_or_create_external_artist(
    'Curator Two ' || v_tag, v_e2, null::text, null::text, false, false);
  v_inv3 := public.get_or_create_external_artist(
    'Curator Three ' || v_tag, v_e3, null::text, null::text, false, false);
  -- P1: the gallery is the host. P2: the host is only a name.
  insert into public.projects (id, project_type, title, status, curator_id, host_profile_id, external_curator_id)
  values (v_p1, 'exhibition', 'Curator probe show 1 ' || v_tag, 'live', v_g, v_g, v_inv1);
  insert into public.projects (id, project_type, title, status, curator_id, host_name, external_curator_id)
  values (v_p2, 'exhibition', 'Curator probe show 2 ' || v_tag, 'live', v_g, 'Probe Hall', v_inv2);
  insert into public.projects (id, project_type, title, status, curator_id, host_profile_id, external_curator_id)
  values (v_p4, 'exhibition', 'Curator probe show 4 ' || v_tag, 'live', v_g, v_g, v_inv3);

  -- Sign-ups: curator 1 verified at creation (e.g. Google), curator 2 not yet.
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  insert into auth.users (id, email, email_confirmed_at) values (v_c1, v_e1, now());
  insert into auth.users (id, email) values (v_c2, v_e2);

  if (select claimed_profile_id from public.external_artists where id = v_inv1) is distinct from v_c1 then
    raise exception 'FAIL verified curator did not take the invite';
  end if;
  if (select claimed_profile_id from public.external_artists where id = v_inv2) is not null then
    raise exception 'FAIL unverified curator took the invite';
  end if;
  if (select curator_id from public.projects where id = v_p1) is distinct from v_g
     or (select curator_id from public.projects where id = v_p2) is distinct from v_g then
    raise exception 'FAIL the creating account lost curator_id';
  end if;

  -- A visitor (anon) sees the curator account on P1 and the invite name on P2.
  perform set_config('role', 'anon', true);
  v_text := (
    select pr.display_name_en
      from public.projects p
      join public.external_artists ea on ea.id = p.external_curator_id
      join public.profiles pr on pr.id = ea.claimed_profile_id
     where p.id = v_p1
  );
  if v_text is distinct from 'Curator One ' || v_tag then
    raise exception 'FAIL visitor does not see the curator account on P1 (got %)', coalesce(v_text, '<none>');
  end if;
  v_text := (
    select ea.display_name
      from public.projects p
      join public.external_artists ea on ea.id = p.external_curator_id
     where p.id = v_p2 and ea.claimed_profile_id is null
  );
  if v_text is distinct from 'Curator Two ' || v_tag then
    raise exception 'FAIL visitor does not see the invite name on P2 (got %)', coalesce(v_text, '<none>');
  end if;
  -- The curator's profile lists P1 (the profile query: invites the account took).
  v_n := (
    select count(*)
      from public.projects p
     where p.external_curator_id in (
       select ea.id from public.external_artists ea where ea.claimed_profile_id = v_c1
     )
  );
  if v_n <> 1 then
    raise exception 'FAIL curator profile lists % exhibitions, expected 1', v_n;
  end if;
  begin
    v_text := (select invite_email from public.external_artists where id = v_inv1);
    raise exception 'FAIL visitor read invite_email';
  exception when insufficient_privilege then
    null;
  end;

  -- The gallery keeps editing both exhibitions.
  perform set_config('request.jwt.claim.sub', v_g::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_g, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  update public.projects set title = title || ' (edited)' where id in (v_p1, v_p2);
  get diagnostics v_n = row_count;
  if v_n <> 2 then
    raise exception 'FAIL gallery edited % of 2 exhibitions', v_n;
  end if;
  insert into public.exhibition_works (exhibition_id, work_id, added_by_profile_id) values (v_p2, v_w, v_g);
  insert into public.exhibition_media (exhibition_id, type, storage_path)
  values (v_p1, 'installation', 'probe/' || v_tag || '.jpg');
  update public.projects set external_curator_id = v_inv1 where id = v_p1;

  -- The curator column cannot point at an invite an account already took.
  v_denied := false;
  begin
    update public.projects set external_curator_id = v_inv1 where id = v_p2;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'FAIL gallery pointed P2 at a taken invite';
  end if;
  v_denied := false;
  begin
    insert into public.projects (id, project_type, title, status, curator_id, host_profile_id, external_curator_id)
    values (v_p3, 'exhibition', 'Curator probe show 3 ' || v_tag, 'live', v_g, v_g, v_inv1);
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'FAIL a new exhibition pointed at a taken invite';
  end if;
  update public.projects set external_curator_id = null where id = v_p2;
  update public.projects set external_curator_id = v_inv2 where id = v_p2;

  -- The curator gets the credit, not the gallery's edit rights.
  perform set_config('request.jwt.claim.sub', v_c1::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c1, 'role', 'authenticated')::text, true);
  update public.projects set title = 'taken over' where id = v_p1;
  get diagnostics v_n = row_count;
  if v_n <> 0 then
    raise exception 'FAIL the curator account could edit the exhibition';
  end if;

  -- Curator 3, already verified, saves their own profile: the invite is
  -- taken on that save (same trigger as artist invites).
  if (select claimed_profile_id from public.external_artists where id = v_inv3) is not null then
    raise exception 'FAIL curator 3 took the invite before any trigger point';
  end if;
  perform set_config('request.jwt.claim.sub', v_c3::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c3, 'role', 'authenticated')::text, true);
  update public.profiles set bio = coalesce(bio, '') where id = v_c3;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'FAIL curator 3 could not save their profile';
  end if;
  perform set_config('role', 'postgres', true);
  if (select claimed_profile_id from public.external_artists where id = v_inv3) is distinct from v_c3 then
    raise exception 'FAIL curator 3 did not take the invite on profile save';
  end if;

  -- Curator 2 opens the activation mail: P2 now shows that account.
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  update auth.users set email_confirmed_at = now() where id = v_c2;
  perform set_config('role', 'anon', true);
  if (select ea.claimed_profile_id
        from public.projects p
        join public.external_artists ea on ea.id = p.external_curator_id
       where p.id = v_p2) is distinct from v_c2 then
    raise exception 'FAIL P2 does not show curator 2 after confirmation';
  end if;
  perform set_config('role', 'postgres', true);

  raise exception 'invited_curator_credit: ok';
end
$t$;
