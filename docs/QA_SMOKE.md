# QA smoke — Abstract MVP (beta hardening)

Run after deploying or before a beta cut. Supabase: apply `p0_beta_hardening_wave1.sql` (and prior migrations) first.

## Pre-deploy SQL checklist (read this BEFORE shipping)

Sprint 3+ introduced schema/RPC additions. If any of these are missing, the
affected feature will fail at insert / RPC time. **Apply migrations in order**.

| Required migration | Why | Fail mode if missing |
|---|---|---|
| `supabase/migrations/20260605000000_price_inquiry_source_attribution.sql` | Adds `source_*` columns + `price_inquiries_source_surface_chk` CHECK + `idx_price_inquiries_source_room` partial index | `createPriceInquiry` insert fails (PostgREST 42703 — unknown column `source_surface`) → "Ask about this work" silently breaks for any user arriving via feed/room |
| `supabase/migrations/20260606000000_relationship_access_layer.sql` (Sprint 5) | Adds 6 tables (`visibility_owner_settings` / `visibility_policies` / `access_requests` / `access_grants` / `audience_lists` / `audience_list_members`) + 8 RPCs (`get_viewer_relationship_context`, `resolve_visibility_for_viewer`, `can_view_by_relationship`, `can_view_by_relationship_dryrun`, `upsert_visibility_policy`, `set_visibility_preset`, `create_access_request`, `resolve_access_request`) + null-safe partial unique indexes + RLS | `/my/visibility` and `/my/access-requests` 500 (`relation does not exist`); GatedField RPC calls `function does not exist`; viewer pages still render content (resolver returns null → fallback to children, but no enforcement) |

### Sprint 5 — section-by-section apply (REQUIRED)

`20260606000000_relationship_access_layer.sql` contains **multiple PL/pgSQL
function bodies** in a single file. Per `.cursor/rules/release-workflow.mdc §1-1`
the Supabase Dashboard SQL Editor splits pasted text on `;` client-side and can
mis-tokenize dollar-quoted bodies when there are 2+ functions in one paste.
**Do NOT paste the whole file at once.** Instead:

1. Open the file in your editor.
2. For each `-- == SECTION N == ...` banner, highlight everything from that
   banner up to (but not including) the next banner.
3. Paste the highlighted block into the SQL Editor and press **Run**.
4. Repeat for all 12 sections.

If a section fails, fix and re-run only that section — every CREATE / ALTER is
guarded with `IF NOT EXISTS` or `CREATE OR REPLACE` so re-runs are safe.

### Sprint 5 verification SQL

```sql
-- 6 new tables present?
select count(*) as ok from pg_tables
where schemaname='public'
  and tablename in (
    'visibility_owner_settings','visibility_policies',
    'access_requests','access_grants',
    'audience_lists','audience_list_members'
  );
-- Expect: 6

-- 8 new RPCs present?
select count(*) as ok from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'get_viewer_relationship_context','resolve_visibility_for_viewer',
    'can_view_by_relationship','can_view_by_relationship_dryrun',
    'upsert_visibility_policy','set_visibility_preset',
    'create_access_request','resolve_access_request'
  );
-- Expect: 8

-- Null-safe partial unique indexes (should be 6 total: 2 per protected table)
select indexname from pg_indexes
where schemaname='public'
  and indexname in (
    'visibility_policies_subject_keyed_uniq','visibility_policies_subject_null_uniq',
    'access_requests_pending_subject_keyed_uniq','access_requests_pending_subject_null_uniq',
    'access_grants_subject_keyed_uniq','access_grants_subject_null_uniq'
  )
order by indexname;
-- Expect: 6 rows.

-- RLS enabled on every new table?
select relname, relrowsecurity from pg_class
where relname in (
  'visibility_owner_settings','visibility_policies','access_requests',
  'access_grants','audience_lists','audience_list_members'
);
-- Expect: every relrowsecurity = true.
```

### Sprint 5 smoke flow (manual)

