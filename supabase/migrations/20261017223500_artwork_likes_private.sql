-- 2026-10-17 — Likes are private: a signed-in user reads only their own
-- rows of public.artwork_likes.
--
-- Run only after the app that reads get_like_edges_for_works and
-- likes_count (20261017223000_liked_works.sql + the matching deploy) is
-- live in production.
--
-- Still working after this:
--   * likes_count on artworks (trigger, SECURITY DEFINER).
--   * The artist's "liked your work" notification (trigger).
--   * get_artwork_passport_for_viewer, get_people_recs,
--     list_my_liked_artworks, get_like_edges_for_works (SECURITY DEFINER).
--   * isLiked / getLikedArtworkIds / countMyLikes (own rows).
-- The SELECT grant stays so an anon `artwork_likes(count)` embed returns 0
-- instead of failing; RLS decides the rows.

drop policy if exists artwork_likes_select_all on public.artwork_likes;
drop policy if exists "Allow read artwork_likes" on public.artwork_likes;
drop policy if exists artwork_likes_select_own on public.artwork_likes;

create policy artwork_likes_select_own
  on public.artwork_likes
  for select
  to authenticated
  using (user_id = auth.uid());

notify pgrst, 'reload schema';
