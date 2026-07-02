-- ===========================================================================
-- Divini Procure - RECURRING BILLING (PayPal Subscriptions)
-- ===========================================================================
-- Additive + idempotent. Adds the PayPal plan mapping on tiers, the active
-- subscription id on entitlements, and a tiny config row for the PayPal product.
-- Inert until PayPal keys + plans are provisioned.
-- ===========================================================================

alter table subscription_tiers
  add column if not exists paypal_plan_id text;              -- one billing plan per paid tier

alter table subscription_entitlements
  add column if not exists paypal_subscription_id text,      -- the active PayPal subscription
  add column if not exists subscription_status text;         -- 'active' | 'cancelled' | 'expired' | null

-- Small key/value store for provisioning state (e.g. the PayPal product id).
create table if not exists app_config (
  k text primary key,
  v text,
  updated_at timestamptz not null default now()
);
