-- Sprint 5 — Relationship Access Layer & Subscription-Ready Hospitality.
--
-- Installs the foundational data model for *relationship-aware visibility
-- and access* over profiles, artworks, exhibitions, and private rooms.
--
-- Design constraints (mirror the sprint work order):
--   - Owner-side visibility is a basic right; never put basic privacy
--     controls behind a paywall.
--   - Viewer-side access feels like hospitality, not extraction. No
--     "pay to unlock" copy. No marketplace cart logic.
--   - Viewer-facing visibility judgements MUST be made server-side. No
--     surface should trust a client-supplied `required_audience`.
--   - Audience list IDs / VIP membership must NEVER leak to viewers.
--   - Tokens / share secrets / magic links / authorization headers MUST
--     NEVER be stored in `source_payload` or telemetry.
--   - Pending follow edges do NOT count as accepted followers.
--   - In Abstract, `following` audience means "OWNER follows VIEWER" —
--     i.e. "people I (the owner) follow". Read this carefully when
--     editing the resolver.
--
-- Migration shape:
--   This file is large and contains multiple PL/pgSQL functions. Per
--   .cursor/rules/release-workflow.mdc §1-1, dashboard "Run all" is
--   unsafe for multi-function pgSQL paste. Apply by SECTION, copying
--   each `-- == SECTION N == ...` block separately into the Supabase
--   SQL Editor and pressing Run. Dollar tags are letters-only.
--
-- Idempotency:
--   Every CREATE / ALTER uses IF NOT EXISTS or DROP-and-recreate guards
--   so the file can be re-run against an already-applied database
--   without errors.

-- == SECTION 1 == tables (visibility_owner_settings, visibility_policies)

