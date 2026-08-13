# Theo Board — standing spec

Last updated: 2026-08-13

Community board for announcements, events, features, community notes, and news.
**This release does not open INSERT to all authenticated users.** Writes are
token-gated (CLI now; Slack is a documented follow-up, not implemented).

## Schema

Tables (see `supabase/migrations/20260814000000_theo_board.sql`):

- `theo_board_posts` — `type`, `title` (1–120), optional `body_md` / `summary` /
  `href`, `author_id` → `profiles`, `published_at` (null = draft), `expires_at`
  (null = no expiry), `pinned`, `hidden_at` (soft hide).
- `theo_board_reports` — prepared for community phase 2. Unused in UI this
  release. Authenticated INSERT only (`reporter_id = auth.uid()`). No public
  SELECT.

## RLS

- Both tables: RLS on.
- Posts SELECT (`anon` + `authenticated`): live rows only —
  `hidden_at IS NULL AND published_at IS NOT NULL AND (expires_at IS NULL OR expires_at > now())`.
- Posts: **no** INSERT / UPDATE / DELETE policies for anon or authenticated.
- Reports: INSERT for `authenticated` with `reporter_id = auth.uid()`. No public SELECT.
- Grants: SELECT on posts to anon + authenticated; INSERT on reports to authenticated.

Writes go through Next.js `/api/theo-board/*` using `SUPABASE_SERVICE_ROLE_KEY`
(bypasses RLS). The HTTP layer is gated by `Authorization: Bearer <THEO_BOARD_PUBLISH_TOKEN>`.

## Publish flow

1. Operator sets `THEO_BOARD_PUBLISH_TOKEN` and `SUPABASE_SERVICE_ROLE_KEY` in
   Vercel (and locally in `.env.local`).
2. Apply the SQL in Supabase Dashboard SQL Editor (paste whole file; no SECTION split).
3. Publish:

```bash
THEO_BOARD_PUBLISH_TOKEN=… npm run publish:theo -- --title "…" --type announcement
```

CLI POSTs to `${NEXT_PUBLIC_APP_URL}/api/theo-board/publish` (fallback
`http://localhost:3000`). Hide / pin are the same token + service-role path
(`POST /api/theo-board/hide`, `POST /api/theo-board/pin`).

Slack authoring is **phase 2 / follow-up** — not in this release.

## Fail-soft

If `theo_board_posts` is missing (SQL not applied yet) or the rail fetch
errors / returns no rows, the right-rail widget keeps the existing 6-row
placeholder. The list page uses the same placeholder copy on fetch failure;
an empty state is shown only when the table exists and the query succeeded
with zero live rows.

## Read UI

- Rail: `getTheoBoardRail(6)` — type chip, title, relative time, summary.
  External `href` opens in a new tab; otherwise `/theo-board/[id]`.
- `/theo-board` list with type filters + load more.
- `/theo-board/[id]` detail. Body is a small safe markdown subset
  (`src/lib/markdown/safeMd.tsx`) — no `react-markdown`.

## Community phase 2 (not this release)

- Open INSERT (and likely UPDATE of own drafts) to authenticated users,
  still with moderation / hide.
- Wire `theo_board_reports` into the UI.
- Slack (or other) authoring using the same publish token or a dedicated bot.
