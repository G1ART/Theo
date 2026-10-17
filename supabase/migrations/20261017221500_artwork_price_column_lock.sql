-- 2026-10-17 — Stored artwork price and availability columns are not
-- readable with the public API key.
--
-- Run only after the app that reads public.artwork_cards
-- (20261017221000_artwork_viewer_fields.sql) is live in production.
--
-- After this:
--   * anon / authenticated keep SELECT on every other artworks column and
--     keep INSERT / UPDATE / DELETE (RLS unchanged), so uploads and edits
--     still write these columns.
--   * The eight stored columns reach clients only through
--     artwork_cards.viewer_fields, artwork_viewer_fields_for() and the
--     detail passport, all judged per viewer.
--   * A new artworks column is not readable by clients until it is added
--     to the grant below.

revoke select on public.artworks from anon, authenticated;

grant select (
  id,
  artist_id,
  title,
  title_ko,
  title_en,
  year,
  medium,
  medium_ko,
  medium_en,
  size,
  size_unit,
  work_form,
  width_cm,
  height_cm,
  depth_cm,
  dims_confirmed_at,
  story,
  story_ko,
  story_en,
  visibility,
  work_kind,
  created_by,
  artist_sort_order,
  artist_sort_updated_at,
  created_at,
  updated_at,
  provenance_visible,
  website_import_provenance,
  likes_count
) on public.artworks to anon, authenticated;

notify pgrst, 'reload schema';