create table if not exists public.visibility_owner_settings (
  owner_profile_id uuid primary key references public.profiles(id) on delete cascade,
  preset_key text not null check (preset_key in (
    'open_studio',
    'follower_aware',
    'mutual_first',
    'private_studio'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.visibility_owner_settings is
  'One row per owner. Holds the bulk visibility preset (Open Studio / Follower-Aware / Mutual-First / Private Studio). Absent row = open_studio fallback (zero behavior change for new owners).';

create table if not exists public.visibility_policies (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references public.profiles(id) on delete cascade,
  subject_type text not null check (subject_type in (
    'profile_section',
    'artwork',
    'artwork_field',
    'exhibition',
    'room'
  )),
  -- subject_id is nullable: null => owner-wide default for that subject_type.
  subject_id uuid null,
  -- field_key '*' => subject-level default (no field-specific override).
  field_key text not null default '*',
  audience text not null check (audience in (
    'public',
    'signed_in',
    'followers',
    'following',
    'mutuals',
    'approved',
    'delegates',
    'owner_only'
  )),
  -- request_mode: null = audience-based default fallback, otherwise explicit.
  -- Use 'access_request' (NOT 'request') to avoid ambiguity with HTTP terms.
  request_mode text null check (request_mode is null or request_mode in (
    'inquiry',
    'access_request',
    'none'
  )),
  source_preset text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.visibility_policies is
  'Owner-managed visibility/access rules per subject and field. Viewer surfaces MUST consume resolved access via resolve_visibility_for_viewer(); never read raw rows.';
comment on column public.visibility_policies.field_key is
  'Stable key per subject_type. Examples: price, availability, description (=artworks.story), provenance, exhibition_preview, studio_note. ''*'' = subject-level default.';
comment on column public.visibility_policies.request_mode is
  'Owner override for the gated-CTA path: inquiry | access_request | none. NULL = derive from audience (audience-based default). Never use ''request''.';

-- Null-safe partial unique indexes. PostgreSQL treats NULL <> NULL, so a
-- single unique(owner, subject_type, subject_id, field_key) would let
-- duplicate owner-wide rows in. Two partial indexes cover both lanes.
create unique index if not exists visibility_policies_subject_keyed_uniq
  on public.visibility_policies (owner_profile_id, subject_type, subject_id, field_key)
  where subject_id is not null;

create unique index if not exists visibility_policies_subject_null_uniq
  on public.visibility_policies (owner_profile_id, subject_type, field_key)
  where subject_id is null;

create index if not exists idx_visibility_policies_owner_subject
  on public.visibility_policies (owner_profile_id, subject_type, subject_id);

create index if not exists idx_visibility_policies_owner_audience
  on public.visibility_policies (owner_profile_id, audience);

-- == SECTION 2 == tables (access_requests, access_grants)

create table if not exists public.access_requests (
  id uuid primary key default gen_random_uuid(),
  requester_profile_id uuid not null references public.profiles(id) on delete cascade,
  owner_profile_id uuid not null references public.profiles(id) on delete cascade,
  subject_type text not null check (subject_type in (
    'profile_section',
    'artwork',
    'artwork_field',
    'exhibition',
    'room'
  )),
  subject_id uuid null,
  field_key text not null default '*',
  request_type text not null check (request_type in (
    'price_inquiry',
    'availability_request',
    'room_access',
    'vip_preview',
    'studio_note_access',
    'general_access'
  )),
  status text not null default 'pending' check (status in (
    'pending',
    'approved',
    'declined',
    'expired',
    'cancelled'
  )),
  message text null,
  source_surface text null check (source_surface is null or source_surface in (
    'feed', 'room', 'artwork', 'exhibition', 'profile', 'direct'
  )),
  source_payload jsonb null,
  resolved_by uuid null references public.profiles(id) on delete set null,
  resolved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Denormalised conditional check: requester != owner.
  constraint access_requests_no_self_request
    check (requester_profile_id <> owner_profile_id)
);

comment on table public.access_requests is
  'Viewer-initiated access requests for a specific subject/field. message body MUST NEVER appear in telemetry. source_payload is sanitized before insert (no tokens, no secrets, no raw URLs).';
comment on column public.access_requests.message is
  'Free-text body from requester. Stored for owner inbox display only. NEVER include in telemetry payloads.';
comment on column public.access_requests.source_payload is
  'Sanitized jsonb breadcrumb. NEVER store tokens, share_token, magic links, authorization headers, cookies, or raw URLs.';

-- Null-safe pending dedupe: two partial indexes split by subject_id null/not-null.
create unique index if not exists access_requests_pending_subject_keyed_uniq
  on public.access_requests (
    requester_profile_id, owner_profile_id, subject_type, subject_id, field_key, request_type
  )
  where status = 'pending' and subject_id is not null;

create unique index if not exists access_requests_pending_subject_null_uniq
  on public.access_requests (
    requester_profile_id, owner_profile_id, subject_type, field_key, request_type
  )
  where status = 'pending' and subject_id is null;

create index if not exists idx_access_requests_owner_status
  on public.access_requests (owner_profile_id, status, created_at desc);

create index if not exists idx_access_requests_requester
  on public.access_requests (requester_profile_id, created_at desc);

create table if not exists public.access_grants (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references public.profiles(id) on delete cascade,
  grantee_profile_id uuid not null references public.profiles(id) on delete cascade,
  subject_type text not null check (subject_type in (
    'profile_section',
    'artwork',
    'artwork_field',
    'exhibition',
    'room'
  )),
  subject_id uuid null,
  field_key text not null default '*',
  grant_type text not null check (grant_type in (
    'manual',
    'request_approved',
    'audience_list',
    'room_invite',
    'subscription_ready_later'
  )),
  source_request_id uuid null references public.access_requests(id) on delete set null,
  expires_at timestamptz null,
  created_at timestamptz not null default now(),
  created_by uuid null references public.profiles(id) on delete set null,
  constraint access_grants_no_self_grant
    check (owner_profile_id <> grantee_profile_id)
);

comment on table public.access_grants is
  'Effective grants that let a specific grantee view a specific subject/field. Owner/delegate-writer manages; grantees do not enumerate other grantees.';

create unique index if not exists access_grants_subject_keyed_uniq
  on public.access_grants (owner_profile_id, grantee_profile_id, subject_type, subject_id, field_key)
  where subject_id is not null;

create unique index if not exists access_grants_subject_null_uniq
  on public.access_grants (owner_profile_id, grantee_profile_id, subject_type, field_key)
  where subject_id is null;

create index if not exists idx_access_grants_grantee
  on public.access_grants (grantee_profile_id, owner_profile_id);

create index if not exists idx_access_grants_owner
  on public.access_grants (owner_profile_id, created_at desc);

-- == SECTION 3 == tables (audience_lists, audience_list_members) — schema only, no UI in v1

create table if not exists public.audience_lists (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('collectors', 'curators', 'galleries', 'vip', 'custom')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.audience_lists is
  'Owner-managed audience grouping (e.g. VIP collectors). v1 schema-only — no management UI. List membership must NEVER leak to viewers.';

create index if not exists idx_audience_lists_owner
  on public.audience_lists (owner_profile_id, updated_at desc);

create table if not exists public.audience_list_members (
  list_id uuid not null references public.audience_lists(id) on delete cascade,
  member_profile_id uuid not null references public.profiles(id) on delete cascade,
  added_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (list_id, member_profile_id)
);

comment on table public.audience_list_members is
  'Audience list membership rows. Visible ONLY to list owner / delegate-writer. Members do not see who else is on the same list (no VIP-list leakage).';

create index if not exists idx_audience_list_members_member
  on public.audience_list_members (member_profile_id);

-- == SECTION 4 == RLS enable + policies

alter table public.visibility_owner_settings enable row level security;
alter table public.visibility_policies enable row level security;
alter table public.access_requests enable row level security;
alter table public.access_grants enable row level security;
alter table public.audience_lists enable row level security;
alter table public.audience_list_members enable row level security;

-- visibility_owner_settings — owner or delegate-writer only.
drop policy if exists visibility_owner_settings_owner_all on public.visibility_owner_settings;
create policy visibility_owner_settings_owner_all on public.visibility_owner_settings
  for all to authenticated
  using (
    owner_profile_id = auth.uid()
    or public.is_active_account_delegate_writer(owner_profile_id)
  )
  with check (
    owner_profile_id = auth.uid()
    or public.is_active_account_delegate_writer(owner_profile_id)
  );

-- visibility_policies — owner or delegate-writer only. Viewer surfaces use RPC.
drop policy if exists visibility_policies_owner_all on public.visibility_policies;
create policy visibility_policies_owner_all on public.visibility_policies
  for all to authenticated
  using (
    owner_profile_id = auth.uid()
    or public.is_active_account_delegate_writer(owner_profile_id)
  )
  with check (
    owner_profile_id = auth.uid()
    or public.is_active_account_delegate_writer(owner_profile_id)
  );

-- access_requests — split policies because requester rights differ from owner rights.
drop policy if exists access_requests_select on public.access_requests;
create policy access_requests_select on public.access_requests
  for select to authenticated
  using (
    requester_profile_id = auth.uid()
    or owner_profile_id = auth.uid()
    or public.is_active_account_delegate_writer(owner_profile_id)
  );

drop policy if exists access_requests_insert on public.access_requests;
create policy access_requests_insert on public.access_requests
  for insert to authenticated
  with check (
    requester_profile_id = auth.uid()
    and owner_profile_id <> auth.uid()
  );

-- Owner/delegate-writer can change status to approved/declined/expired.
-- Requester can change pending → cancelled (their own row only).
drop policy if exists access_requests_update_owner on public.access_requests;
create policy access_requests_update_owner on public.access_requests
  for update to authenticated
  using (
    owner_profile_id = auth.uid()
    or public.is_active_account_delegate_writer(owner_profile_id)
  )
  with check (
    owner_profile_id = auth.uid()
    or public.is_active_account_delegate_writer(owner_profile_id)
  );

drop policy if exists access_requests_update_requester_cancel on public.access_requests;
create policy access_requests_update_requester_cancel on public.access_requests
  for update to authenticated
  using (
    requester_profile_id = auth.uid()
    and status = 'pending'
  )
  with check (
    requester_profile_id = auth.uid()
    and status in ('pending', 'cancelled')
  );

-- access_grants — owner/delegate-writer manages; grantees do not see siblings.
drop policy if exists access_grants_owner_all on public.access_grants;
create policy access_grants_owner_all on public.access_grants
  for all to authenticated
  using (
    owner_profile_id = auth.uid()
    or public.is_active_account_delegate_writer(owner_profile_id)
  )
  with check (
    owner_profile_id = auth.uid()
    or public.is_active_account_delegate_writer(owner_profile_id)
  );

-- Optional: grantee can SELECT only their own grant rows (UI badge).
drop policy if exists access_grants_select_grantee on public.access_grants;
create policy access_grants_select_grantee on public.access_grants
  for select to authenticated
  using (grantee_profile_id = auth.uid());

-- audience_lists / audience_list_members — owner/delegate-writer ONLY.
-- Members deliberately do not see their own membership rows (no VIP leak).
drop policy if exists audience_lists_owner_all on public.audience_lists;
create policy audience_lists_owner_all on public.audience_lists
  for all to authenticated
  using (
    owner_profile_id = auth.uid()
    or public.is_active_account_delegate_writer(owner_profile_id)
  )
  with check (
    owner_profile_id = auth.uid()
    or public.is_active_account_delegate_writer(owner_profile_id)
  );

drop policy if exists audience_list_members_owner_all on public.audience_list_members;
create policy audience_list_members_owner_all on public.audience_list_members
  for all to authenticated
  using (
    exists (
      select 1 from public.audience_lists al
      where al.id = audience_list_members.list_id
        and (al.owner_profile_id = auth.uid()
             or public.is_active_account_delegate_writer(al.owner_profile_id))
    )
  )
  with check (
    exists (
      select 1 from public.audience_lists al
      where al.id = audience_list_members.list_id
        and (al.owner_profile_id = auth.uid()
             or public.is_active_account_delegate_writer(al.owner_profile_id))
    )
  );

-- == SECTION 5 == get_viewer_relationship_context

-- Returns coarse viewer ↔ owner relationship signals. Used to decide
-- gated-CTA *flavor* (Follow vs Ask vs Request access). Does NOT
-- return audience list IDs or VIP membership; subject/field-specific
-- approvals are resolved inside resolve_visibility_for_viewer.
create or replace function public.get_viewer_relationship_context(
  p_target_profile_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $a$
declare
  v_uid uuid := auth.uid();
  v_is_self boolean;
  v_viewer_follows boolean := false;
  v_target_follows boolean := false;
  v_pending boolean := false;
  v_is_public boolean := true;
  v_role text;
  v_is_delegate boolean := false;
  v_has_grant boolean := false;
begin
  if p_target_profile_id is null then
    return jsonb_build_object('viewer_id', v_uid, 'target_profile_id', null);
  end if;

  v_is_self := (v_uid is not null and v_uid = p_target_profile_id);

  -- target profile public/private + role
  select coalesce(p.is_public, true), p.main_role
    into v_is_public, v_role
  from public.profiles p
  where p.id = p_target_profile_id;

  if v_uid is not null and not v_is_self then
    -- viewer → target follow (accepted vs pending)
    select
      coalesce(bool_or(status = 'accepted'), false),
      coalesce(bool_or(status = 'pending'), false)
      into v_viewer_follows, v_pending
    from public.follows
    where follower_id = v_uid and following_id = p_target_profile_id;

    -- target → viewer follow (accepted only)
    select coalesce(bool_or(status = 'accepted'), false)
      into v_target_follows
    from public.follows
    where follower_id = p_target_profile_id and following_id = v_uid;

    -- delegate-writer of target?
    v_is_delegate := public.is_active_account_delegate_writer(p_target_profile_id);

    -- coarse: any approved access from this owner?
    select exists (
      select 1 from public.access_grants g
      where g.owner_profile_id = p_target_profile_id
        and g.grantee_profile_id = v_uid
        and (g.expires_at is null or g.expires_at > now())
    ) into v_has_grant;
  end if;

  return jsonb_build_object(
    'viewer_id', v_uid,
    'target_profile_id', p_target_profile_id,
    'is_self', v_is_self,
    'viewer_follows_target', v_viewer_follows,
    'target_follows_viewer', v_target_follows,
    'is_mutual', (v_viewer_follows and v_target_follows),
    'follow_status', case
      when v_viewer_follows then 'accepted'
      when v_pending then 'pending'
      else 'none'
    end,
    'target_is_public', v_is_public,
    'viewer_role', v_role,
    'is_delegate', v_is_delegate,
    'has_any_approved_access', v_has_grant
  );
end;
$a$;

grant execute on function public.get_viewer_relationship_context(uuid) to authenticated;
grant execute on function public.get_viewer_relationship_context(uuid) to anon;

-- == SECTION 6 == can_view_by_relationship (internal helper)

-- Pure logic: given an owner, viewer (auth.uid()), subject, field, and a
-- required audience, return true iff the viewer satisfies that audience.
-- Internal helper — viewer surfaces MUST go through
-- resolve_visibility_for_viewer (which derives required_audience from
-- effective policy server-side).
create or replace function public.can_view_by_relationship(
  p_owner uuid,
  p_subject_type text,
  p_subject_id uuid,
  p_field_key text,
  p_required_audience text
) returns boolean
language plpgsql
stable
security definer
set search_path = public
as $a$
declare
  v_uid uuid := auth.uid();
  v_viewer_follows boolean := false;
  v_target_follows boolean := false;
  v_grant boolean := false;
  v_list_grant boolean := false;
begin
  if p_owner is null or p_required_audience is null then
    return false;
  end if;

  -- 1) owner / self
  if v_uid is not null and v_uid = p_owner then
    return true;
  end if;

  -- 2) active delegate-writer (skip for owner_only fields below)
  if v_uid is not null and public.is_active_account_delegate_writer(p_owner) then
    if p_required_audience <> 'owner_only' then
      return true;
    end if;
  end if;

  -- 3) public
  if p_required_audience = 'public' then
    return true;
  end if;

  -- 4) signed_in
  if p_required_audience = 'signed_in' then
    return v_uid is not null;
  end if;

  if v_uid is null then
    return false;
  end if;

  -- 5) followers / 6) following / 7) mutuals — accepted only.
  if p_required_audience in ('followers', 'following', 'mutuals') then
    v_viewer_follows := exists (
      select 1 from public.follows
      where follower_id = v_uid and following_id = p_owner and status = 'accepted'
    );
    v_target_follows := exists (
      select 1 from public.follows
      where follower_id = p_owner and following_id = v_uid and status = 'accepted'
    );
    if p_required_audience = 'followers' then
      return v_viewer_follows;
    elsif p_required_audience = 'following' then
      -- "OWNER follows VIEWER" — i.e. people the owner follows.
      return v_target_follows;
    else
      return v_viewer_follows and v_target_follows;
    end if;
  end if;

  -- 8) approved — explicit grant on this subject/field, OR owner-wide grant.
  if p_required_audience = 'approved' then
    v_grant := exists (
      select 1 from public.access_grants g
      where g.owner_profile_id = p_owner
        and g.grantee_profile_id = v_uid
        and g.subject_type = p_subject_type
        and (
          (g.subject_id is null and g.field_key = '*')
          or (g.subject_id = p_subject_id and (g.field_key = p_field_key or g.field_key = '*'))
          or (g.subject_id is null and g.field_key = p_field_key)
        )
        and (g.expires_at is null or g.expires_at > now())
    );
    if v_grant then return true; end if;

    -- audience_list membership (any list owned by this owner that grants
    -- access via an audience_list-typed grant).
    v_list_grant := exists (
      select 1
      from public.access_grants g
      join public.audience_lists al on al.owner_profile_id = g.owner_profile_id
      join public.audience_list_members alm
        on alm.list_id = al.id and alm.member_profile_id = v_uid
      where g.owner_profile_id = p_owner
        and g.grant_type = 'audience_list'
        and g.subject_type = p_subject_type
        and (
          (g.subject_id is null and g.field_key = '*')
          or (g.subject_id = p_subject_id and (g.field_key = p_field_key or g.field_key = '*'))
          or (g.subject_id is null and g.field_key = p_field_key)
        )
        and (g.expires_at is null or g.expires_at > now())
    );
    return v_list_grant;
  end if;

  -- 9) delegates
  if p_required_audience = 'delegates' then
    return public.is_active_account_delegate_writer(p_owner);
  end if;

  -- 10) owner_only
  if p_required_audience = 'owner_only' then
    return false;
  end if;

  return false;
