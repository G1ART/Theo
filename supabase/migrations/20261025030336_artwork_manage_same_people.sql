-- Edit and delete use one rule: the artist (artist_id), the uploader
-- (created_by), or a delegate of either account who can manage artworks.
-- A relationship claim is not that permission.
-- The public-image trigger is unchanged: deleting a public work still
-- cascades its images, and removing the last image of a public work
-- is still rejected.
--
-- Safe to re-run. One function. If the SQL editor splits on semicolons,
-- highlight each section and run it on its own.
-- Dollar tag is letters only.

-- == SECTION 1 == shared write predicate
create or replace function public.artwork_manage_allowed(
  p_artist_id uuid,
  p_created_by uuid
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $manage$
  select auth.uid() is not null
    and (
      auth.uid() = p_artist_id
      or auth.uid() = p_created_by
      or public.has_active_account_delegate_perm(p_artist_id, 'manage_artworks')
      or (
        p_created_by is not null
        and public.has_active_account_delegate_perm(p_created_by, 'manage_artworks')
      )
      or public.is_active_project_delegate_works_writer(p_artist_id)
      or (
        p_created_by is not null
        and public.is_active_project_delegate_works_writer(p_created_by)
      )
    );
$manage$;

revoke all on function public.artwork_manage_allowed(uuid, uuid) from public, anon;
grant execute on function public.artwork_manage_allowed(uuid, uuid) to authenticated;

-- == SECTION 2 == artwork row policies
drop policy if exists "Allow owner update artwork" on public.artworks;
create policy "Allow owner update artwork"
  on public.artworks
  for update
  to authenticated
  using (artist_id = auth.uid() or created_by = auth.uid())
  with check (artist_id = auth.uid() or created_by = auth.uid());

drop policy if exists artworks_update_account_delegate on public.artworks;
create policy artworks_update_account_delegate
  on public.artworks
  for update
  to authenticated
  using (public.artwork_manage_allowed(artist_id, created_by))
  with check (public.artwork_manage_allowed(artist_id, created_by));

drop policy if exists artworks_delete_account_delegate on public.artworks;
create policy artworks_delete_account_delegate
  on public.artworks
  for delete
  to authenticated
  using (public.artwork_manage_allowed(artist_id, created_by));

drop policy if exists artworks_update_project_delegate on public.artworks;
create policy artworks_update_project_delegate
  on public.artworks
  for update
  to authenticated
  using (public.artwork_manage_allowed(artist_id, created_by))
  with check (public.artwork_manage_allowed(artist_id, created_by));

drop policy if exists artworks_delete_project_delegate on public.artworks;
create policy artworks_delete_project_delegate
  on public.artworks
  for delete
  to authenticated
  using (public.artwork_manage_allowed(artist_id, created_by));

drop policy if exists artworks_select_artwork_manager on public.artworks;
create policy artworks_select_artwork_manager
  on public.artworks
  for select
  to authenticated
  using (public.artwork_manage_allowed(artist_id, created_by));

-- == SECTION 3 == image policies: claims no longer insert; managers of the uploader included
drop policy if exists "Allow owner insert artwork_images" on public.artwork_images;
create policy "Allow owner insert artwork_images"
  on public.artwork_images
  for insert
  to authenticated
  with check (
    exists (
      select 1
        from public.artworks a
       where a.id = artwork_images.artwork_id
         and public.artwork_manage_allowed(a.artist_id, a.created_by)
    )
  );

drop policy if exists artwork_images_insert_account_delegate on public.artwork_images;
create policy artwork_images_insert_account_delegate
  on public.artwork_images
  for insert
  to authenticated
  with check (
    exists (
      select 1
        from public.artworks a
       where a.id = artwork_images.artwork_id
         and public.artwork_manage_allowed(a.artist_id, a.created_by)
    )
  );

drop policy if exists artwork_images_insert_project_delegate on public.artwork_images;
create policy artwork_images_insert_project_delegate
  on public.artwork_images
  for insert
  to authenticated
  with check (
    exists (
      select 1
        from public.artworks a
       where a.id = artwork_images.artwork_id
         and public.artwork_manage_allowed(a.artist_id, a.created_by)
    )
  );

drop policy if exists artwork_images_update_account_delegate on public.artwork_images;
create policy artwork_images_update_account_delegate
  on public.artwork_images
  for update
  to authenticated
  using (
    exists (
      select 1
        from public.artworks a
       where a.id = artwork_images.artwork_id
         and public.artwork_manage_allowed(a.artist_id, a.created_by)
    )
  )
  with check (
    exists (
      select 1
        from public.artworks a
       where a.id = artwork_images.artwork_id
         and public.artwork_manage_allowed(a.artist_id, a.created_by)
    )
  );

drop policy if exists artwork_images_update_project_delegate on public.artwork_images;
create policy artwork_images_update_project_delegate
  on public.artwork_images
  for update
  to authenticated
  using (
    exists (
      select 1
        from public.artworks a
       where a.id = artwork_images.artwork_id
         and public.artwork_manage_allowed(a.artist_id, a.created_by)
    )
  )
  with check (
    exists (
      select 1
        from public.artworks a
       where a.id = artwork_images.artwork_id
         and public.artwork_manage_allowed(a.artist_id, a.created_by)
    )
  );

drop policy if exists artwork_images_delete_account_delegate on public.artwork_images;
create policy artwork_images_delete_account_delegate
  on public.artwork_images
  for delete
  to authenticated
  using (
    exists (
      select 1
        from public.artworks a
       where a.id = artwork_images.artwork_id
         and public.artwork_manage_allowed(a.artist_id, a.created_by)
    )
  );

drop policy if exists artwork_images_delete_project_delegate on public.artwork_images;
create policy artwork_images_delete_project_delegate
  on public.artwork_images
  for delete
  to authenticated
  using (
    exists (
      select 1
        from public.artworks a
       where a.id = artwork_images.artwork_id
         and public.artwork_manage_allowed(a.artist_id, a.created_by)
    )
  );
