-- Acting-as a principal on /my/network.
--
-- Accepted follow edges are already readable by anyone. Pending requests
-- and accept/decline were pinned to auth.uid(), so an operator acting-as
-- the principal still saw and answered their own invites.
--
-- The existing one-argument accept_follow_request(uuid) and
-- decline_follow_request(uuid) stay in place. Callers that are not
-- acting-as keep using them.

-- == SECTION 1 == read the principal's follow edges, including pending
-- Highlight this section and Run by itself.

-- is_account_delegate_of(uuid) is not on production. The live helper is
-- is_active_account_delegate_writer(uuid), same check as SECTION 2 and 3.
drop policy if exists follows_select_account_delegate on public.follows;
create policy follows_select_account_delegate on public.follows
  for select to authenticated
  using (
    public.is_active_account_delegate_writer(follower_id)
    or public.is_active_account_delegate_writer(following_id)
  );

-- == SECTION 2 == accept a follow request on behalf of the principal
-- Highlight this section and Run by itself.

create or replace function public.accept_follow_request(
  p_follower uuid,
  p_subject uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $accept$
declare
  v_uid     uuid := auth.uid();
  v_owner   uuid;
  v_updated int;
begin
  if v_uid is null then
    raise exception 'auth required';
  end if;
  if p_follower is null then
    raise exception 'invalid follower';
  end if;

  v_owner := p_subject;
  if v_owner is null or v_owner = v_uid then
    v_owner := v_uid;
  elsif not public.is_active_account_delegate_writer(v_owner) then
    raise exception 'forbidden: caller is not an active account delegate writer for subject';
  end if;

  update public.follows
     set status = 'accepted'
   where follower_id  = p_follower
     and following_id = v_owner
     and status       = 'pending';
  get diagnostics v_updated = row_count;

  delete from public.notifications
   where user_id  = v_owner
     and actor_id = p_follower
     and type     = 'follow_request';

  return v_updated > 0;
end;
$accept$;

grant execute on function public.accept_follow_request(uuid, uuid) to authenticated;

-- == SECTION 3 == decline a follow request on behalf of the principal
-- Highlight this section and Run by itself.

create or replace function public.decline_follow_request(
  p_follower uuid,
  p_subject uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $decline$
declare
  v_uid     uuid := auth.uid();
  v_owner   uuid;
  v_deleted int;
begin
  if v_uid is null then
    raise exception 'auth required';
  end if;
  if p_follower is null then
    raise exception 'invalid follower';
  end if;

  v_owner := p_subject;
  if v_owner is null or v_owner = v_uid then
    v_owner := v_uid;
  elsif not public.is_active_account_delegate_writer(v_owner) then
    raise exception 'forbidden: caller is not an active account delegate writer for subject';
  end if;

  delete from public.follows
   where follower_id  = p_follower
     and following_id = v_owner
     and status       = 'pending';
  get diagnostics v_deleted = row_count;

  delete from public.notifications
   where user_id  = v_owner
     and actor_id = p_follower
     and type     = 'follow_request';

  return v_deleted > 0;
end;
$decline$;

grant execute on function public.decline_follow_request(uuid, uuid) to authenticated;
