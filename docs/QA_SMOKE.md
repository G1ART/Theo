# QA smoke — Abstract MVP (beta hardening)

Run after deploying or before a beta cut. Supabase: apply `p0_beta_hardening_wave1.sql` (and prior migrations) first.

## Pre-deploy SQL checklist (read this BEFORE shipping)

Sprint 3+ introduced schema/RPC additions. If any of these are missing, the
affected feature will fail at insert / RPC time. **Apply migrations in order**.

| Required migration | Why | Fail mode if missing |
|---|---|---|
| `supabase/migrations/20260605000000_price_inquiry_source_attribution.sql` | Adds `source_*` columns + `price_inquiries_source_surface_chk` CHECK + `idx_price_inquiries_source_room` partial index | `createPriceInquiry` insert fails (PostgREST 42703 — unknown column `source_surface`) → "Ask about this work" silently breaks for any user arriving via feed/room |
| `supabase/migrations/20260606000000_relationship_access_layer.sql` (Sprint 5) | Adds 6 tables (`visibility_owner_settings` / `visibility_policies` / `access_requests` / `access_grants` / `audience_lists` / `audience_list_members`) + 8 RPCs (`get_viewer_relationship_context`, `resolve_visibility_for_viewer`, `can_view_by_relationship`, `can_view_by_relationship_dryrun`, `upsert_visibility_policy`, `set_visibility_preset`, `create_access_request`, `resolve_access_request`) + null-safe partial unique indexes + RLS | `/my/visibility` and `/my/access-requests` 500 (`relation does not exist`); GatedField RPC calls `function does not exist`; viewer pages still render content (resolver returns null → fallback to children, but no enforcement) |
| `supabase/migrations/20260607000000_relationship_access_enforcement_hardening.sql` (Sprint 5.2) | Adds `visibility_subject_belongs_to_owner` validator helper, recreates resolver/upsert/create-request/resolve-request to call it, adds `cancel_access_request` RPC + drops `access_requests_update_requester_cancel` policy, adds `get_artwork_passport_for_viewer` and `get_room_for_viewer_by_token` redacted RPCs, adds `resolve_visibility_for_preview` for owner preview-as | `/artwork/[id]` 500 (`function get_artwork_passport_for_viewer does not exist`); `/room/[token]` 500 (`function get_room_for_viewer_by_token does not exist`); `/my/access-requests` cancel button errors (`function cancel_access_request does not exist`); AccessRequestModal shows generic error because `create_access_request` returns `record` instead of expected `jsonb { request, duplicate }` |
| `supabase/migrations/20260608000000_sprint6_phase0_and_relationship_desk.sql` (Sprint 6) | Re-emits `get_artwork_passport_for_viewer` with explicit allowlists (drops `external_artists.invite_email` and internal `is_public` from viewer payload). Adds attribution-safe `resolve_room_source_from_token(text, uuid)`. Creates `relationship_private_notes` table + RLS + `upsert_relationship_private_note` RPC. Adds `get_relationship_desk_for_owner` and `get_relationship_card_for_owner` RPCs. Adds additive `resolve_access_request_v2` for grant lifecycle. | Without this: viewer artwork payloads still leak `invite_email`; `/artwork/[id]?fromRoom=...` still pulls full room metadata; `/my/relationships` 500 (`function get_relationship_desk_for_owner does not exist`); private note save errors (`relation does not exist`). |
| `supabase/migrations/20260609000000_artwork_passport_enum_cast_hotfix.sql` (Sprint 6 hotfix v3) | Re-emits `get_artwork_passport_for_viewer` to (a) cast the visibility enum to text before coalescing — `coalesce(v_aw.visibility::text, '')` — fixing `invalid input value for enum artwork_visibility: ""` on every viewer call; and (b) restore the real `public.claims` schema in the inner subquery (`c.claim_type` / `c.subject_profile_id` / `c.work_id`) — earlier hotfix attempts referenced fictional columns (`c.role`, `c.is_primary`, `c.sort_order`, `c.profile_id`, `c.artwork_id`) that produced `column c.role does not exist`. Phase 0 redaction is preserved (no `to_jsonb`, no `invite_email`); the `presence` block (`price`/`availability`/`description` boolean signals) is restored to keep the Sprint 5.2 UI gate semantics. **Paste guidance:** dollar tag is `$hotfix$` and the header comments deliberately omit single quotes — see `.cursor/rules/release-workflow.mdc §1-1` (apostrophes inside `--` line comments confuse the dashboard splitter and surface as `relation "v_aw" does not exist (42P01)` on Run). | Without this: every artwork detail click (logged in or out, follower or stranger) fails with either 22P02 (enum) or `column c.role does not exist`. **Apply immediately after Sprint 6 SQL; safe to re-run if v1/v2 of the hotfix was applied.** |
| `supabase/migrations/20260610000000_sprint6_1_principal_scoping_and_minimization.sql` (Sprint 6.1) | Re-emits the Relationship Desk RPC trio (`get_relationship_desk_for_owner`, `get_relationship_card_for_owner`, `upsert_relationship_private_note`) so each accepts `p_owner_profile_id` (default null → `auth.uid()`) and authorizes via `auth.uid() = v_owner OR is_active_account_delegate_writer(v_owner)`. **Drops the legacy 3/1/2-arg overloads** (otherwise PostgREST could resolve to the old un-validated body). Trims the desk row payload (`private_note_preview` → `has_private_note` + `private_note_updated_at`) and removes named viewer surveillance from the card (`shortlist_views` join + `last_viewed_at` gone; `was_shared_or_granted` boolean added). Re-emits `get_artwork_passport_for_viewer` once more to redact `created_by` for non-owner / non-delegate-writer viewers. **Paste guidance:** 4 sections, letters-only `$a$`/`$b$`/`$c$`/`$d$` tags, header comments are apostrophe-free — paste each section separately. | Without this: a delegate-writer using acting-as on `/my/relationships` would still see / write the delegate's OWN desk, not the principal's. Desk lists would still ship the raw 120-char note body. The Relationship Card would still expose `last_viewed_at` (named passive viewer signal). The artwork passport would still echo `created_by` to anonymous viewers. **Apply after the Sprint 6 hotfix.** |