end;
$a$;

grant execute on function public.can_view_by_relationship(uuid, text, uuid, text, text) to authenticated;
grant execute on function public.can_view_by_relationship(uuid, text, uuid, text, text) to anon;

-- == SECTION 7 == resolve_visibility_for_viewer (the only viewer-facing entry)

-- Reads the effective policy server-side and returns the resolved
-- judgement. UI never supplies required_audience itself.
create or replace function public.resolve_visibility_for_viewer(
  p_owner uuid,
  p_subject_type text,
  p_subject_id uuid,
  p_field_key text
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $a$
declare
  v_audience text;
  v_request_mode text;
  v_preset text;
  v_can boolean;
  v_reason text := 'fallback_open';
begin
  if p_owner is null or p_subject_type is null then
    return jsonb_build_object(
      'can_view', false,
      'required_audience', 'owner_only',
      'request_mode', null,
      'reason', 'invalid_input'
    );
  end if;

  -- Effective policy lookup: most specific wins.
  --   1) (subject_id matches, field_key matches)
  --   2) (subject_id matches, field_key='*')
  --   3) (subject_id is null, field_key matches)
  --   4) (subject_id is null, field_key='*')   ← owner-wide subject default
  select audience, request_mode
    into v_audience, v_request_mode
  from public.visibility_policies
  where owner_profile_id = p_owner
    and subject_type = p_subject_type
    and (
      (subject_id is not null and subject_id = p_subject_id and field_key = p_field_key)
      or (subject_id is not null and subject_id = p_subject_id and field_key = '*')
      or (subject_id is null and field_key = p_field_key)
      or (subject_id is null and field_key = '*')
    )
  order by
    -- NULLS LAST: subject-keyed beats subject-null; field-specific beats wildcard.
    case when subject_id is not null and field_key = p_field_key then 0
         when subject_id is not null and field_key = '*' then 1
         when subject_id is null and field_key = p_field_key then 2
         else 3
    end
  limit 1;

  -- No explicit policy → fall back to owner preset's default audience for this field.
  if v_audience is null then
    select preset_key into v_preset
    from public.visibility_owner_settings
    where owner_profile_id = p_owner;

    v_preset := coalesce(v_preset, 'open_studio');

    -- Preset → default audience map. Keep this aligned with
    -- src/lib/visibility/presets.ts. v1 deliberately keeps it coarse:
    -- price/availability flow toward mutuals/approved when the studio
    -- becomes more private; description/studio note follow the room
    -- temperature; everything else stays public.
    v_audience := case v_preset
      when 'open_studio' then case
        when p_field_key in ('price', 'availability') then 'mutuals'
        when p_field_key = 'studio_note' then 'owner_only'
        else 'public'
      end
      when 'follower_aware' then case
        when p_field_key in ('price', 'availability') then 'mutuals'
        when p_field_key in ('description', 'studio_note') then 'followers'
        else 'public'
      end
      when 'mutual_first' then case
        when p_field_key in ('price', 'availability') then 'mutuals'
        when p_field_key in ('description', 'studio_note') then 'mutuals'
        when p_field_key = '*' then 'public'
        else 'followers'
      end
      when 'private_studio' then case
        when p_field_key in ('price', 'availability', 'description', 'studio_note') then 'approved'
        when p_field_key = '*' then 'signed_in'
        else 'approved'
      end
      else 'public'
    end;

    v_reason := 'preset_fallback:' || v_preset;
  else
    v_reason := 'policy_match';
  end if;

  v_can := public.can_view_by_relationship(
    p_owner, p_subject_type, p_subject_id, p_field_key, v_audience
  );

  return jsonb_build_object(
    'can_view', v_can,
    'required_audience', v_audience,
    'request_mode', v_request_mode,
    'reason', case when v_can then v_reason else v_reason || ':blocked' end
  );
