-- Theo Board moderation + staff roles — 2026-08-15
-- 테오 보드 유저 제출 / 운영진 승인 큐 + platform_admins.role
--
-- EN: Opens authenticated submit of event|community|news|promo as pending.
--     Staff (moderator+) approve → live on rail + /theo-board, or reject
--     with a reason. CLI token publish still writes status='approved'.
--     Staff roles: moderator < ops < admin on existing platform_admins.
--     Existing rows default to ops so is_ops_user() / merge tool keep
--     working. First admin is granted via SQL (no self-serve bootstrap).
--
-- ===========================================================================
--  HOW TO APPLY (Supabase Dashboard SQL Editor)
-- ===========================================================================
-- This file has 2+ PL/pgSQL function bodies. The Dashboard tokenizer
-- splits on `;` and can leak function bodies as top-level SQL
-- (`relation "v_x" does not exist`).
--
-- Run ONE SECTION AT A TIME: highlight from `-- == SECTION N ==` through
-- the end of that section, click Run, confirm success, then the next.
-- Do NOT paste the whole file and Run once.
--
-- Dollar tags are letters-only (`$a$`, `$submit$`, …). Prefer expression
-- assignment (`v_x := (select …)`) over `SELECT … INTO`.
-- ===========================================================================


-- ===========================================================================
-- == SECTION 1 == tables / columns / RLS (no functions)
-- ===========================================================================

-- platform_admins.role — existing rows → ops
alter table public.platform_admins
  add column if not exists role text;

update public.platform_admins
   set role = 'ops'
 where role is null
    or role = '';

alter table public.platform_admins
  alter column role set default 'ops';

alter table public.platform_admins
  alter column role set not null;

alter table public.platform_admins
  drop constraint if exists platform_admins_role_check;

alter table public.platform_admins
  add constraint platform_admins_role_check
  check (role in ('moderator', 'ops', 'admin'));

comment on table public.platform_admins is
  'Staff allowlist. role: moderator < ops < admin. Existing rows default ops. First admin is granted via SQL.';

comment on column public.platform_admins.role is
  'moderator = board queue; ops = + external-artist merge + /my/ops/people; admin = + grant/revoke staff.';

grant select on table public.platform_admins to authenticated;

-- theo_board_posts: status + review + promo type
alter table public.theo_board_posts
  add column if not exists status text;

alter table public.theo_board_posts
  add column if not exists reviewed_by uuid references public.profiles (id) on delete set null;

alter table public.theo_board_posts
  add column if not exists reviewed_at timestamptz;

alter table public.theo_board_posts
  add column if not exists reject_reason text;

update public.theo_board_posts
   set status = 'approved'
 where published_at is not null
   and coalesce(status, 'pending') = 'pending';

update public.theo_board_posts
   set status = 'pending'
 where status is null;

alter table public.theo_board_posts
  alter column status set default 'pending';

alter table public.theo_board_posts
  alter column status set not null;

alter table public.theo_board_posts
  drop constraint if exists theo_board_posts_status_check;

alter table public.theo_board_posts
  add constraint theo_board_posts_status_check
  check (status in ('pending', 'approved', 'rejected', 'withdrawn'));

-- Drop/recreate type CHECK to include promo (name may be auto-generated).
alter table public.theo_board_posts
  drop constraint if exists theo_board_posts_type_check;

do $a$
declare
  v_con text;
begin
  v_con := (
    select c.conname
    from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'public'
      and r.relname = 'theo_board_posts'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ~* 'announcement'
      and pg_get_constraintdef(c.oid) ~* 'type'
    limit 1
  );
  if v_con is not null then
    execute format('alter table public.theo_board_posts drop constraint %I', v_con);
  end if;
end
$a$;

alter table public.theo_board_posts
  add constraint theo_board_posts_type_check
  check (type in ('announcement', 'event', 'feature', 'community', 'news', 'promo'));

create index if not exists theo_board_posts_queue_idx
  on public.theo_board_posts (status, created_at desc);

