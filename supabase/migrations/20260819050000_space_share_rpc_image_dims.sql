-- ============================================================
-- 2026-08-19 P1 Display / Hang Simulation — share RPC (image dims)
-- ------------------------------------------------------------
-- Extends `public.get_space_by_share_token(uuid)` to include the
-- pixel dimensions of each artwork's cover image
-- (`artwork_images.width` / `.height`). The client uses these to
-- warn when the uploaded image aspect ratio disagrees with the
-- placement's physical (`width_cm` × `height_cm`) aspect — the P1
-- "이미지에 배경 padding 이 딸려와 벽에 스티커처럼 붙음" symptom
-- from the render-quality bug report.
--
-- Payload shape stays additive: two new keys inside each
-- `artwork_images[]` element (`width` / `height`). Existing keys
-- (`storage_path`, `sort_order`, `view_type`) are unchanged so the
-- deserializer in `src/lib/supabase/spaces.ts::rowToArtworkThumb`
-- can gracefully consume either the old or the new response (nulls
-- are fine for legacy rows that predate the auto-compression pass
-- which populates these).
--
-- SECURITY DEFINER / grants / gating predicates are all unchanged
-- from `20260818100000_space_share_rpc.sql`. Only the SELECT
-- projection widens.
-- ============================================================

begin;

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
  -- Resolve token → space id, gated on the same predicates the
  -- previous embedded-select applied on the client
  -- (`is_active = true` AND (`expires_at IS NULL` OR
  -- `expires_at > now()`)).
  select id
    into v_space_id
    from public.spaces
   where share_token = _token
     and is_active   = true
     and (expires_at is null or expires_at > now());

  if v_space_id is null then
    return null;
  end if;

  -- Compose payload that matches the shape
  -- `client.from('spaces').select('… space_surfaces(…), space_placements(…)').maybeSingle()`
  -- returns, plus a separate `artwork_rows` bag of public artwork
  -- thumbs (Supabase JS treats top-level `rpc()` results as
  -- opaque JSON, so we bundle both under one call to avoid a
  -- second round-trip).
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
  '2026-08-19 P1 render-quality — same as 2026-08-17 (16) share RPC, '
  'but the artwork_images payload now carries width/height pixel dims '
  'so the client can warn on aspect-ratio mismatch between image and '
  'placement.';

-- Grants are inherited by CREATE OR REPLACE from the original
-- migration; re-issue defensively so a partial-apply state cannot
-- leave `anon` without execute permission.
revoke all      on function public.get_space_by_share_token(uuid) from public;
grant  execute  on function public.get_space_by_share_token(uuid) to anon;
grant  execute  on function public.get_space_by_share_token(uuid) to authenticated;
grant  execute  on function public.get_space_by_share_token(uuid) to service_role;

commit;
