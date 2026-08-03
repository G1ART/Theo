-- 20260803120000_connection_message_thread_categorization.sql
--
-- Sprint C.M (2026-08-03) — Messages redesign: Primary / General / New Request.
--
-- Product change: /my/messages now surfaces three inboxes and four per-
-- thread state labels (Received / Opened / Sent / Read). To make this
-- queryable without a per-message scan we introduce
-- `public.connection_message_threads`, one row per (participant_key)
-- holding the current category, lifecycle timestamps, and last-message
-- pointer. Prior to this migration only the `participant_key` COLUMN on
-- `connection_messages` existed — the *table* is created here for the
-- first time (despite the older migration filename suggesting otherwise;
-- that file only added the column + `list_connection_conversations` RPC).
--
-- Categories:
--   - `request` : first message from a non-mutual sender; recipient must
--                 explicitly accept before it moves into Primary/General.
--   - `general` : accepted, but the two accounts are not in mutual follow.
--   - `primary` : accepted AND mutual follow (or auto-accepted because
--                 the two were already mutual at first-insert time).
--
-- Lifecycle:
--   - New message: `sync_connection_message_thread_on_insert` trigger
--     upserts the thread row. If missing and mutual → primary+auto-accept;
--     if missing and non-mutual → request. If the thread was declined,
--     the new message re-opens it as request again (declined_at cleared).
--   - `accept_connection_message_thread(p_peer)` : recipient accepts the
--     request; category flips to primary (if mutual) or general.
--   - `decline_connection_message_thread(p_peer)` : recipient soft-hides
--     the thread with `declined_at = now()`. The thread stays as-is (so
--     the same participant_key can re-wake it on the next message).
--
-- The Dashboard SQL Editor tokenizer splits pasted text by `;` before
-- shipping it, and can leak the body of a dollar-quoted PL/pgSQL function
-- when the body contains nested `if`/`update`/`select ... into` blocks.
-- To stay safe (see docs/HANDOFF 2026-05-16 note), each PL/pgSQL block
-- below lives in its own SECTION so the operator runs them one-at-a-time.
-- Dollar tags use letters-only per the same guideline.

-- == SECTION 1 == connection_message_threads table + indexes + RLS ==========

create table if not exists public.connection_message_threads (
  participant_key text primary key,
  -- `user_a` = min(uuid), `user_b` = max(uuid). Matches the generated
  -- `connection_messages.participant_key` expression so we can join by
  -- pk without translating either side.
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  category text not null default 'request'
    check (category in ('primary', 'general', 'request')),
  first_accepted_at timestamptz,
  declined_at timestamptz,
  last_message_at timestamptz not null default now(),
  last_state_computed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connection_message_threads_user_order
    check (user_a < user_b)
);

create index if not exists idx_connection_message_threads_user_a
  on public.connection_message_threads (user_a, last_message_at desc);
create index if not exists idx_connection_message_threads_user_b
  on public.connection_message_threads (user_b, last_message_at desc);
create index if not exists idx_connection_message_threads_category
  on public.connection_message_threads (category, last_message_at desc);

alter table public.connection_message_threads enable row level security;

drop policy if exists cmt_select_participants
  on public.connection_message_threads;
create policy cmt_select_participants on public.connection_message_threads
  for select to authenticated
  using (auth.uid() = user_a or auth.uid() = user_b);

-- No direct INSERT / UPDATE / DELETE policies: writes flow exclusively
-- through the SECURITY DEFINER trigger + accept/decline RPCs below.
-- Callers hitting the table directly will fail RLS, which is desired
-- (single source of truth for thread lifecycle).

-- == SECTION 2 == Backfill existing threads from connection_messages ========

with pairs as (
  -- `participant_key` is already `least(s,r)::text || ':' || greatest(s,r)::text`
  -- so we can recover the ordered endpoints by splitting it — no need to
  -- re-min/max across sender_id/recipient_id (which would be awkward
  -- because both columns can hold either user across the group).
  select
    cm.participant_key,
    split_part(cm.participant_key, ':', 1)::uuid as user_a,
    split_part(cm.participant_key, ':', 2)::uuid as user_b,
    max(cm.created_at) as last_at,
    min(cm.created_at) as first_at
  from public.connection_messages cm
  group by cm.participant_key
)
insert into public.connection_message_threads
  (participant_key, user_a, user_b, category, first_accepted_at,
   last_message_at, created_at, updated_at)