### Sprint 6 — section-by-section apply (REQUIRED)

`20260608000000_sprint6_phase0_and_relationship_desk.sql` contains **7 PL/pgSQL
function bodies** + the `relationship_private_notes` table + 4 RLS policies in
a single file. Same dashboard tokenizer hazard as Sprint 5/5.2 — **do NOT paste
the whole file at once.** Open the file, highlight each `-- == SECTION N == ...`
block in turn (1 → 7), paste into the SQL Editor, press **Run**, repeat for all
7 sections. Every CREATE / DROP is `IF EXISTS / OR REPLACE / IF NOT EXISTS`,
so individual sections can be re-applied if a single one fails.

### Sprint 6 verification SQL

```sql
-- Phase 0 — passport DTO no longer surfaces invite_email or is_public?
-- (Manual sanity: select payload of a public artwork as anon, confirm
--  json keys do not include invite_email or is_public.)
select jsonb_pretty(public.get_artwork_passport_for_viewer('<some-public-artwork-id>'::uuid)) limit 1;

-- Phase 0 — attribution-safe room source RPC present?
select pg_get_function_arguments(p.oid)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.proname='resolve_room_source_from_token';
-- Expect: p_token text, p_artwork_id uuid

-- Sprint 6 — relationship_private_notes table + RLS?
select tablename, rowsecurity
from pg_tables
where schemaname='public' and tablename='relationship_private_notes';
-- Expect: rowsecurity = t

select policyname
from pg_policies
where schemaname='public' and tablename='relationship_private_notes'
order by policyname;
-- Expect: 4 policies (owner_select, owner_insert, owner_update, owner_delete).
-- Confirm there is NO policy targeting target_profile_id.

-- Sprint 6 — relationship desk + card + private-note + grant-lifecycle RPCs?
select count(*) as ok
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public'
  and p.proname in (
    'get_relationship_desk_for_owner','get_relationship_card_for_owner',
    'upsert_relationship_private_note','resolve_access_request_v2',
    'resolve_room_source_from_token'
  );
-- Expect: 5
```