end;
$a$;

grant execute on function public.resolve_visibility_for_viewer(uuid, text, uuid, text) to authenticated;
grant execute on function public.resolve_visibility_for_viewer(uuid, text, uuid, text) to anon;

-- == SECTION 8 == can_view_by_relationship_dryrun (preview-as)

-- Preview-as: caller MUST be owner or delegate-writer. Does not mutate.
-- Fake state can override viewer_follows_target / target_follows_viewer
-- / has_grant flags so the owner can preview each audience tier.
create or replace function public.can_view_by_relationship_dryrun(
  p_owner uuid,
  p_subject_type text,
  p_subject_id uuid,
  p_field_key text,
  p_required_audience text,
  p_fake_viewer_id uuid,
  p_fake_state jsonb
) returns boolean
language plpgsql
stable
security definer
set search_path = public
as $a$
declare
  v_uid uuid := auth.uid();
  v_fake_follow_owner boolean := coalesce((p_fake_state->>'viewer_follows_target')::boolean, false);
  v_fake_owner_follow boolean := coalesce((p_fake_state->>'target_follows_viewer')::boolean, false);
  v_fake_grant boolean := coalesce((p_fake_state->>'has_grant')::boolean, false);
  v_fake_signed_in boolean := coalesce((p_fake_state->>'signed_in')::boolean, true);
  v_fake_delegate boolean := coalesce((p_fake_state->>'is_delegate')::boolean, false);
