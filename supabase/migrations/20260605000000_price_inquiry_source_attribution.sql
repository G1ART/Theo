-- Sprint 3 — Inquiry source attribution.
--
-- Adds 7 nullable source-context columns to `price_inquiries` so a
-- newly-created inquiry can record *where the inquirer came from*:
-- a feed click, a private room, an artwork detail, or an exhibition.
--
-- Design constraints:
--   - Attribution is informational only. It must NEVER grant access
--     (RLS is unchanged below).
--   - Privacy: room TOKEN is intentionally NOT stored. We resolve the
--     token to a `shortlist_id` on the client before insert and store
--     only that uuid. Tokens are bearer-secrets and have no business
--     living in long-lived analytics rows.
--   - Backward-compatible: every column is nullable with no default,
--     so existing INSERTs that omit the new fields keep working.
--   - Cheap on hot paths: a single partial-ish index on `source_room_id`
--     is enough for the v1 reporting queries (per-room inquiry counts,
--     room→inquiry conversion). Other source surfaces are read with
--     `select` joins only — no per-column index overhead.
--   - No RPC, no trigger, no policy change. This is a pure schema
--     additive change so it can run safely against a busy production DB.

alter table public.price_inquiries
  add column if not exists source_surface text,
  add column if not exists source_artwork_id uuid references public.artworks(id) on delete set null,
  add column if not exists source_exhibition_id uuid,
  add column if not exists source_room_id uuid,
  add column if not exists source_feed_session_id text,
  add column if not exists source_feed_item_key text,
  add column if not exists source_payload jsonb;

-- Constrain source_surface to a closed set of known values. Keep it
-- permissive (text + check) instead of a Postgres enum so we can add
-- new surfaces in a future sprint without an enum migration dance.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'price_inquiries_source_surface_chk'
  ) then
    alter table public.price_inquiries
      add constraint price_inquiries_source_surface_chk
      check (
        source_surface is null or source_surface in (
          'feed', 'room', 'artwork', 'exhibition', 'profile', 'direct'
        )
      );
  end if;
end $$;

-- Light reporting index. Most "where is my inquiry coming from" queries
-- aggregate by room (the rarest, most actionable source) so a partial
-- index there is the best return on storage.
create index if not exists idx_price_inquiries_source_room
  on public.price_inquiries(source_room_id)
  where source_room_id is not null;

-- Comment columns so future operators reading the schema know the
-- privacy intent without hunting the migration file.
comment on column public.price_inquiries.source_surface is
  'Informational only. Closed set: feed | room | artwork | exhibition | profile | direct.';
comment on column public.price_inquiries.source_room_id is
  'Resolved shortlist id when the inquirer arrived from a private room. Room TOKEN must NOT be stored here.';
comment on column public.price_inquiries.source_feed_session_id is
  'Telemetry session id from feed source breadcrumb. Not a Supabase auth session.';
comment on column public.price_inquiries.source_payload is
  'Free-form jsonb for tiny extra context (e.g. feed tab/sort, position). Never include titles, messages, image URLs, or auth secrets.';