### Sprint 5.2 — section-by-section apply (REQUIRED)

`20260607000000_relationship_access_enforcement_hardening.sql` contains **9 PL/pgSQL
function bodies** in a single file (validator + 4 re-creates + cancel + 2 redacted
RPCs + preview-as). Same dashboard tokenizer hazard as Sprint 5 — **do NOT paste
the whole file at once.** Open the file, highlight each `-- == SECTION N == ...`
block in turn, paste into the SQL Editor, press **Run**, repeat for all 9 sections.
Every CREATE / DROP is `IF EXISTS / OR REPLACE`, so individual sections can be
re-applied if a single one fails.

### Sprint 5.2 verification SQL

```sql
-- Validator helper present?
select count(*) as ok from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.proname='visibility_subject_belongs_to_owner';
-- Expect: 1

-- Hardened RPCs present (5 new + 4 re-created)?
select count(*) as ok from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public'
  and p.proname in (
    'visibility_subject_belongs_to_owner','cancel_access_request',
    'get_artwork_passport_for_viewer','get_room_for_viewer_by_token',
    'resolve_visibility_for_preview'
  );
-- Expect: 5

-- create_access_request now returns jsonb (not access_requests record)?
select pg_get_function_result(p.oid) as result_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.proname='create_access_request';
-- Expect: 'jsonb'

-- Direct requester UPDATE policy is gone?
select count(*) as should_be_zero from pg_policies
where schemaname='public'
  and tablename='access_requests'
  and policyname='access_requests_update_requester_cancel';
-- Expect: 0

-- Smoke: anon can call the redacted artwork RPC (rejected gracefully if input is null)?
select public.get_artwork_passport_for_viewer(null);
-- Expect: null (no error)
```

### Sprint 6.1 — section-by-section apply (REQUIRED)

`20260610000000_sprint6_1_principal_scoping_and_minimization.sql` contains
**4 PL/pgSQL function bodies** (one per RPC) plus DROPs of the legacy
overloads. Same dashboard tokenizer hazard as the other multi-function
files — **do NOT paste the whole file at once.** Open the file,
highlight each `-- == SECTION N ==` block in turn (1 → 4), paste into
the SQL Editor, press **Run**. The dollar tags are unique per section
(`$a$`/`$b$`/`$c$`/`$d$`) and the header comments deliberately avoid
single quotes so `relation "v_aw" does not exist (42P01)` cannot
re-occur. Every CREATE / DROP is `IF EXISTS / OR REPLACE`, so a single
section can be re-applied if it failed once.

### Sprint 6.1 verification SQL

```sql
-- 1) Relationship RPC trio is principal-aware (4 / 2 / 3 args).
select p.proname, pg_get_function_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public'
  and p.proname in (
    'get_relationship_desk_for_owner',
    'get_relationship_card_for_owner',
    'upsert_relationship_private_note'
  )
order by p.proname;
-- Expect (no other overloads):
--   get_relationship_card_for_owner(p_owner_profile_id uuid DEFAULT NULL, p_target_profile_id uuid DEFAULT NULL)
--   get_relationship_desk_for_owner(p_owner_profile_id uuid DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_status text DEFAULT NULL)
--   upsert_relationship_private_note(p_owner_profile_id uuid DEFAULT NULL, p_target_profile_id uuid DEFAULT NULL, p_note text DEFAULT NULL)

-- 2) Each principal-aware RPC actually runs is_active_account_delegate_writer.
select p.proname,
  pg_get_functiondef(p.oid) ilike '%is_active_account_delegate_writer(v_owner)%' as gates_on_delegate
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public'
  and p.proname in (
    'get_relationship_desk_for_owner',
    'get_relationship_card_for_owner',
    'upsert_relationship_private_note'
  );
-- Expect: gates_on_delegate = t for all 3 rows.

-- 3) Desk row payload no longer carries the raw note body.
select
  pg_get_functiondef(p.oid) ilike '%has_private_note%' as desk_uses_boolean,
  pg_get_functiondef(p.oid) not ilike '%private_note_preview%' as desk_no_preview
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.proname='get_relationship_desk_for_owner';
-- Expect: t / t

-- 4) Card RPC dropped passive viewer surveillance.
select
  pg_get_functiondef(p.oid) not ilike '%shortlist_views%' as card_no_views_join,
  pg_get_functiondef(p.oid) not ilike '%last_viewed_at%' as card_no_last_viewed,
  pg_get_functiondef(p.oid) ilike '%was_shared_or_granted%' as card_uses_shared_flag
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.proname='get_relationship_card_for_owner';
-- Expect: all three = t

-- 5) Public artwork passport redacts created_by for non-owner viewers.
select
  pg_get_functiondef(p.oid) ilike '%v_is_owner_or_delegate%' as gates_created_by,
  pg_get_functiondef(p.oid) ilike '%case when v_is_owner_or_delegate then v_aw.created_by%' as wraps_created_by
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.proname='get_artwork_passport_for_viewer';
-- Expect: t / t
```