begin
  -- Caller authority: owner or delegate-writer of owner only.
  if v_uid is null
     or (v_uid <> p_owner
         and not public.is_active_account_delegate_writer(p_owner)) then
    return false;
  end if;

  if p_required_audience is null then
    return false;
  end if;

  -- Self-as-owner preview always true.
  if p_fake_viewer_id is not null and p_fake_viewer_id = p_owner then
    return true;
  end if;

  if p_required_audience = 'owner_only' then
    return false;
  end if;

  if p_required_audience = 'public' then
    return true;
  end if;

  if p_required_audience = 'signed_in' then
    return v_fake_signed_in;
  end if;

  if p_required_audience = 'followers' then
    return v_fake_follow_owner;
  end if;

  if p_required_audience = 'following' then
    return v_fake_owner_follow;
  end if;

  if p_required_audience = 'mutuals' then
    return v_fake_follow_owner and v_fake_owner_follow;
  end if;

  if p_required_audience = 'approved' then
    return v_fake_grant;
  end if;

  if p_required_audience = 'delegates' then
    return v_fake_delegate;
  end if;

  return false;
end;
$a$;

grant execute on function public.can_view_by_relationship_dryrun(uuid, text, uuid, text, text, uuid, jsonb) to authenticated;

-- == SECTION 9 == upsert_visibility_policy