1. Sign in as artist A. Open `/my/visibility` → save preset `mutual_first` → confirm toast.
2. Use **Preview as → Public visitor** → confirm `price`/`availability`/`description` all show "Cannot see this field"; toggle to `Mutual` → all flip to "Can see".
3. Open `/artwork/<an artwork>/edit` → expand Field visibility → set `price` to `approved` + `request_mode = access_request` → confirm save (no error).
4. Sign in as viewer B (no follow relationship). Open `/artwork/<that artwork>` → confirm price section shows GatedField with "Request access" CTA. Click it → submit a short message.
5. Back as artist A → `/my/access-requests` → confirm pending request appears. Approve.
6. As viewer B (refresh) → confirm price now visible.
7. As artist A → `/my/inquiries` → confirm chip "Access requests · 0 pending" disappears (or absent).

Verify each migration is applied before deploy:

```sql
-- 20260605000000 — source attribution columns present?
select count(*) as ok
from information_schema.columns
where table_schema='public'
  and table_name='price_inquiries'
  and column_name in (
    'source_surface','source_artwork_id','source_exhibition_id',
    'source_room_id','source_feed_session_id','source_feed_item_key','source_payload'
  );
-- Expect: 7

-- 20260605000000 — CHECK constraint present?
select pg_get_constraintdef(oid) as def
from pg_constraint
where conname = 'price_inquiries_source_surface_chk';
-- Expect: 1 row matching the closed-set whitelist
```

After migrating, smoke-test inquiries:
1. Sign in as inquirer.
2. Open an artwork in `inquire` pricing mode.
3. Click "Ask about this work" → submit.
4. Sign in as the artist → `/my/inquiries` shows the row with no error toast.
5. Confirm the row exists in `price_inquiries` and `source_surface = 'artwork'`.

## Automated (Playwright)

```bash
# Terminal A
npm run dev

# Terminal B
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npm run test:e2e
```

Optional auto-start dev server:

```bash
PLAYWRIGHT_START_SERVER=1 npm run test:e2e
```

Current suite is minimal (public shell + login page). Extend `e2e/smoke.spec.ts` with authenticated flows when test credentials are available.

## Manual — quick

1. **Feed — All:** scroll / load more; no duplicate spinners; refresh button works.
2. **Feed — Following:** follows + exhibitions merge; load more if many follows; empty state CTA.
3. **My library:** `/my/library` — filters, search, load more, artwork opens / edit link.
4. **Bulk upload:** title prefix/suffix/replace (with confirm), size, fixed price, exhibition link/unlink, CSV paste → drafts.
5. **Inquiries:** `/my/inquiries` — filter, search, thread, reply, status; unread styling; load more.
6. **Notifications:** opening list does **not** auto-mark all read; per-row read on click; “Mark all as read” works.
7. **Diagnostics:** `/my/diagnostics` in dev or with `NEXT_PUBLIC_DIAGNOSTICS=1` — events list loads after using the app.

## "Basics Are Solid" checks

### Feed
1. **Feed infinite scroll (All):** scroll to bottom → more items load → no duplicates → "You're all caught up" at end.
2. **Feed infinite scroll (Following):** same behavior for Following tab.

### Artist attribution
3. **External artist on exhibition:** create exhibition with non-onboarded external artist → `/e/[id]` shows external artist name, not "Artist" or blank.
4. **External artist on artwork detail:** artwork with external artist → `/artwork/[id]` shows correct name in provenance.

### Size truth
5. **Size "20 x 30 in":** enters as inch → size_unit = "in" → EN shows inch, KO shows cm conversion.
6. **Size "50 x 40 cm":** enters as cm → size_unit = "cm" → KO shows cm, EN shows inch conversion.
7. **Size "100 x 80":** unitless → size_unit = null → both locales show raw numbers, no unit conversion.
8. **Size "30F":** hosu → size_unit = "cm" → correct hosu + cm display.

### Price truth
9. **KRW price display:** artwork with price_input_currency=KRW → shows "₩X KRW (≈ $Y USD)" on detail page.
10. **USD price display:** artwork with price_input_currency=USD → shows "$X USD" only.
11. **Inquire mode:** pricing_mode=inquire → shows i18n "Price upon request" / "가격 문의".

