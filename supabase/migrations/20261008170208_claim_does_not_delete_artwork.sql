-- A relationship claim is not permission to delete the work.
-- Pending and confirmed OWNS / INVENTORY / CURATED / EXHIBITED claims
-- used to satisfy "Allow owner delete artwork" and the matching
-- artwork_images policy. Deletion stays with the artist, the uploader
-- (created_by), and the existing delegate policies, which this file
-- does not replace.
--
-- Safe to re-run. Section 3 is one function. If the SQL editor splits
-- on semicolons, highlight each section and run it on its own.
-- Dollar tag is letters only.

-- == SECTION 1 == artworks delete: artist or uploader
drop policy if exists "Allow owner delete artwork" on public.artworks;
create policy "Allow owner delete artwork" on public.artworks
  for delete to authenticated
  using (
    artist_id = auth.uid()
    or created_by = auth.uid()
  );

-- == SECTION 2 == artwork_images delete: artist or uploader
drop policy if exists "Allow owner delete artwork_images" on public.artwork_images;
create policy "Allow owner delete artwork_images" on public.artwork_images
  for delete to authenticated
  using (
    exists (
      select 1 from public.artworks a
      where a.id = artwork_images.artwork_id
        and (a.artist_id = auth.uid() or a.created_by = auth.uid())
    )
  );

-- == SECTION 3 == withdrawing your own request is not an artist rejection
create or replace function public.notify_on_claim_rejected()
returns trigger
language plpgsql
security definer
set search_path = public
as $notify$
declare
  v_artist_id uuid;
begin
  if old.status is distinct from 'pending' then
    return old;
  end if;
  -- Self-revoke. The artist did not decline this request.
  if auth.uid() is not null and auth.uid() = old.subject_profile_id then
    return old;
  end if;
  select artist_id into v_artist_id from public.artworks where id = old.work_id;
  if v_artist_id is null then
    return old;
  end if;
  insert into public.notifications (user_id, type, actor_id, artwork_id, payload)
  values (old.subject_profile_id, 'claim_rejected', v_artist_id, old.work_id, jsonb_build_object('claim_type', old.claim_type));
  return old;
end;
$notify$;