comment on table public.theo_board_posts is
  'Theo Board posts. User submit → pending; staff approve → live (status=approved AND published_at set). CLI publish sets approved. hidden_at = soft hide.';

comment on column public.theo_board_posts.status is
  'pending | approved | rejected | withdrawn. Live SELECT also requires status=approved.';

-- Live SELECT: also require status = approved
drop policy if exists theo_board_posts_select_live on public.theo_board_posts;
create policy theo_board_posts_select_live
  on public.theo_board_posts
  for select
  to anon, authenticated
  using (
    status = 'approved'
    and hidden_at is null
    and published_at is not null
    and (expires_at is null or expires_at > now())
  );

drop policy if exists theo_board_posts_select_own on public.theo_board_posts;
create policy theo_board_posts_select_own
  on public.theo_board_posts
  for select
  to authenticated
  using (author_id = auth.uid());

drop policy if exists theo_board_posts_insert_own on public.theo_board_posts;
create policy theo_board_posts_insert_own
  on public.theo_board_posts
  for insert
  to authenticated
  with check (
    author_id = auth.uid()
    and status = 'pending'
    and published_at is null
    and type in ('event', 'community', 'news', 'promo')
    and pinned = false
    and hidden_at is null
  );

-- Own pending/rejected/withdrawn only. WITH CHECK blocks self-approve.
drop policy if exists theo_board_posts_update_own on public.theo_board_posts;
create policy theo_board_posts_update_own
  on public.theo_board_posts
  for update
  to authenticated
  using (
    author_id = auth.uid()
    and status in ('pending', 'rejected', 'withdrawn')
  )
  with check (
    author_id = auth.uid()
    and published_at is null
    and status in ('pending', 'rejected', 'withdrawn')
    and type in ('event', 'community', 'news', 'promo')
    and pinned = false
    and hidden_at is null
  );

revoke all on table public.theo_board_posts from anon, authenticated;
grant select on table public.theo_board_posts to anon, authenticated;
grant insert, update on table public.theo_board_posts to authenticated;

-- ops_audit_log — no public SELECT/INSERT; SECURITY DEFINER RPCs write as owner
create table if not exists public.ops_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  target_type text not null,
  target_id uuid,
  reason text,
  meta jsonb,
  created_at timestamptz not null default now()
);

comment on table public.ops_audit_log is
  'Ops audit trail. Written only from SECURITY DEFINER RPCs (board.approve/reject/submit, staff.grant/revoke).';

alter table public.ops_audit_log enable row level security;

revoke all on table public.ops_audit_log from anon, authenticated;


-- ===========================================================================
-- == SECTION 2 == is_staff_at_least (+ is_ops_user comment)
-- ===========================================================================
-- is_ops_user() stays "any row in platform_admins" so
-- /my/ops/external-artists merge RPCs keep working for every staff row
-- (existing rows are ops). Role-aware checks use is_staff_at_least.

comment on function public.is_ops_user() is
  'True when auth.uid() is any row in platform_admins (all staff roles). Used by external-artist merge RPCs.';

