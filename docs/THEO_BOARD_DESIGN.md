# Theo Board — standing spec

Last updated: 2026-08-13

Community board for announcements, events, features, community notes, news,
and promotional posts. Users submit a subset of types; staff approve before
a post goes live. CLI token publish remains for staff/ops authoring
(announcement / feature included). Slack is a documented follow-up, not
implemented.

## Staff roles

Staff live in existing `public.platform_admins` (same allowlist as
`/my/ops/external-artists`). No shared `theo_admin` password — staff use
their own Theo login.

Roles (ladder): `moderator` < `ops` < `admin`.

| Role | Can |
| --- | --- |
| moderator | Board queue approve / reject (hide remains CLI). |
| ops | + existing external-artist merge + `/my/ops/people` skeleton. |
| admin | + grant / revoke staff at `/my/ops/staff`. |

- Existing `platform_admins` rows default to `ops` so the merge tool keeps
  working. `is_ops_user()` stays “any row in `platform_admins`”.
- Role-aware checks use `is_staff_at_least(p_min)`.
- First admin is granted via SQL only (no self-serve bootstrap):

```sql
insert into platform_admins (profile_id, role, note)
values ('<uuid>', 'admin', 'founder');
-- or, if the row already exists:
update platform_admins set role = 'admin' where profile_id = '<uuid>';
```

Every approve / reject / submit / grant / revoke writes `ops_audit_log`.

## Schema

Tables:

- `theo_board_posts` — see `20260814000000_theo_board.sql` plus
  `20260815000000_theo_board_moderation.sql`.
  - `type`: `announcement`, `event`, `feature`, `community`, `news`, `promo`
  - `status`: `pending` \| `approved` \| `rejected` \| `withdrawn`
  - `reviewed_by` / `reviewed_at` / `reject_reason`
  - Live row: `status = 'approved' AND hidden_at IS NULL AND published_at IS NOT NULL AND (expires_at IS NULL OR expires_at > now())`
- `theo_board_reports` — prepared for community phase 2. Unused in UI.
- `ops_audit_log` — no public SELECT/INSERT; SECURITY DEFINER RPCs write.
- `platform_admins.role` — `moderator` \| `ops` \| `admin`, default `ops`.

## User submit + staff approve

User-submittable types: `event`, `community`, `news`, `promo`.
Staff / CLI may still publish `announcement` and `feature`.

1. Signed-in user opens `/theo-board/new`, agrees to the posting policy,
   submits via `theo_board_submit` → row is `pending`, `published_at` null.
2. Staff (moderator+) review at `/my/ops/board`.
   - Approve (`theo_board_approve`) → `status=approved`, `published_at=now()`,
     goes live on the rail and `/theo-board`.
   - Reject (`theo_board_reject`) → `rejected` + required reason (1–500).
3. Author sees status at `/theo-board/mine`. Pending posts can be withdrawn
   (`theo_board_withdraw`). Rejected posts show the reason. Users cannot
   self-approve (RLS WITH CHECK keeps `published_at` null and status out of
   `approved`).

Apply `20260815000000_theo_board_moderation.sql` **by SECTION** in the
Dashboard SQL Editor (2+ PL/pgSQL functions — do not paste the whole file).

## RLS (posts)

- Live SELECT (`anon` + `authenticated`): approved + live conditions above.
- Authenticated SELECT own rows (`author_id = auth.uid()`).
- Authenticated INSERT own pending: `event|community|news|promo`,
  `published_at` null, `status=pending`.
- Authenticated UPDATE own `pending|rejected|withdrawn` only; WITH CHECK
  forbids `status=approved` and non-null `published_at`.
- Reports: INSERT for `authenticated` with `reporter_id = auth.uid()`.
- `ops_audit_log`: no grants to anon/authenticated.

## CLI publish (still works)

Writes go through Next.js `/api/theo-board/*` using `SUPABASE_SERVICE_ROLE_KEY`
(bypasses RLS), gated by `Authorization: Bearer <THEO_BOARD_PUBLISH_TOKEN>`.
`POST /api/theo-board/publish` sets `status='approved'` (or `pending` for
`--draft`) and `published_at` when publishing now. If the `status` column is
missing, the route returns 500 asking to apply the moderation migration.

```bash
THEO_BOARD_PUBLISH_TOKEN=… npm run publish:theo -- --title "…" --type announcement
```

Hide / pin remain the same token + service-role path
(`POST /api/theo-board/hide`, `POST /api/theo-board/pin`).

Slack authoring is **not in this release**.

## Fail-soft

If `theo_board_posts` is missing (SQL not applied yet) or the rail fetch
errors / returns no rows, the right-rail widget keeps the existing 6-row
placeholder. Live queries do not select the new status columns, so a
partially-applied older schema still fail-softs. Ops RPCs missing → staff
pages show the no-access copy.

## Read UI

- Rail: `getTheoBoardRail(6)` — type chip, title, relative time, summary.
  External `href` opens in a new tab; otherwise `/theo-board/[id]`.
- `/theo-board` list with type filters + load more. Signed-in header:
  “글 올리기” → `/theo-board/new`, “내 제출” → `/theo-board/mine`.
- `/theo-board/[id]` detail. Body is a small safe markdown subset
  (`src/lib/markdown/safeMd.tsx`) — no `react-markdown`.

## Ops UI

- `/my/ops` hub links: Board queue, People, Staff (Staff always visible;
  the page 403s if the caller is not admin).
- `/my/ops/board` — moderator+. Tabs pending / rejected / approved.
- `/my/ops/people` — ops+. Skeleton only (lookup stays on `/my/ops`;
  settings mutation is not enabled). No password reset or email edit.
- `/my/ops/staff` — admin. Search people (name / username / email) then
  grant role + note / revoke with last-admin protection. Founder
  `henry@g-1.art` self-grants via `staff_claim_founder`.

## Follow-ups (not this release)

- Slack (or other) authoring using the same publish token or a dedicated bot.
- Wire `theo_board_reports` into the UI.
- Staff hide from the board queue (CLI hide already exists).
- `/my/ops/people` settings mutation (break-glass) — explicitly out of scope.
