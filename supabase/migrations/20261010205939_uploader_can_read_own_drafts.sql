-- The uploader can read a draft they just created.
--
-- Bulk upload inserts artworks.artist_id as the chosen artist and
-- created_by as the account that dropped the file, then asks PostgREST
-- for the new id (INSERT ... RETURNING). A draft is not public, and the
-- curator claim does not exist yet, so no SELECT policy matched.
-- Postgres rejects that RETURNING with
-- "new row violates row-level security policy for table artworks"
-- and the file never uploads. JPG type and image quality are not involved.
--
-- UPDATE and DELETE already allow created_by = auth.uid(). SELECT was
-- the missing half. Safe to re-run.

-- == SECTION 1 == uploader can read their own rows
drop policy if exists artworks_select_created_by on public.artworks;
create policy artworks_select_created_by
  on public.artworks
  for select
  to authenticated
  using (created_by = auth.uid());