### Import honesty
12. **Import template:** `/my/library/import` → "Download template CSV" has exactly 7 columns (title, year, medium, size, size_unit, ownership_status, pricing_mode).
13. **Import persist:** import CSV with all 7 fields → all persist to artwork draft → editable in artwork edit page.
14. **Import duplicate skip:** duplicates flagged → skip checked by default → summary accurate.

### Surface simplification
15. **Save modal:** modal title "Save", clear saved/add states.
16. **Alerts:** title "Alerts", digest "coming soon", no over-promise.
17. **Ops hidden:** `/my` dashboard has no "Ops Panel" link. `/my/ops` works via URL only.

## Wave 2.1 integration checks

1. **Shortlist from artwork:** `/artwork/[id]` → "Save" → choose/create shortlist → saved; repeat → toggled off.
2. **Shortlist from exhibition:** `/e/[id]` → "Save" → add exhibition to shortlist.
3. **Collaborator add:** `/my/shortlists/[id]` → search username → add as viewer → appears in list with badge.
4. **Collaborator remove:** remove collaborator → gone from list.
5. **Rotate link:** click "Rotate link" → old `/room/` link fails → new link works.
6. **Room disable:** toggle "Room: Disabled" → `/room/[token]` shows expired message.
7. **Room CTA:** `/room/[token]` → "Ask about this work" → navigates to `/artwork/[id]?fromRoom=...`.
8. **Room breadcrumb:** artwork detail from room → "← Back to room" visible.
9. **Interest notification:** add "Oil" medium interest → upload artwork with medium "Oil on canvas" → notification generated with interest source.
10. **Digest queue:** after notification → `/my/alerts` → digest preview shows event.
11. **Assignee:** `/my/inquiries` → "Assign to me" → "assigned" badge visible.
12. **Last contact auto:** reply to inquiry → `last_contact_date` updated automatically.
13. **Notes RLS:** inquiry note visible to artwork artist, not just author (test with acting-as).
14. **Import v2:** paste CSV with 10+ columns → auto-map → preview with duplicate flags → skip duplicates → import summary.
15. **Ops export:** `/my/ops` → "Export CSV" → file downloads. Profile link copy works. Recent 7d filter works.

## Wave 2 differentiation checks

1. **Shortlists:** create shortlist, add artwork, copy share link → open `/room/{token}` in incognito → items visible.
2. **Shortlist detail:** edit title/description, remove item, see collaborator count.
3. **Pipeline:** `/my/inquiries` → change pipeline stage → filter by stage → verify.
4. **Internal notes:** expand inquiry → add note → note appears; note NOT visible to inquirer.
5. **Next action date:** set date, verify it persists after page reload.
6. **CSV import:** `/my/library/import` → paste CSV → map columns → validate → import → check drafts in library.
7. **CSV export:** `/my/library` → click Export CSV → file downloads with correct data.
8. **Alerts:** `/my/alerts` → toggle new work alerts → change digest → add/remove interest.
9. **Ops panel:** `/my/ops` → see profile table → filter by random username → filter by no uploads.
10. **New work trigger:** follow an artist → artist uploads public work → follower gets notification (requires alert_preferences row with `new_work_alerts = true`).

## Wave 1.1 reconciliation checks

1. **Feed following tab:** load more triggers IntersectionObserver; no scroll listener present.
2. **Feed TTL:** switch tabs, then return within 90s — no network fetch; after 90s — background refresh fires.
3. **Feed events:** check `beta_analytics_events` for `feed_loaded` with `source`, `item_count`, `duration_ms`.
4. **Artwork detail — inquirer thread:** send inquiry, receive reply, send follow-up — all messages visible in thread.
5. **Artwork detail — artist thread:** artist sees thread messages per inquiry; can reply multiple times (not one-shot).
6. **Notifications:** entering `/notifications` does NOT auto-clear unread; click single → only that row read; button clears all.

## Regression

- Profile save / settings unchanged.
- Artwork detail price inquiry still creates thread row when message non-empty.
- Feed `getFollowingIds` called once per tab branch; `listFollowingArtworks` receives pre-fetched IDs.