### Sprint 6.1 — manual smoke (15 min)

**Acting-as principal correctness.**

1. Sign in as a delegate-writer who has an active `account` delegation against Principal P. Use the global header to enter acting-as for P. Visit `/my/relationships`. **UI:** the calm acting-as banner appears at the top ("Viewing relationships for …"). The desk shows P's relationships, NOT the delegate's own. Network: `get_relationship_desk_for_owner` payload includes `p_owner_profile_id = <P.id>`.
2. Still acting as P, open any row → save a private note. **DB:** `relationship_private_notes` row has `owner_profile_id = P.id` (NOT the delegate's id). `created_by` / `updated_by` is the delegate's `auth.uid()`.
3. Exit acting-as. Visit `/my/relationships` again → the desk now shows the delegate's own relationship context. Confirm P's note from step 2 is NOT visible here.
4. Sign in as the *target* of P's note (a third user). Confirm there is no surface that exposes the note (e.g. visit `/u/<P>`, `/people`, search). RLS keeps it owner-only.
5. Pretend to be a hostile delegate: in DevTools, manually call `supabase.rpc('get_relationship_desk_for_owner', { p_owner_profile_id: '<some random profile id you have no delegation against>' })`. **Expected:** RPC returns `[]` (RLS-style fail closed). Same probe on `get_relationship_card_for_owner` returns `null`. `upsert_relationship_private_note` raises `not authorized to act for this owner`.

**Surface minimization.**

6. As a normal owner, open `/my/relationships`. Confirm the desk row shows only a quiet "Private note" / "메모 있음" chip — never the first 120 characters of the note. The full body still appears inside the Relationship Card drawer.
7. Open the Relationship Card for a target who has been granted at least one room. Confirm the rooms section lists the room with "Approved" or "Shared" copy — there is NO "Viewed at HH:MM" line and no `last_viewed_at` field in the network response.

**Public artwork passport DTO.**

8. As anonymous (logged-out) browser, open any public artwork. DevTools → response of `get_artwork_passport_for_viewer` → confirm `artwork.created_by` is `null`. Sign in as the artwork's owner → reload → `artwork.created_by` is now the real uploader id. Sign in as a stranger → `created_by` is again `null`.

### Sprint 6 — manual smoke (15 min)

**Phase 0 (trust floor).**

1. Anonymous browser → open any public artwork detail. DevTools → Network → response of `get_artwork_passport_for_viewer`. Confirm the JSON does **not** include `invite_email`, `email`, `magicLink`, `share_token`, `authorization`, `cookie`, `bearer`, `is_public`, or any private nested metadata. Profile sub-object includes only `id / username / display_name / avatar_url / bio / main_role / roles`.
2. Sign in as a stranger to Artist A. Set A's price audience to **Mutuals** (so price is gated for the stranger). Open A's artwork detail. **UI:** the price block renders the calm gate. Click **Ask about this work**. **UI:** inquiry form opens. Submit a message. **DB / Network:** the inquiry insert succeeds; the inquiry source payload does not contain raw price values; `beta_analytics_events` does not contain the message body.
3. Sign in as another stranger. Visit `/artwork/<X>?fromRoom=<random-uuid>`. **Network:** `resolve_room_source_from_token` returns `{ room_id: null, source_surface: null }` (the token is unrelated). Visit `/artwork/<Y>?fromRoom=<valid-token-but-Y-not-in-room>`. **Network:** still returns null (artwork-not-in-room guard). Visit `/artwork/<Z>?fromRoom=<valid-token-AND-Z-in-room>`. **Network:** returns `{ room_id: <uuid>, source_surface: 'room' }` only — never `title`, `description`, or `owner_*`.

**Phase B + C (Relationship Desk + Card + Private Notes).**

4. Sign in as Artist A. Visit `/my/relationships`.
   - **UI:** desk loads with quiet rows for everyone connected (followers, requesters, inquirers, grantees, anyone with a private note). LaneChips filter switches between All / Pending requests / Inquiries / Approved viewers / Followers / Notes.
   - **Network:** `get_relationship_desk_for_owner` is called with `p_status` matching the active filter. Response is owner-only.
5. Click **Open relationship** on any row. **UI:** drawer opens with profile header, sections (requests / grants / inquiries / rooms / private note), and a deterministic suggested next-action button at the bottom.
6. Type a private note (try "remember to follow up after the show"), press **Save note**.
   - **UI:** "Saved at HH:MM:SS" appears.
   - **DB:** `relationship_private_notes` row inserted with `owner_profile_id = A.id`.
   - **DB:** the new `beta_analytics_events` row for `relationship_private_note_saved` has payload `{ surface: "relationship_card", action_kind: "save" }` — **no `note` / `noteDraft` / `private_note` keys**.
7. Sign in as the *target* user from the previous step. Confirm there is no surface that exposes A's private note about them (open `/u/<A>`, `/people`, search). The note must remain owner-only.

**Phase D (Private Room v2).**

8. Sign in as Artist A. Open `/my/shortlists/<roomId>`. Confirm the calm Relationship Desk link is visible next to the RoomVisibilityPill.
9. Open the room share link as a stranger.
   - **Gated state**: gate copy + access request CTA are visible; no items in DOM.
   - **Authorized state** (after A approves the access request): items grid renders, header shows the new "Ask about a work in this room" CTA. Click it → lands on the first artwork's detail with `?fromRoom=<token>`. **Network:** `private_room_v2_viewed` payload contains `subject_id` + `status` only — no token, no room note.

### Sprint 5.2 — manual redaction smoke (10 min)

Two browser sessions: Artist A (logged in) and Viewer B (logged in but a
stranger to A). Always open DevTools → Network before each step.

1. Artist A: `/my/visibility` → set preset to **Private Studio**, save.
2. Viewer B: open A's `/artwork/<id>` for any public artwork.
   - **Network:** `get_artwork_passport_for_viewer` response — `artwork.pricing_mode`, `price_*`, `fx_*`, `ownership_status`, `story` are all `null`. The `visibility.{price,availability,description}.can_view` are all `false`.
   - **UI:** price/availability/description gates render; no flash of the real values; no raw price text anywhere.
3. Viewer B: click *Request access* on the price gate, type a private message, submit.
   - **DB / Network:** `beta_analytics_events` row payload **does not** contain the message body.
4. Artist A: `/my/access-requests` → approve B's request.
5. Viewer B: refresh `/artwork/<id>`.
   - **UI:** price now shows.
6. Artist A: `/my/shortlists/<roomId>` → set room audience to **Approved viewers**.
7. Viewer B: open A's old room share link.
   - **Network:** `get_room_for_viewer_by_token` response — `items` is `[]`, `can_view` is `false`. Response payload contains no token.
   - **UI:** gated room panel only; item grid is not in the DOM.
8. Artist A: approve B for the room.
9. Viewer B: refresh the room — items now visible.
10. On any follow-gated artwork field (e.g. set the artwork's price audience to **Followers**), Viewer B clicks the **Follow** CTA inside the gate. Confirm the follow really executes (FollowButton flips to *Following* / *Requested*); the gate disappears (or stays as request-pending if the target is a private profile).

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