select
  p.participant_key,
  p.user_a,
  p.user_b,
  -- Existing threads: trust the historical relationship. If the two
  -- users mutually follow each other today → primary; otherwise the
  -- pair has some other reason to share history → general. Neither
  -- case leaves it as `request` since both parties clearly opted in
  -- prior to this migration.
  case
    when exists (
      select 1 from public.follows f1
      where f1.follower_id = p.user_a
        and f1.following_id = p.user_b
        and f1.status = 'accepted'
    )
      and exists (
        select 1 from public.follows f2
        where f2.follower_id = p.user_b
          and f2.following_id = p.user_a
          and f2.status = 'accepted'
      )
    then 'primary'
    else 'general'
  end as category,
  p.first_at,
  p.last_at,
  p.first_at,
  now()
from pairs p
on conflict (participant_key) do nothing;

-- == SECTION 3 == sync_connection_message_thread_on_insert trigger =========

create or replace function public.sync_connection_message_thread_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $a$
declare
  v_key text;
  v_a uuid;
  v_b uuid;
  v_mutual boolean;
  v_existing record;
begin
  -- The generated column is populated by the time the AFTER trigger fires.
  v_key := new.participant_key;
  v_a := least(new.sender_id::text, new.recipient_id::text)::uuid;
  v_b := greatest(new.sender_id::text, new.recipient_id::text)::uuid;

  v_existing := null;
  select *
    into v_existing
    from public.connection_message_threads
    where participant_key = v_key;

  if v_existing.participant_key is null then
    -- First message ever: decide category from current follow graph.
    v_mutual := exists (
      select 1 from public.follows f1
      where f1.follower_id = v_a
        and f1.following_id = v_b
        and f1.status = 'accepted'
    ) and exists (
      select 1 from public.follows f2
      where f2.follower_id = v_b
        and f2.following_id = v_a
        and f2.status = 'accepted'
    );

    insert into public.connection_message_threads
      (participant_key, user_a, user_b, category,
       first_accepted_at, last_message_at, updated_at)
    values (
      v_key,
      v_a,
      v_b,
      case when v_mutual then 'primary' else 'request' end,
      case when v_mutual then now() else null end,
      new.created_at,
      now()
    );
    return new;
  end if;

  -- Existing thread: bump last_message_at + reopen a declined thread.
  update public.connection_message_threads
     set last_message_at = new.created_at,
         updated_at = now(),
         declined_at = case
           when declined_at is not null then null
           else declined_at
         end,
         -- If the thread was declined we drop it back to `request` so the
         -- recipient sees the decline reset in the New Request tab.
         category = case
           when declined_at is not null then 'request'
           else category
         end
   where participant_key = v_key;

  return new;
end
$a$;

drop trigger if exists trg_sync_connection_message_thread
  on public.connection_messages;
create trigger trg_sync_connection_message_thread
after insert on public.connection_messages
for each row
execute function public.sync_connection_message_thread_on_insert();

grant execute on function public.sync_connection_message_thread_on_insert()
  to authenticated;

-- == SECTION 4 == accept_connection_message_thread RPC =====================

create or replace function public.accept_connection_message_thread(
  p_peer uuid
)
returns public.connection_message_threads
language plpgsql
security definer
set search_path = public
as $b$
declare
  v_me uuid;
  v_key text;
  v_a uuid;
  v_b uuid;
  v_mutual boolean;
  v_is_recipient boolean;
  v_row public.connection_message_threads;
begin
  v_me := auth.uid();
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_peer is null or p_peer = v_me then
    raise exception 'invalid peer' using errcode = '22023';
  end if;

  v_a := least(v_me::text, p_peer::text)::uuid;
  v_b := greatest(v_me::text, p_peer::text)::uuid;
  v_key := v_a::text || ':' || v_b::text;

  -- Only the *recipient* of at least one message in this thread may
  -- accept the request. The sender of the first message must not be
  -- able to fake-accept their own outbound request by opening the
  -- thread page (auto-accept fires on `/my/messages/[peer]` mount).
  v_is_recipient := exists (
    select 1 from public.connection_messages cm
    where cm.participant_key = v_key
      and cm.recipient_id = v_me
  );

  if not v_is_recipient then
    -- Silent no-op for the initiator opening their own outbound
    -- thread page. We still surface the current row so the client
    -- can read category/state without an extra round-trip.
    select * into v_row
      from public.connection_message_threads
      where participant_key = v_key
        and (user_a = v_me or user_b = v_me);
    if v_row.participant_key is null then
      raise exception 'thread not found' using errcode = '02000';
    end if;
    return v_row;
  end if;

  v_mutual := exists (
    select 1 from public.follows f1
    where f1.follower_id = v_a
      and f1.following_id = v_b
      and f1.status = 'accepted'
  ) and exists (
    select 1 from public.follows f2
    where f2.follower_id = v_b
      and f2.following_id = v_a
      and f2.status = 'accepted'
  );

  update public.connection_message_threads
     set category = case when v_mutual then 'primary' else 'general' end,
         first_accepted_at = coalesce(first_accepted_at, now()),
         declined_at = null,
         updated_at = now()
   where participant_key = v_key
     and (user_a = v_me or user_b = v_me)
   returning * into v_row;

  if v_row.participant_key is null then
    raise exception 'thread not found' using errcode = '02000';
  end if;

  return v_row;
