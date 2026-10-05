-- Uploader may set artist_id to the artist they chose.
--
-- `artworks.artist_id` is the owner. `created_by` is the account that
-- uploaded the file (gallery, curator, or their delegate). The previous
-- update policy required the new artist_id to stay auth.uid() unless a
-- claim already existed, so a delegate acting for a gallery could not
-- move the work onto the selected artist after attaching images.
--
-- Safe to re-run. Section 3 is one DO block (letters-only dollar tag).
-- If the SQL editor splits on semicolons, run section 3 by itself.

-- == SECTION 1 == artwork row
drop policy if exists artworks_update_created_by on public.artworks;
create policy artworks_update_created_by
  on public.artworks
  for update
  to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

-- == SECTION 2 == images after artist_id has moved
drop policy if exists artwork_images_insert_created_by on public.artwork_images;
create policy artwork_images_insert_created_by
  on public.artwork_images
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.artworks a
      where a.id = artwork_images.artwork_id
        and a.created_by = auth.uid()
    )
  );

drop policy if exists artwork_images_update_created_by on public.artwork_images;
create policy artwork_images_update_created_by
  on public.artwork_images
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.artworks a
      where a.id = artwork_images.artwork_id
        and a.created_by = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.artworks a
      where a.id = artwork_images.artwork_id
        and a.created_by = auth.uid()
    )
  );

-- == SECTION 3 == detail passport includes the claim's artist profile
-- so the title line can show that artist when artist_id was left on
-- the uploading account. Idempotent: skips if the key is already there.
-- One function. Letters-only dollar tag. Do not paste this section
-- together with other statements if the editor splits on semicolons;
-- this block is a single DO statement.

do $hdr$
declare
  v_sql text;
  v_old text := quote_literal('artist_profile_id') || ', c.artist_profile_id,';
  v_new text;
begin
  select pg_get_functiondef(p.oid)
    into v_sql
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'get_artwork_passport_for_viewer'
    and pg_get_function_identity_arguments(p.oid) = 'p_artwork_id uuid';

  if v_sql is null then
    raise exception 'get_artwork_passport_for_viewer(uuid) was not found';
  end if;

  if position(quote_literal('artist_profile') || ',' in v_sql) > 0 then
    return;
  end if;

  v_new := v_old || '
            ' || quote_literal('artist_profile') || ', (
              select jsonb_build_object(
                ' || quote_literal('id') || ', ap.id,
                ' || quote_literal('username') || ', ap.username,
                ' || quote_literal('display_name') || ', ap.display_name,
                ' || quote_literal('display_name_ko') || ', ap.display_name_ko,
                ' || quote_literal('display_name_en') || ', ap.display_name_en,
                ' || quote_literal('main_role') || ', ap.main_role,
                ' || quote_literal('roles') || ', ap.roles
              )
              from public.profiles ap
              where ap.id = c.artist_profile_id
            ),';

  if position(v_old in v_sql) = 0 then
    raise exception 'passport claim payload did not contain artist_profile_id';
  end if;

  v_sql := replace(v_sql, v_old, v_new);
  execute v_sql;
end
$hdr$;
