-- 2026-10-17 — Price inquiry "notify again": once per 24 hours per
-- inquiry, at most 3 times (the first inquiry alert is not counted).
-- Enforced here, so calling an RPC directly cannot go past it.
--
-- price_inquiry_renotifies logs each re-notify and has no client access.
-- Past re-notifies come from notifications: a price_inquiry alert batch for
-- one inquiry written after the inquiry (the first alert shares the
-- inquiry's transaction time; batches shared by several inquiries were
-- system backfills). Inquiries without such a batch start at 0.
--
-- The 24 hours count from the later of the inquiry and the last re-notify.
--
-- Apply section by section in the SQL editor.

-- == SECTION 1 == log table and history

create table if not exists public.price_inquiry_renotifies (
  id bigint generated always as identity primary key,
  inquiry_id uuid not null references public.price_inquiries(id) on delete cascade,
  sent_at timestamptz not null default now(),
  recipients integer not null default 0,
  source text not null default 'resend' check (source in ('resend', 'history'))
);

create index if not exists idx_price_inquiry_renotifies_inquiry
  on public.price_inquiry_renotifies (inquiry_id, sent_at desc);

alter table public.price_inquiry_renotifies enable row level security;
revoke all on public.price_inquiry_renotifies from public, anon, authenticated;

insert into public.price_inquiry_renotifies (inquiry_id, sent_at, recipients, source)
select b.inquiry_id, b.batch_at, b.rows_in_batch, 'history'
from (
  select pi.id as inquiry_id, n.created_at as batch_at, count(*)::int as rows_in_batch
  from public.price_inquiries pi
  join public.notifications n
    on n.type = 'price_inquiry'
   and n.payload->>'inquiry_id' = pi.id::text
   and n.created_at > pi.created_at
  group by pi.id, n.created_at
) b
where not exists (
  select 1 from public.notifications o
  where o.type = 'price_inquiry'
    and o.created_at = b.batch_at
    and o.payload->>'inquiry_id' is distinct from b.inquiry_id::text
)
and not exists (
  select 1 from public.price_inquiry_renotifies r
  where r.inquiry_id = b.inquiry_id and r.sent_at = b.batch_at
);

-- == SECTION 2 == price_inquiry_renotify_info (internal)

create or replace function public.price_inquiry_renotify_info(p_inquiry_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $a$
declare
  v_pi public.price_inquiries;
  v_used int;
  v_last timestamptz;
  v_next timestamptz;
  v_reason text;
begin
  v_pi := (select p from public.price_inquiries p where p.id = p_inquiry_id);
  if v_pi.id is null then
    return null;
  end if;
  v_used := (select count(*)::int from public.price_inquiry_renotifies r where r.inquiry_id = v_pi.id);
  v_last := (select max(r.sent_at) from public.price_inquiry_renotifies r where r.inquiry_id = v_pi.id);
  v_next := greatest(v_pi.created_at, coalesce(v_last, v_pi.created_at)) + interval '24 hours';
  v_reason := case
    when v_pi.replied_at is not null or coalesce(v_pi.inquiry_status, '') in ('replied', 'closed') then 'replied'
    when v_used >= 3 then 'limit'
    when now() < v_next then 'too_soon'
    else 'ok'
  end;
  return jsonb_build_object(
    'used', v_used,
    'limit', 3,
    'remaining', greatest(0, 3 - v_used),
    'last_at', v_last,
    'next_at', case when v_reason = 'too_soon' then v_next end,
    'can', v_reason = 'ok',
    'reason', v_reason
  );
end;
$a$;

revoke all on function public.price_inquiry_renotify_info(uuid) from public, anon, authenticated;

-- == SECTION 3 == price_inquiry_renotify_state (inquirer only)

create or replace function public.price_inquiry_renotify_state(p_inquiry_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $a$
declare
  v_inquirer uuid;
begin
  v_inquirer := (select p.inquirer_id from public.price_inquiries p where p.id = p_inquiry_id);
  if v_inquirer is null or v_inquirer is distinct from auth.uid() then
    return null;
  end if;
  return public.price_inquiry_renotify_info(p_inquiry_id);
end;
$a$;

revoke all on function public.price_inquiry_renotify_state(uuid) from public, anon;
grant execute on function public.price_inquiry_renotify_state(uuid) to authenticated;

-- == SECTION 4 == renotify_price_inquiry

create or replace function public.renotify_price_inquiry(p_inquiry_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $a$
declare
  v_pi public.price_inquiries;
  v_state jsonb;
  v_recipient uuid;
  v_count int := 0;
begin
  perform 1 from public.price_inquiries p where p.id = p_inquiry_id for update;
  v_pi := (select p from public.price_inquiries p where p.id = p_inquiry_id);
  if v_pi.id is null or v_pi.inquirer_id is distinct from auth.uid() then
    return jsonb_build_object('sent', 0, 'state', null);
  end if;

  v_state := public.price_inquiry_renotify_info(v_pi.id);
  if not coalesce((v_state->>'can')::boolean, false) then
    return jsonb_build_object('sent', 0, 'state', v_state);
  end if;

  for v_recipient in
    select * from public.get_price_inquiry_recipient_ids(v_pi.artwork_id, v_pi.inquirer_id)
  loop
    insert into public.notifications (user_id, type, actor_id, artwork_id, payload)
    values (v_recipient, 'price_inquiry', v_pi.inquirer_id, v_pi.artwork_id, jsonb_build_object('inquiry_id', v_pi.id));
    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    insert into public.price_inquiry_renotifies (inquiry_id, recipients, source)
    values (v_pi.id, v_count, 'resend');
  end if;

  return jsonb_build_object('sent', v_count, 'state', public.price_inquiry_renotify_info(v_pi.id));
end;
$a$;

revoke all on function public.renotify_price_inquiry(uuid) from public, anon;
grant execute on function public.renotify_price_inquiry(uuid) to authenticated;

-- == SECTION 5 == resend_price_inquiry_notification (old name, same limit)

create or replace function public.resend_price_inquiry_notification(p_inquiry_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $a$
declare
  v_out jsonb;
begin
  v_out := public.renotify_price_inquiry(p_inquiry_id);
  return coalesce((v_out->>'sent')::int, 0);
end;
$a$;

revoke all on function public.resend_price_inquiry_notification(uuid) from public, anon;
grant execute on function public.resend_price_inquiry_notification(uuid) to authenticated;
