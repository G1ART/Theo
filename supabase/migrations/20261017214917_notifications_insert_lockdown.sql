-- 2026-10-17 — Only the database writes notifications.
--
-- notifications_insert was "with check (true)" for every role, anon
-- included, so any caller of the public API could put a fake alert in
-- anyone's list. _record_delegation_notification(user, type, actor,
-- payload) inserts whatever it is given and was executable by anon and
-- authenticated, which is the same hole through RPC.
--
-- No client code, server route or script inserts into notifications.
-- Every alert is written by a SECURITY DEFINER function owned by
-- postgres, so RLS does not apply to it, and the actor comes from a row
-- the caller could only write as themselves:
--   follow, follow_request, follow_request_accepted  follows triggers
--     (insert: follower_id = auth.uid())
--   connection_message  connection_messages trigger (sender_id = auth.uid())
--   price_inquiry, price_inquiry_reply  price_inquiries triggers
--     (inquirer_id = auth.uid(); reply needs can_reply_to_price_inquiry),
--     resend_price_inquiry_notification (the inquirer, unanswered only)
--   claim_request, claim_confirmed, claim_rejected  claims triggers
--     (subject_profile_id = auth.uid(); confirm by the artist or delegate)
--   board_save, board_public  shortlist triggers (owner, editor, delegate)
--   like  artwork_likes trigger (user_id = auth.uid())
--   new_work  artworks triggers
--   delegation_*  delegation RPCs that check the caller, through
--     _record_delegation_notification
--   orphan_external_claimed  claim_orphan_external_artist_as_self
--
-- After this, clients cannot insert notifications or call the delegation
-- helper, and can update only read_at / is_read on their own rows. New
-- alert types must be written by a SECURITY DEFINER trigger or RPC.
--
-- No plpgsql functions here.

drop policy if exists notifications_insert on public.notifications;

revoke insert on public.notifications from anon, authenticated;
revoke update on public.notifications from anon, authenticated;
grant update (read_at, is_read) on public.notifications to authenticated;

revoke all on function public._record_delegation_notification(uuid, text, uuid, jsonb)
  from public, anon, authenticated;