create or replace function public.is_staff_at_least(p_min text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $a$
  select exists (
    select 1
    from public.platform_admins a
    where a.profile_id = auth.uid()
      and (
        (p_min = 'moderator' and a.role in ('moderator', 'ops', 'admin'))
        or (p_min = 'ops' and a.role in ('ops', 'admin'))
        or (p_min = 'admin' and a.role = 'admin')
      )
  );
$a$;

comment on function public.is_staff_at_least(text) is
  'Staff role ladder. moderator = any staff; ops = ops|admin; admin = admin only.';

revoke all on function public.is_staff_at_least(text) from public;
grant execute on function public.is_staff_at_least(text) to authenticated;


-- ===========================================================================
-- == SECTION 3 == theo_board_submit
-- ===========================================================================

create or replace function public.theo_board_submit(
  p_type text,
  p_title text,
  p_body_md text,
  p_summary text,
  p_href text,
  p_expires_in_days integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $submit$
declare
  v_uid uuid;
  v_id uuid;
  v_type text;
  v_title text;
  v_body text;
  v_summary text;
  v_href text;
  v_expires timestamptz;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  v_type := lower(trim(coalesce(p_type, '')));
  if v_type not in ('event', 'community', 'news', 'promo') then
    raise exception 'invalid_type';
  end if;

  v_title := trim(coalesce(p_title, ''));
  if char_length(v_title) < 1 or char_length(v_title) > 120 then
    raise exception 'invalid_title';
  end if;

  v_body := nullif(trim(coalesce(p_body_md, '')), '');
  v_summary := nullif(trim(coalesce(p_summary, '')), '');

  v_href := nullif(trim(coalesce(p_href, '')), '');
  if v_href is not null and v_href !~* '^https?://' then
    raise exception 'invalid_href';
  end if;

  v_expires := null;
  if p_expires_in_days is not null then
    if p_expires_in_days <= 0 or p_expires_in_days > 3650 then
      raise exception 'invalid_expires_in_days';
    end if;
    v_expires := now() + make_interval(days => p_expires_in_days);
  end if;

  v_id := gen_random_uuid();
  insert into public.theo_board_posts (
    id, type, title, body_md, summary, href, author_id,
    published_at, expires_at, pinned, hidden_at, status,
    created_at, updated_at
  ) values (
    v_id, v_type, v_title, v_body, v_summary, v_href, v_uid,
    null, v_expires, false, null, 'pending',
    now(), now()
  );

  insert into public.ops_audit_log (
    actor_id, action, target_type, target_id, reason, meta
  ) values (
    v_uid,
    'board.submit',
    'theo_board_post',
    v_id,
    null,
    jsonb_build_object('type', v_type, 'title', v_title)
  );

  return (
    select to_jsonb(p)
    from public.theo_board_posts p
    where p.id = v_id
  );
end;
$submit$;

revoke all on function public.theo_board_submit(text, text, text, text, text, integer) from public;
grant execute on function public.theo_board_submit(text, text, text, text, text, integer) to authenticated;


-- ===========================================================================
-- == SECTION 4 == theo_board_list_mine
-- ===========================================================================

create or replace function public.theo_board_list_mine()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $mine$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(p) order by p.created_at desc)
    from public.theo_board_posts p
    where p.author_id = v_uid
  ), '[]'::jsonb);
end;
$mine$;

revoke all on function public.theo_board_list_mine() from public;
grant execute on function public.theo_board_list_mine() to authenticated;


-- ===========================================================================
-- == SECTION 5 == theo_board_withdraw
-- ===========================================================================