create or replace function public.upsert_visibility_policy(
  p_owner uuid,
  p_subject_type text,
  p_subject_id uuid,
  p_field_key text,
  p_audience text,
  p_request_mode text,
  p_source_preset text
) returns public.visibility_policies
language plpgsql
security definer
set search_path = public
as $a$
declare
  v_uid uuid := auth.uid();
  v_row public.visibility_policies;
  v_field text := coalesce(p_field_key, '*');
  v_request_mode text := nullif(p_request_mode, '');
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  if p_owner is null then
    raise exception 'owner_profile_id required';
  end if;

  if v_uid <> p_owner
     and not public.is_active_account_delegate_writer(p_owner) then
    raise exception 'not authorized to manage visibility for this owner';
  end if;

  if v_request_mode is not null
     and v_request_mode not in ('inquiry', 'access_request', 'none') then
    raise exception 'invalid request_mode: %', v_request_mode;
  end if;

  -- Subject ownership validation per type.
  if p_subject_type = 'artwork' and p_subject_id is not null then
    if not exists (
      select 1 from public.artworks a
      where a.id = p_subject_id and a.artist_id = p_owner
    ) then
      raise exception 'subject artwork does not belong to owner';
    end if;
  elsif p_subject_type = 'room' and p_subject_id is not null then
    if not exists (
      select 1 from public.shortlists s
      where s.id = p_subject_id and s.owner_id = p_owner
    ) then
      raise exception 'subject room does not belong to owner';
    end if;
  end if;

  -- Two paths because the two unique partial indexes have different keys.
  if p_subject_id is null then
    insert into public.visibility_policies as vp (
      owner_profile_id, subject_type, subject_id, field_key, audience, request_mode, source_preset
    ) values (
      p_owner, p_subject_type, null, v_field, p_audience, v_request_mode, p_source_preset
    )
    on conflict (owner_profile_id, subject_type, field_key)
      where subject_id is null
    do update set
      audience = excluded.audience,
      request_mode = excluded.request_mode,
      source_preset = excluded.source_preset,
      updated_at = now()
    returning * into v_row;
  else
    insert into public.visibility_policies as vp (
      owner_profile_id, subject_type, subject_id, field_key, audience, request_mode, source_preset
    ) values (
      p_owner, p_subject_type, p_subject_id, v_field, p_audience, v_request_mode, p_source_preset
    )
    on conflict (owner_profile_id, subject_type, subject_id, field_key)
      where subject_id is not null
    do update set
      audience = excluded.audience,
      request_mode = excluded.request_mode,
      source_preset = excluded.source_preset,
      updated_at = now()
    returning * into v_row;
  end if;

  return v_row;
