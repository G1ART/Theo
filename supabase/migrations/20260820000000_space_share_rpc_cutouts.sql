-- ============================================================
-- 2026-08-20 Display Simulation Phase 2 — cutout image support
-- ------------------------------------------------------------
-- Phase 2 of the render-quality track (release 27 diagnosis).
-- Adds "painting isolation" so the simulation renderer can prefer
-- a background-free version of each artwork over the raw upload
-- (which routinely carries wall / matte padding around the actual
-- painting — the "네모난 이미지가 세로 방향인데 정사각형처럼
-- 보임" symptom).
--
-- Two new `artwork_images.view_type` values are introduced side by
-- side; neither replaces the original `wall_mounted` row:
--
--   • `cutout`       — Track 1 (free): result of the OpenAI vision
--                      bbox crop. Same encoding as the source
--                      (JPEG / WebP), tighter framing.
--   • `cutout_alpha` — Track 2 (premium, beta-unlocked): result of
--                      the Photoroom background-removal API. PNG
--                      with a real alpha channel so the wall shows
--                      through.
--
-- Additive only. Historical rows keep their `wall_mounted` default;
-- the renderer preference (`cutout_alpha` > `cutout` > primary) is
-- purely client-side, so this migration is safe to ship before the
-- corresponding client change lands.
--
-- The `get_space_by_share_token(_token uuid)` RPC is also refreshed
-- so the public share view sees the new rows. Same SECURITY DEFINER
-- / grants / gating predicates as `20260819050000`; only the
-- `artwork_images` WHERE-clause widens.
-- ============================================================

begin;

-- == SECTION 1 == extend artwork_images.view_type whitelist
--
-- Drop the older constraint (added in `20260626100000`) and re-add
-- with the two new values. `if exists` keeps the migration idempotent
-- for local dev boxes that partially applied.
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conname = 'artwork_images_view_type_check'
       and conrelid = 'public.artwork_images'::regclass
  ) then
    alter table public.artwork_images
      drop constraint artwork_images_view_type_check;
  end if;
end $$;

alter table public.artwork_images
  add constraint artwork_images_view_type_check
  check (view_type in (
    'wall_mounted',
    'detail',
    'angle',
    'in_situ',
    'other',
    'cutout',
    'cutout_alpha'
  ));

comment on constraint artwork_images_view_type_check on public.artwork_images is
  '2026-08-20 Display Sim Phase 2 — widened enum to allow `cutout` (Vision bbox crop, JPEG) and `cutout_alpha` (Photoroom transparent PNG) sibling rows. Preference: cutout_alpha > cutout > wall_mounted.';

-- == SECTION 2 == extend the public share RPC to include cutout rows
create or replace function public.get_space_by_share_token(_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $body$
declare
  v_space_id uuid;
  v_result   jsonb;
begin
  select id
    into v_space_id
    from public.spaces
   where share_token = _token
     and is_active   = true
     and (expires_at is null or expires_at > now());

  if v_space_id is null then
    return null;
  end if;

  -- Payload shape unchanged from `20260819050000`; only the
  -- `artwork_images` WHERE clause widens to include the two new
  -- cutout view_types. Existing keys (`storage_path`, `sort_order`,
  -- `view_type`, `width`, `height`) are preserved so the client
  -- deserializer (`rowToArtworkThumb`) can pick the preferred row
  -- (`cutout_alpha` > `cutout` > `wall_mounted`) without another
  -- schema bump.
  select jsonb_build_object(
    'space_row',
      to_jsonb(s) ||
      jsonb_build_object(
        'space_surfaces', coalesce((
          select jsonb_agg(to_jsonb(sf) order by sf.surface_index nulls last, sf.created_at)
            from public.space_surfaces sf
           where sf.space_id = s.id
        ), '[]'::jsonb),
        'space_placements', coalesce((
          select jsonb_agg(to_jsonb(sp) order by sp.z_order nulls last, sp.created_at)
            from public.space_placements sp
           where sp.space_id = s.id
        ), '[]'::jsonb)
      ),
    'artwork_rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',         a.id,
        'title',      a.title,
        'title_ko',   a.title_ko,
        'title_en',   a.title_en,
        'visibility', a.visibility,
        'work_form',  a.work_form,
        'width_cm',   a.width_cm,
        'height_cm',  a.height_cm,
        'depth_cm',   a.depth_cm,
        'artwork_images', coalesce((
          select jsonb_agg(jsonb_build_object(
            'storage_path', ai.storage_path,
            'sort_order',   ai.sort_order,
            'view_type',    ai.view_type,
            'width',        ai.width,
            'height',       ai.height
          ) order by ai.sort_order nulls last)
            from public.artwork_images ai
           where ai.artwork_id = a.id
             and ai.view_type in ('wall_mounted', 'cutout', 'cutout_alpha')
        ), '[]'::jsonb)
      ))
        from public.artworks a
       where a.visibility = 'public'
         and a.id in (
           select artwork_id
             from public.space_placements
            where space_id = s.id
         )
    ), '[]'::jsonb)
  )
    into v_result
    from public.spaces s
   where s.id = v_space_id;

  return v_result;
end
$body$;

comment on function public.get_space_by_share_token(uuid) is
  '2026-08-20 Display Sim Phase 2 — same shape as 2026-08-19 share RPC, '
  'but the artwork_images payload now includes rows with `view_type in '
  '(''wall_mounted'', ''cutout'', ''cutout_alpha'')` so the client renderer '
  'can prefer a background-free variant when available.';

revoke all      on function public.get_space_by_share_token(uuid) from public;
grant  execute  on function public.get_space_by_share_token(uuid) to anon;
grant  execute  on function public.get_space_by_share_token(uuid) to authenticated;
grant  execute  on function public.get_space_by_share_token(uuid) to service_role;

commit;
