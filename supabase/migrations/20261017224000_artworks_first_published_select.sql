-- 2026-10-17 — artworks.first_published_at (20261017211500) arrived after
-- the column lock (20261017221500) replaced table-wide SELECT with a
-- column list, so clients could not read it. It is not a price or
-- availability field; grant it like the other columns.
--
-- New artworks columns need the same line, or the public API cannot
-- select them.

grant select (first_published_at) on public.artworks to anon, authenticated;

notify pgrst, 'reload schema';