end;
$a$;

grant execute on function public.upsert_visibility_policy(uuid, text, uuid, text, text, text, text) to authenticated;

-- == SECTION 10 == set_visibility_preset

-- Owner-side: updates visibility_owner_settings ONLY. Does NOT fan out
-- to per-artwork rows. Existing explicit subject/field overrides are
-- never overwritten. Preset effect is applied by resolve_visibility_for_viewer
-- as a fallback when no explicit policy row matches.
create or replace function public.set_visibility_preset(
  p_owner uuid,
  p_preset_key text
) returns public.visibility_owner_settings
language plpgsql
security definer
set search_path = public
as $a$
declare
  v_uid uuid := auth.uid();
  v_row public.visibility_owner_settings;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  if p_owner is null then
    raise exception 'owner_profile_id required';
  end if;

  if v_uid <> p_owner
     and not public.is_active_account_delegate_writer(p_owner) then
    raise exception 'not authorized to manage visibility for this owner';
  end if;

  if p_preset_key is null
     or p_preset_key not in ('open_studio', 'follower_aware', 'mutual_first', 'private_studio') then
    raise exception 'invalid preset_key: %', p_preset_key;
  end if;

  insert into public.visibility_owner_settings as s (
    owner_profile_id, preset_key
  ) values (
    p_owner, p_preset_key
  )
  on conflict (owner_profile_id) do update set
    preset_key = excluded.preset_key,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$a$;

grant execute on function public.set_visibility_preset(uuid, text) to authenticated;

-- == SECTION 11 == create_access_request

