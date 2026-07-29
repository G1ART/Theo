# Auth Magic-Link Timing vs. External-Artist Auto-Link (Part C)

**Date:** 2026-07-29
**Status:** Investigation only — no code changes from this doc. See Part A/D
of the same release for the actual feature work this informs.

## Question

`handle_auth_user_created_link_external_artist` (trigger on `auth.users`)
auto-links `external_artists` rows by email match as soon as a new
`auth.users` row appears. `signInWithOtp` / magic-link signup creates that
`auth.users` row *before* the user clicks the confirmation link in their
inbox. Does the trigger therefore link (and start moving claims/artworks)
to an account the user hasn't actually confirmed control of yet — and if
so, does that create a window where Part A's price-inquiry email dispatch
could double-send (once via the in-app path post-link, once via the
opt-in email path) or send to someone who isn't really the artist yet?

## What happens today (static analysis of the trigger)

Read directly from the current function body
(`supabase/migrations/20260728240005_bilingual_rpc_extensions.sql`
SECTION 5, layered again in this release's
`20260729110000_auto_create_claim_on_external_artist_link.sql` SECTION 2):

```sql
drop trigger if exists on_auth_user_created_link_external_artist on auth.users;
create trigger on_auth_user_created_link_external_artist
  after insert on auth.users
  for each row execute function public.handle_auth_user_created_link_external_artist();
```

This is an unconditional `AFTER INSERT` trigger — it does **not** check
`new.email_confirmed_at`. In Supabase's default email/OTP flow, the
`auth.users` row is created at the moment `signInWithOtp` (or
`signUp`) is called, i.e. as soon as the user submits their email —
**before** they open their inbox and click the link. So:

- `claimed_profile_id` on the matching `external_artists` row(s) is set,
  claims are migrated (`external_artist_id → artist_profile_id`), and
  `artworks.artist_id` is updated **immediately at signup-request time**,
  regardless of whether the user ever confirms the email.
- The new `profiles` row for that user also exists at this point (the
  trigger upserts it), but the user cannot actually log in / obtain a
  session until they click the confirmation link (Supabase gates session
  issuance on `email_confirmed_at`, not on `auth.users` row existence).

This directly answers Part A's open question: **yes**, the trigger sets
`claimed_profile_id` even for not-yet-confirmed users. This means
`request_price_inquiry_email_dispatch`'s guard
(`skip if ea.claimed_profile_id is not null`) is correct as specified —
no adjustment was needed. In fact the guard is doubly safe: once
`claimed_profile_id` is set, the trigger also nulls out
`claims.external_artist_id` for the migrated claims in the same
transaction, so the dispatch RPC's own candidate query (`claims where
external_artist_id is not null`) would no longer even surface that
external artist as a candidate.

## Why this is OK

- **No access is granted early.** Setting `claimed_profile_id` and
  moving claims/`artist_id` only changes *attribution* rows the inviter
  already made public/visible in their own catalog. It does not grant
  the not-yet-confirmed account any session, any write capability, or
  any private data. Until the user clicks the confirmation link, the
  `auth.users` row is inert — no one can authenticate as it.
- **The email-delivery + click-through gate is still the real
  security boundary.** An attacker who doesn't control the invited
  inbox cannot complete the flow (they'd need to click the confirmation
  link that Supabase emails to that address), so they can never actually
  obtain a session for the linked profile even though the row-level
  linking already happened.
- **The linking is reversible in spirit, not just structurally.** If the
  wrong `auth.users` row somehow got created for an email that later
  never confirms, the profile shell simply sits unused; it does not
  retroactively unlink or corrupt the original external-artist row
  beyond the (harmless, if unconfirmed) attribution flip.

## Known risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Curator/gallery typos the artist's email at invite time, and a stranger who happens to own that mailbox later signs up with it | Attribution moves to the stranger's shell profile, but they still can't do anything with it unless they *also* click a confirmation link tied to that inbox — same bar as any account-takeover-by-typo scenario across the industry. Recommend: allow the original inviter to see + dispute an unexpected auto-link (future work; not blocking). |
| Third party deliberately signs up with an email string that matches an `invite_email` they don't own, hoping to intercept a pending invite | They still need the actual confirmation email delivered to that inbox to get a session — they cannot silently "grab" the artist identity without also controlling the mailbox. |
| Race: dispatch RPC runs in the tiny window between `auth.users` insert and claim migration completing in the same trigger transaction | Not possible in practice — the trigger runs the `claimed_profile_id` update and the claims migration in the *same* Postgres transaction/function invocation, so external callers never observe an intermediate state via a separate connection (transactional isolation). |
| Opt-in inquiry email sent to an artist who *already* got auto-linked (double notification: one in-app, one email) | Covered by Part A's `claimed_profile_id is not null` skip (see above) — confirmed correct, no change needed. |

## Recommendation

**No code change needed for Part C itself.** The existing trigger
behavior (link at `auth.users` INSERT time, not at confirmation time) is
safe under the analysis above, and Part A's dispatch RPC already guards
correctly against it. This doc exists to make that reasoning explicit and
auditable for future contributors touching either the trigger or the
price-inquiry email pipeline.

## On production log verification

This investigation was written by a subagent with **no MCP / Supabase
log tool access** in its execution environment (shell + file tools
only) — `get_logs` could not be called to empirically sample
`auth.users.created_at` vs. `email_confirmed_at` vs.
`external_artists.claimed_profile_id`-flip timestamps from production.
The conclusions above are derived from **static analysis of the trigger
SQL** (which is definitive for the specific yes/no question Part A
depended on — the trigger's `AFTER INSERT` semantics are unconditional
and don't require runtime evidence to reason about), not from sampled
log timestamps.

**Not verifiable via current tooling; recommend an operator with
Supabase MCP/dashboard log access re-run the empirical sampling
described in the original task** (3-5 example external-artist invite
events, comparing `auth.users.created_at`, `email_confirmed_at`, and the
`external_artists` claim timestamp) as a follow-up sanity check — but
this is not blocking, since the static trigger analysis already answers
the question the empirical check was meant to resolve.
