-- 2026-10-17 — anon had table-wide INSERT, UPDATE, DELETE, TRUNCATE,
-- REFERENCES and TRIGGER on artworks (Supabase default). No anon write
-- path exists: every write policy needs auth.uid() (artworks_owner_write
-- is the only one open to public and checks auth.uid() = artist_id), app
-- writes run with the user's session, the website import route uses the
-- user's token, scripts use the service role, and no invoker-rights
-- function writes artworks. TRUNCATE also skips RLS.
--
-- Column SELECT grants for anon (20261017221500, 20261017224000) stay.

revoke insert, update, delete, truncate, references, trigger on public.artworks from anon;

notify pgrst, 'reload schema';