end
$b$;

grant execute on function public.accept_connection_message_thread(uuid)
  to authenticated;

-- == SECTION 5 == decline_connection_message_thread RPC ====================

create or replace function public.decline_connection_message_thread(
  p_peer uuid
)
returns public.connection_message_threads
language plpgsql
security definer
set search_path = public
as $c$
declare
  v_me uuid;
  v_key text;
  v_a uuid;
  v_b uuid;
  v_row public.connection_message_threads;
begin
  v_me := auth.uid();
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_peer is null or p_peer = v_me then
    raise exception 'invalid peer' using errcode = '22023';
  end if;

  v_a := least(v_me::text, p_peer::text)::uuid;
  v_b := greatest(v_me::text, p_peer::text)::uuid;
  v_key := v_a::text || ':' || v_b::text;

  update public.connection_message_threads
     set declined_at = now(),
         updated_at = now()
   where participant_key = v_key
     and (user_a = v_me or user_b = v_me)
   returning * into v_row;

  if v_row.participant_key is null then
    raise exception 'thread not found' using errcode = '02000';
  end if;

  return v_row;
end
$c$;

grant execute on function public.decline_connection_message_thread(uuid)
  to authenticated;

-- == SECTION 6 == list_connection_conversations_v2 RPC =====================

create or replace function public.list_connection_conversations_v2(
  p_category text default null,
  p_limit int default 20,
  p_before_ts timestamptz default null,
  p_include_declined boolean default false
)
returns table (
  participant_key text,
  other_user_id uuid,
  category text,
  first_accepted_at timestamptz,
  declined_at timestamptz,
  last_message_id uuid,
  last_body text,
  last_created_at timestamptz,
  last_sender_id uuid,
  last_read_at timestamptz,
  last_is_from_me boolean,
  unread_count bigint,
  state text
)
language sql
stable
security invoker
set search_path = public
as $d$
  with me as (select auth.uid() as uid),
  -- Every message where the caller is a participant, ranked newest first
  -- inside each thread. This lets us pick the last-message metadata in a
  -- single scan.
  ranked as (
    select
      cm.id,
      cm.participant_key,
      cm.sender_id,
      cm.recipient_id,
      cm.body,
      cm.read_at,
      cm.created_at,
      row_number() over (
        partition by cm.participant_key
        order by cm.created_at desc
      ) as rn
    from public.connection_messages cm
    where cm.sender_id = (select uid from me)
       or cm.recipient_id = (select uid from me)
  ),
  latest as (
    select * from ranked where rn = 1
  ),
  unread as (
    select
      participant_key,
      count(*)::bigint as unread_count
    from public.connection_messages
    where recipient_id = (select uid from me)
      and read_at is null
    group by participant_key
  )
  select
    t.participant_key,
    case when t.user_a = (select uid from me) then t.user_b else t.user_a end
      as other_user_id,
    t.category,
    t.first_accepted_at,
    t.declined_at,
    l.id as last_message_id,
    l.body as last_body,
    l.created_at as last_created_at,
    l.sender_id as last_sender_id,
    l.read_at as last_read_at,
    (l.sender_id = (select uid from me)) as last_is_from_me,
    coalesce(u.unread_count, 0) as unread_count,
    -- State label rules (Received / Opened / Sent / Read):
    --   * Last message came to me & I haven't read it   → received
    --   * Last message came to me & I have read it     → opened
    --   * Last message from me & peer hasn't read it   → sent
    --   * Last message from me & peer has read it      → read
    -- Recipient-side read is derived from `connection_messages.read_at`
    -- which the receiver flips (RLS scoped to `recipient_id = auth.uid()`).
    case
      when l.sender_id <> (select uid from me) and l.read_at is null then 'received'
      when l.sender_id <> (select uid from me) and l.read_at is not null then 'opened'
      when l.sender_id = (select uid from me) and l.read_at is null then 'sent'
      when l.sender_id = (select uid from me) and l.read_at is not null then 'read'
      else 'received'
    end as state
  from public.connection_message_threads t
  join latest l on l.participant_key = t.participant_key
  left join unread u on u.participant_key = t.participant_key
  where (t.user_a = (select uid from me) or t.user_b = (select uid from me))
    and (p_category is null or t.category = p_category)
    and (p_include_declined or t.declined_at is null)
    and (p_before_ts is null or t.last_message_at < p_before_ts)
  order by t.last_message_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$d$;

grant execute on function public.list_connection_conversations_v2(
  text, int, timestamptz, boolean
) to authenticated;
