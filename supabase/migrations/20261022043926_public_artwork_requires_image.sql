-- Public artworks need at least one artwork_images row.
-- Drafts may be empty. The check is deferred so one transaction can
-- insert a draft, attach an image, and then publish. A request that
-- commits a public row with no image is rejected.
-- Deleting the artwork still cascades its images: at commit the
-- artwork row is already gone, so the check does not block that delete.

create or replace function public.public_artwork_requires_image()
returns trigger
language plpgsql
security definer
set search_path = public
as $requireimg$
declare
  v_artwork_id uuid;
begin
  if tg_table_name = 'artworks' then
    if new.visibility is distinct from 'public' then
      return null;
    end if;
    if tg_op = 'UPDATE' and old.visibility = 'public' then
      return null;
    end if;
    v_artwork_id := new.id;
  elsif tg_op = 'DELETE' then
    v_artwork_id := old.artwork_id;
  elsif tg_op = 'UPDATE' and new.artwork_id is distinct from old.artwork_id then
    v_artwork_id := old.artwork_id;
  else
    return null;
  end if;

  if exists (
    select 1
      from public.artworks a
     where a.id = v_artwork_id
       and a.visibility = 'public'
       and not exists (
         select 1
           from public.artwork_images ai
          where ai.artwork_id = a.id
       )
  ) then
    raise exception 'public_artwork_requires_image'
      using errcode = '23514';
  end if;

  return null;
end;
$requireimg$;

drop trigger if exists artworks_public_requires_image on public.artworks;
create constraint trigger artworks_public_requires_image
  after insert or update of visibility on public.artworks
  deferrable initially deferred
  for each row
  execute function public.public_artwork_requires_image();

drop trigger if exists artwork_images_keep_public_image on public.artwork_images;
create constraint trigger artwork_images_keep_public_image
  after delete or update of artwork_id on public.artwork_images
  deferrable initially deferred
  for each row
  execute function public.public_artwork_requires_image();

revoke all on function public.public_artwork_requires_image() from public, anon, authenticated;
