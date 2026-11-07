-- 2026-11-06 — Stripe subscription state on entitlements.
-- Card numbers are not stored. Logged-in users can still read their row.
-- Inserts and updates are service role only (signed webhook and server routes).

alter table public.entitlements
  add column if not exists stripe_customer_id text;

alter table public.entitlements
  add column if not exists stripe_subscription_id text;

alter table public.entitlements
  add column if not exists billing_currency text;

alter table public.entitlements
  add column if not exists billing_interval text;

alter table public.entitlements
  add column if not exists cancel_at_period_end boolean not null default false;

alter table public.entitlements
  drop constraint if exists entitlements_billing_currency_check;

alter table public.entitlements
  add constraint entitlements_billing_currency_check
  check (billing_currency is null or billing_currency in ('usd', 'krw'));

alter table public.entitlements
  drop constraint if exists entitlements_billing_interval_check;

alter table public.entitlements
  add constraint entitlements_billing_interval_check
  check (billing_interval is null or billing_interval in ('month', 'year'));

create unique index if not exists entitlements_stripe_customer_id_uidx
  on public.entitlements (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists entitlements_stripe_subscription_id_uidx
  on public.entitlements (stripe_subscription_id)
  where stripe_subscription_id is not null;

comment on column public.entitlements.stripe_customer_id is
  'Stripe customer id (cus_...). Not a card number.';

comment on column public.entitlements.stripe_subscription_id is
  'Stripe subscription id (sub_...). Not a card number.';

comment on column public.entitlements.billing_currency is
  'usd or krw for the open subscription. That subscription keeps this currency.';

comment on column public.entitlements.billing_interval is
  'month or year for the open subscription.';

comment on column public.entitlements.cancel_at_period_end is
  'Stripe cancel_at_period_end. The paid plan stays until the period ends.';

drop policy if exists "Users insert own entitlements" on public.entitlements;
drop policy if exists "Users update own entitlements" on public.entitlements;

revoke insert, update, delete, truncate on table public.entitlements from anon, authenticated;

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

alter table public.stripe_webhook_events enable row level security;

revoke all on table public.stripe_webhook_events from anon, authenticated;

comment on table public.stripe_webhook_events is
  'Stripe webhook event ids already applied. Service role only. No card data and no portal URLs.';
