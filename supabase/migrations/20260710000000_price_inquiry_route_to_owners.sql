-- Route price inquiries to current OWNERS (collector/gallery), not just the
-- artist + consignment-style delegates.
--
-- Product philosophy (confirmed 2026-07-10):
--   (1) Artist-owned, no contingency        -> artist only.
--   (2) Gallery consignment (INVENTORY) OR
--       gallery/collector ownership (OWNS)   -> the holder receives the
--       inquiry AND both holder + artist are notified / can view / can reply.
--
-- Before this migration `get_current_delegate_ids()` only returned
-- INVENTORY/CURATED/EXHIBITED (consignment-style) claim subjects, so an OWNS
-- holder was silently excluded from inquiry recipients and could neither see
-- nor reply to inquiries on a work they own. Worse, `price_inquiry_artist_id`
-- resolved to the OWNS holder ONLY when the artist was an external (non-
-- onboarded) artist — so ownership routing was an accidental side effect of a
-- fallback, and flipped depending on whether the artist had an account.
--
-- This broadens the single shared helper. `get_price_inquiry_recipient_ids`,
-- `can_reply_to_price_inquiry`, and `can_select_price_inquiry` all build on
-- `get_current_delegate_ids`, so the fix propagates to notification fan-out
-- AND row-level security in one place, without touching the account-delegate
-- clauses layered on top in later migrations.
--
-- OWNS is a standing relationship (no period_status semantics), so it is
-- included whenever status='confirmed', independent of period_status. Claims
-- default to status='confirmed' on self-upload; a claim *requested* on someone
-- else's work stays 'pending' until confirmed, so unconfirmed ownership never
-- routes inquiries.
--
-- REVOCABLE DECISION (2026-07-10): this notifies the ARTIST even for
-- collector-owned (secondary-market) works, matching the stated philosophy.
-- If resale privacy later matters (a collector reselling may not want the
-- artist informed), split OWNS by holder role inside
-- get_price_inquiry_recipient_ids (gallery -> notify artist; collector ->
-- owner only) rather than reverting this helper.

create or replace function public.get_current_delegate_ids(p_artwork_id uuid)
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select distinct c.subject_profile_id
  from public.claims c
  where c.work_id = p_artwork_id
    and c.status = 'confirmed'
    and (
      -- Consignment-style delegates: time-bounded, current period only.
      (
        c.claim_type in ('INVENTORY', 'CURATED', 'EXHIBITED')
        and (c.period_status = 'current' or c.period_status is null)
      )
      -- Ownership: standing relationship, no period gating.
      or c.claim_type = 'OWNS'
    );
$$;

comment on function public.get_current_delegate_ids(uuid) is
  'Current holders of a work for price-inquiry routing/RLS: confirmed INVENTORY/CURATED/EXHIBITED delegates (current period) + confirmed OWNS owners (collector/gallery). Shared by get_price_inquiry_recipient_ids, can_reply_to_price_inquiry, can_select_price_inquiry.';
