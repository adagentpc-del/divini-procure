-- Divini Procure: Stripe billing migration.
-- Adds Stripe Customer / Subscription / Price ids to the subscription tables.
-- Drops PayPal-specific columns once the Stripe migration is complete (safe to
-- run after all active PayPal subscriptions have been migrated or cancelled).
-- Safe to run multiple times (IF NOT EXISTS / idempotent ALTER patterns).
-- Zero em dashes by convention.

-- ============================================================================
-- subscription_tiers: add Stripe catalog ids
-- ============================================================================

alter table subscription_tiers
  add column if not exists stripe_product_id text,
  add column if not exists stripe_price_id   text;

-- ============================================================================
-- subscription_entitlements: add Stripe customer + subscription tracking
-- ============================================================================

alter table subscription_entitlements
  add column if not exists stripe_customer_id     text,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status    text check (
    subscription_status in ('active','past_due','cancelled','trialing')
  );

-- Index for fast webhook lookup by stripe_subscription_id
create index if not exists subscription_entitlements_stripe_sub_idx
  on subscription_entitlements (stripe_subscription_id)
  where stripe_subscription_id is not null;

-- Index for fast webhook lookup by stripe_customer_id
create index if not exists subscription_entitlements_stripe_cust_idx
  on subscription_entitlements (stripe_customer_id)
  where stripe_customer_id is not null;

-- ============================================================================
-- PayPal columns: DROP once all live PayPal subscriptions are wound down.
-- Uncomment when safe to remove the PayPal billing path entirely.
-- ============================================================================
-- alter table subscription_entitlements
--   drop column if exists paypal_subscription_id;
-- alter table subscription_tiers
--   drop column if exists paypal_plan_id;
-- delete from app_config where k = 'paypal_product_id';

-- ============================================================================
-- stripe_checkout_sessions: idempotency table.
-- Tracks Checkout Sessions so a webhook event for an already-processed session
-- can be skipped without re-assigning the tier. The session_id (cs_...) is the
-- Stripe idempotency key.
-- ============================================================================

create table if not exists stripe_checkout_sessions (
  id               uuid primary key default gen_random_uuid(),
  session_id       text not null unique,          -- cs_... from Stripe
  company_id       uuid references companies(id) on delete set null,
  tier_key         text,
  status           text not null default 'open'   -- open | complete | expired
    check (status in ('open','complete','expired')),
  stripe_event_id  text,                          -- event id that completed it
  created_at       timestamptz not null default now(),
  completed_at     timestamptz
);

create index if not exists stripe_checkout_sessions_company_idx
  on stripe_checkout_sessions (company_id)
  where company_id is not null;

-- ============================================================================
-- stripe_webhook_events: general webhook idempotency (ALFY2 Section 09).
--
-- stripe_checkout_sessions above was evidently built for this exact purpose
-- (it has its own stripe_event_id column) but was never wired into the
-- webhook handler anywhere in server/src - grep confirms zero references.
-- It is also scoped to only one event type (checkout.session.completed);
-- this table instead covers all 4 event types the handler processes
-- uniformly, keyed on Stripe's own event.id, which is stable across
-- retries of the same event (Stripe is at-least-once delivery, and can
-- redeliver a genuinely already-processed event).
--
-- Every data-mutating operation the webhook performs is already idempotent
-- SQL (UPSERT / plain UPDATE by stripe_subscription_id or stripe_customer_id),
-- so a duplicate delivery was never a data-integrity risk - the real,
-- user-visible consequence was a duplicate "your subscription is active"
-- confirmation email on checkout.session.completed. This table closes that.
-- ============================================================================

create table if not exists stripe_webhook_events (
  event_id     text primary key,
  event_type   text not null,
  processed_at timestamptz not null default now()
);