create or replace function public.create_access_request(
  p_owner uuid,
  p_subject_type text,
  p_subject_id uuid,
  p_field_key text,
  p_request_type text,
  p_message text,
  p_source_surface text,
  p_source_payload jsonb
) returns public.access_requests
language plpgsql
security definer
set search_path = public
as $a$
declare
  v_uid uuid := auth.uid();
  v_row public.access_requests;
  v_field text := coalesce(p_field_key, '*');
  v_msg text := nullif(left(coalesce(p_message, ''), 1000), '');
  v_payload jsonb;
  v_source text := nullif(p_source_surface, '');
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;
  if p_owner is null then
    raise exception 'owner_profile_id required';
  end if;
  if v_uid = p_owner then
    raise exception 'cannot request access from yourself';
  end if;
  if p_request_type is null
     or p_request_type not in (
       'price_inquiry', 'availability_request', 'room_access',
       'vip_preview', 'studio_note_access', 'general_access'
     ) then
    raise exception 'invalid request_type: %', p_request_type;
  end if;
  if v_source is not null
     and v_source not in ('feed', 'room', 'artwork', 'exhibition', 'profile', 'direct') then
    raise exception 'invalid source_surface: %', v_source;
  end if;

  -- Sanitize source_payload server-side as belt-and-suspenders. We only
  -- accept top-level scalar keys, drop nested objects/arrays, and strip
  -- token-shaped keys. Client should already sanitize but we defend in depth.
  v_payload := null;
  if p_source_payload is not null and jsonb_typeof(p_source_payload) = 'object' then
    select jsonb_object_agg(k, v)
      into v_payload
    from jsonb_each(p_source_payload) as e(k, v)
    where lower(k) !~ '(token|password|secret|apikey|authorization|cookie|magic|bearer)'
      and jsonb_typeof(v) in ('string', 'number', 'boolean');

    -- Cap size at ~2 KB serialized to prevent payload bloat.
    if v_payload is not null and length(v_payload::text) > 2048 then
      v_payload := null;
    end if;
  end if;

  -- Idempotent insert: if a pending row exists for the same key, return it.
  if p_subject_id is null then
    select * into v_row
    from public.access_requests
    where requester_profile_id = v_uid
      and owner_profile_id = p_owner
      and subject_type = p_subject_type
      and subject_id is null
      and field_key = v_field
      and request_type = p_request_type
      and status = 'pending';
  else
    select * into v_row
    from public.access_requests
    where requester_profile_id = v_uid
      and owner_profile_id = p_owner
      and subject_type = p_subject_type
      and subject_id = p_subject_id
      and field_key = v_field
      and request_type = p_request_type
      and status = 'pending';
  end if;

  if v_row.id is not null then
    return v_row;
  end if;

  insert into public.access_requests (
    requester_profile_id, owner_profile_id, subject_type, subject_id,
    field_key, request_type, message, source_surface, source_payload
  ) values (
    v_uid, p_owner, p_subject_type, p_subject_id,
    v_field, p_request_type, v_msg, v_source, v_payload
  )
  returning * into v_row;

  return v_row;
end;
$a$;

grant execute on function public.create_access_request(uuid, text, uuid, text, text, text, text, jsonb) to authenticated;

-- == SECTION 12 == resolve_access_request

create or replace function public.resolve_access_request(
  p_request_id uuid,
  p_action text
) returns public.access_requests
language plpgsql
security definer
set search_path = public
as $a$
declare
  v_uid uuid := auth.uid();
  v_req public.access_requests;
  v_new_status text;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;
  if p_action is null or p_action not in ('approve', 'decline') then
    raise exception 'invalid action: %', p_action;
  end if;

  select * into v_req from public.access_requests where id = p_request_id;
  if v_req.id is null then
    raise exception 'access request not found';
  end if;

  if v_uid <> v_req.owner_profile_id
     and not public.is_active_account_delegate_writer(v_req.owner_profile_id) then
    raise exception 'not authorized to resolve this access request';
  end if;

  if v_req.status <> 'pending' then
    raise exception 'access request is not pending (status=%)', v_req.status;
  end if;

  v_new_status := case p_action when 'approve' then 'approved' else 'declined' end;

  update public.access_requests
     set status = v_new_status,
         resolved_by = v_uid,
         resolved_at = now(),
         updated_at = now()
   where id = p_request_id
   returning * into v_req;

  -- On approve: create matching grant. Use ON CONFLICT to be idempotent
  -- against repeated approvals (which the status guard above blocks anyway).
  if p_action = 'approve' then
    if v_req.subject_id is null then
      insert into public.access_grants (
        owner_profile_id, grantee_profile_id, subject_type, subject_id,
        field_key, grant_type, source_request_id, created_by
      ) values (
        v_req.owner_profile_id, v_req.requester_profile_id, v_req.subject_type, null,
        v_req.field_key, 'request_approved', v_req.id, v_uid
      )
      on conflict (owner_profile_id, grantee_profile_id, subject_type, field_key)
        where subject_id is null
      do nothing;
    else
      insert into public.access_grants (
        owner_profile_id, grantee_profile_id, subject_type, subject_id,
        field_key, grant_type, source_request_id, created_by
      ) values (
        v_req.owner_profile_id, v_req.requester_profile_id, v_req.subject_type, v_req.subject_id,
        v_req.field_key, 'request_approved', v_req.id, v_uid
      )
      on conflict (owner_profile_id, grantee_profile_id, subject_type, subject_id, field_key)
        where subject_id is not null
      do nothing;
    end if;
  end if;

  return v_req;
end;
$a$;

grant execute on function public.resolve_access_request(uuid, text) to authenticated;
