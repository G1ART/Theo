-- 2026-10-17 — Shared rooms and boards failed to open: both token RPCs
-- ordered artwork images by artwork_images."position", which does not
-- exist (the column is sort_order), so every active room raised 42703.
-- Bodies are the live definitions read on 2026-10-17 with the image order
-- fixed and assignments written with :=.
--
-- Apply section by section in the SQL editor.

-- == SECTION 1 == get_room_for_viewer_by_token

create or replace function public.get_room_for_viewer_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $a$
declare
  v_uid uuid := auth.uid();
  v_token uuid;
  v_room_id uuid;
  v_owner uuid;
  v_resolution jsonb;
  v_relationship jsonb;
  v_can boolean;
  v_meta jsonb;
  v_items jsonb;
begin
  if p_token is null or length(p_token) = 0 then
    return null;
  end if;

  begin
    v_token := p_token::uuid;
  exception when others then
    return null;
  end;

  v_meta := (
    select jsonb_build_object(
      'id', s.id,
      'title', s.title,
      'description', s.description,
      'owner_id', s.owner_id,
      'owner_username', p.username,
      'owner_display_name', p.display_name,
      'owner_display_name_ko', p.display_name_ko,
      'owner_display_name_en', p.display_name_en
    )
    from public.shortlists s
    join public.profiles p on p.id = s.owner_id
    where s.share_token = v_token
      and s.room_active = true
      and (s.expires_at is null or s.expires_at > now())
  );

  if v_meta is null then
    return null;
  end if;

  v_room_id := (v_meta->>'id')::uuid;
  v_owner := (v_meta->>'owner_id')::uuid;
  v_resolution := public.resolve_visibility_for_viewer(v_owner, 'room', v_room_id, '*');
  v_relationship := public.get_viewer_relationship_context(v_owner);
  v_can := coalesce((v_resolution->>'can_view')::boolean, false);

  if v_can then
    begin
      insert into public.shortlist_views (shortlist_id, viewer_id, action)
      values (v_room_id, v_uid, 'viewed');
    exception when others then
      null;
    end;

    v_items := (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'item_id', si.id,
            'artwork_id', si.artwork_id,
            'exhibition_id', si.exhibition_id,
            'note', si.note,
            'position', si."position",
            'artwork_title', a.title,
            'artwork_title_ko', a.title_ko,
            'artwork_title_en', a.title_en,
            'artwork_image_path', (
              select ai.storage_path
              from public.artwork_images ai
              where ai.artwork_id = a.id
              order by ai.sort_order nulls last, ai.created_at
              limit 1
            ),
            'artwork_artist_name', public.artwork_display_artist_name(a.id, prof.display_name),
            'artwork_artist_name_ko', public.artwork_artist_name_slot(a.id, prof.display_name_ko, 'ko'),
            'artwork_artist_name_en', public.artwork_artist_name_slot(a.id, prof.display_name_en, 'en'),
            'exhibition_title', proj.title,
            'exhibition_title_ko', proj.title_ko,
            'exhibition_title_en', proj.title_en
          )
          order by si."position", si.created_at
        ),
        '[]'::jsonb
      )
      from public.shortlist_items si
      left join public.artworks a on a.id = si.artwork_id and a.visibility = 'public'
      left join public.profiles prof on prof.id = a.artist_id
      left join public.projects proj on proj.id = si.exhibition_id
      where si.shortlist_id = v_room_id
    );
  else
    v_items := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'room', v_meta,
    'items', v_items,
    'visibility', v_resolution,
    'relationship', v_relationship,
    'can_view', v_can
  );
end;
$a$;

-- == SECTION 2 == get_shortlist_items_by_token

create or replace function public.get_shortlist_items_by_token(p_token uuid)
returns table(item_id uuid, artwork_id uuid, exhibition_id uuid, note text, "position" integer, artwork_title text, artwork_image_path text, artwork_artist_name text, exhibition_title text)
language plpgsql
security definer
set search_path to 'public'
as $a$
declare
  v_shortlist_id uuid;
begin
  v_shortlist_id := (
    select s.id
      from public.shortlists s
     where s.share_token = p_token
       and s.room_active = true
       and (s.expires_at is null or s.expires_at > now())
  );
  if v_shortlist_id is null then return; end if;

  insert into public.shortlist_views (shortlist_id, viewer_id, action)
    values (v_shortlist_id, auth.uid(), 'viewed');

  return query
    select si.id as item_id, si.artwork_id, si.exhibition_id, si.note, si."position",
           a.title as artwork_title,
           (select ai.storage_path from public.artwork_images ai where ai.artwork_id = a.id order by ai.sort_order nulls last, ai.created_at limit 1) as artwork_image_path,
           public.artwork_display_artist_name(a.id, prof.display_name) as artwork_artist_name,
           proj.title as exhibition_title
      from public.shortlist_items si
      left join public.artworks a on a.id = si.artwork_id and a.visibility = 'public'
      left join public.profiles prof on prof.id = a.artist_id
      left join public.projects proj on proj.id = si.exhibition_id
     where si.shortlist_id = v_shortlist_id
     order by si."position", si.created_at;
end;
$a$;