create or replace function public.theo_board_withdraw(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $withdraw$
declare
  v_uid uuid;
  v_status text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_id is null then
    raise exception 'not_found';
  end if;

  v_status := (
    select p.status
    from public.theo_board_posts p
    where p.id = p_id
      and p.author_id = v_uid
  );
  if v_status is null then
    raise exception 'not_found';
  end if;
  if v_status is distinct from 'pending' then
    raise exception 'not_pending';
  end if;

  update public.theo_board_posts
     set status = 'withdrawn',
         updated_at = now()
   where id = p_id
     and author_id = v_uid
     and status = 'pending';

  return jsonb_build_object('id', p_id, 'status', 'withdrawn');
end;
$withdraw$;

revoke all on function public.theo_board_withdraw(uuid) from public;
grant execute on function public.theo_board_withdraw(uuid) to authenticated;


-- ===========================================================================
-- == SECTION 6 == theo_board_list_queue
-- ===========================================================================

create or replace function public.theo_board_list_queue(
  p_status text default 'pending',
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $queue$
declare
  v_status text;
  v_limit integer;
  v_offset integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_staff_at_least('moderator') then
    raise exception 'forbidden';
  end if;

  v_status := lower(trim(coalesce(p_status, 'pending')));
  if v_status not in ('pending', 'approved', 'rejected', 'withdrawn') then
    raise exception 'invalid_status';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  return coalesce((
    select jsonb_agg(q.obj order by q.created_at desc)
    from (
      select
        p.created_at,
        to_jsonb(p) || jsonb_build_object(
          'author_username', pr.username,
          'author_display_name', pr.display_name
        ) as obj
      from public.theo_board_posts p
      left join public.profiles pr on pr.id = p.author_id
      where p.status = v_status
      order by p.created_at desc
      limit v_limit
      offset v_offset
    ) q
  ), '[]'::jsonb);
end;
$queue$;

revoke all on function public.theo_board_list_queue(text, integer, integer) from public;
grant execute on function public.theo_board_list_queue(text, integer, integer) to authenticated;


-- ===========================================================================
-- == SECTION 7 == theo_board_approve
-- ===========================================================================

create or replace function public.theo_board_approve(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $approve$
declare
  v_uid uuid;
  v_status text;
  v_now timestamptz;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_staff_at_least('moderator') then
    raise exception 'forbidden';
  end if;
  if p_id is null then
    raise exception 'not_found';
  end if;

  v_status := (select p.status from public.theo_board_posts p where p.id = p_id);
  if v_status is null then
    raise exception 'not_found';
  end if;
  if v_status is distinct from 'pending' then
    raise exception 'not_pending';
  end if;

  v_now := now();
  update public.theo_board_posts
     set status = 'approved',
         published_at = v_now,
         reviewed_by = v_uid,
         reviewed_at = v_now,
         reject_reason = null,
         updated_at = v_now
   where id = p_id
     and status = 'pending';

  insert into public.ops_audit_log (
    actor_id, action, target_type, target_id, reason, meta
  ) values (
    v_uid,
    'board.approve',
    'theo_board_post',
    p_id,
    null,
    jsonb_build_object('published_at', v_now)
  );

  return (
    select to_jsonb(p)
    from public.theo_board_posts p
    where p.id = p_id
  );
end;
$approve$;

revoke all on function public.theo_board_approve(uuid) from public;
grant execute on function public.theo_board_approve(uuid) to authenticated;


-- ===========================================================================
-- == SECTION 8 == theo_board_reject
-- ===========================================================================

create or replace function public.theo_board_reject(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $reject$
declare
  v_uid uuid;
  v_status text;
  v_reason text;
  v_now timestamptz;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_staff_at_least('moderator') then
    raise exception 'forbidden';
  end if;
  if p_id is null then
    raise exception 'not_found';
  end if;

  v_reason := trim(coalesce(p_reason, ''));
  if char_length(v_reason) < 1 or char_length(v_reason) > 500 then
    raise exception 'invalid_reason';
  end if;

  v_status := (select p.status from public.theo_board_posts p where p.id = p_id);
  if v_status is null then
    raise exception 'not_found';
  end if;
  if v_status is distinct from 'pending' then
    raise exception 'not_pending';
  end if;

  v_now := now();
  update public.theo_board_posts
     set status = 'rejected',
         reject_reason = v_reason,
         reviewed_by = v_uid,
         reviewed_at = v_now,
         published_at = null,
         updated_at = v_now
   where id = p_id
     and status = 'pending';

  insert into public.ops_audit_log (
    actor_id, action, target_type, target_id, reason, meta
  ) values (
    v_uid,
    'board.reject',
    'theo_board_post',
    p_id,
    v_reason,
    null
  );

  return (
    select to_jsonb(p)
    from public.theo_board_posts p
    where p.id = p_id
  );
end;
$reject$;

revoke all on function public.theo_board_reject(uuid, text) from public;
grant execute on function public.theo_board_reject(uuid, text) to authenticated;


-- ===========================================================================
-- == SECTION 9 == staff_list
-- ===========================================================================

create or replace function public.staff_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $slist$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_staff_at_least('admin') then
    raise exception 'forbidden';
  end if;

  return coalesce((
    select jsonb_agg(q.obj order by q.granted_at desc)
    from (
      select
        a.granted_at,
        jsonb_build_object(
          'profile_id', a.profile_id,
          'role', a.role,
          'granted_at', a.granted_at,
          'note', a.note,
          'username', pr.username,
          'display_name', pr.display_name
        ) as obj
      from public.platform_admins a
      left join public.profiles pr on pr.id = a.profile_id
    ) q
  ), '[]'::jsonb);
end;
$slist$;

revoke all on function public.staff_list() from public;
grant execute on function public.staff_list() to authenticated;


-- ===========================================================================
-- == SECTION 10 == staff_grant
-- ===========================================================================

create or replace function public.staff_grant(
  p_profile_id uuid,
  p_role text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $sgrant$
declare
  v_uid uuid;
  v_role text;
  v_note text;
  v_existing text;
  v_admin_count integer;
  v_profile_ok boolean;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_staff_at_least('admin') then
    raise exception 'forbidden';
  end if;
  if p_profile_id is null then
    raise exception 'profile_not_found';
  end if;

  v_role := lower(trim(coalesce(p_role, '')));
  if v_role not in ('moderator', 'ops', 'admin') then
    raise exception 'invalid_role';
  end if;
  -- Only admins reach this RPC; granting admin is allowed for admins.
  if v_role = 'admin' and not public.is_staff_at_least('admin') then
    raise exception 'forbidden';
  end if;

  v_profile_ok := (select exists (
    select 1 from public.profiles pr where pr.id = p_profile_id
  ));
  if not v_profile_ok then
    raise exception 'profile_not_found';
  end if;

  v_existing := (
    select a.role from public.platform_admins a where a.profile_id = p_profile_id
  );
  if v_existing = 'admin' and v_role is distinct from 'admin' then
    v_admin_count := (
      select count(*)::integer from public.platform_admins where role = 'admin'
    );
    if v_admin_count <= 1 then
      raise exception 'cannot_revoke_last_admin';
    end if;
  end if;

  v_note := nullif(trim(coalesce(p_note, '')), '');

  insert into public.platform_admins (profile_id, role, note, granted_at)
  values (p_profile_id, v_role, v_note, now())
  on conflict (profile_id) do update
    set role = excluded.role,
        note = coalesce(excluded.note, public.platform_admins.note),
        granted_at = now();

  insert into public.ops_audit_log (
    actor_id, action, target_type, target_id, reason, meta
  ) values (
    v_uid,
    'staff.grant',
    'platform_admin',
    p_profile_id,
    v_note,
    jsonb_build_object('role', v_role, 'previous_role', v_existing)
  );

  return (
    select jsonb_build_object(
      'profile_id', a.profile_id,
      'role', a.role,
      'granted_at', a.granted_at,
      'note', a.note
    )
    from public.platform_admins a
    where a.profile_id = p_profile_id
  );
end;
$sgrant$;

revoke all on function public.staff_grant(uuid, text, text) from public;
grant execute on function public.staff_grant(uuid, text, text) to authenticated;


-- ===========================================================================
-- == SECTION 11 == staff_revoke
-- ===========================================================================

create or replace function public.staff_revoke(p_profile_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $srevoke$
declare
  v_uid uuid;
  v_existing text;
  v_admin_count integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_staff_at_least('admin') then
    raise exception 'forbidden';
  end if;
  if p_profile_id is null then
    raise exception 'not_found';
  end if;

  v_existing := (
    select a.role from public.platform_admins a where a.profile_id = p_profile_id
  );
  if v_existing is null then
    raise exception 'not_found';
  end if;

  if v_existing = 'admin' then
    v_admin_count := (
      select count(*)::integer from public.platform_admins where role = 'admin'
    );
    if v_admin_count <= 1 then
      raise exception 'cannot_revoke_last_admin';
    end if;
  end if;

  delete from public.platform_admins where profile_id = p_profile_id;

  insert into public.ops_audit_log (
    actor_id, action, target_type, target_id, reason, meta
  ) values (
    v_uid,
    'staff.revoke',
    'platform_admin',
    p_profile_id,
    null,
    jsonb_build_object('previous_role', v_existing)
  );

  return jsonb_build_object(
    'ok', true,
    'profile_id', p_profile_id,
    'previous_role', v_existing
  );
end;
$srevoke$;

revoke all on function public.staff_revoke(uuid) from public;
grant execute on function public.staff_revoke(uuid) to authenticated;
