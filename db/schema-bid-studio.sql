-- ============================================================================
-- Divini Procure - DIVINI BID STUDIO (structured vendor bid submission)
-- ----------------------------------------------------------------------------
-- Additive extension of the EXISTING bids / bid_line_items tables (db/schema.sql)
-- and the existing submission path (server/src/db.ts submitPricedBid, mounted
-- at POST /api/packages/:id/bids). Divini Bid Studio does not replace that
-- path or the separate bid_items/package_line_items BOQ-pricing feature; it
-- adds a structured DRAFT-BUILD workflow on top: line-item packages with
-- optional upgrades, taxes/discounts/deposit, a payment schedule, assumptions/
-- exclusions/terms, an expiration date, versioned drafts, and reusable
-- templates. On submit, the computed total is written into the existing
-- bids.price column (dollars) so every downstream reader (award workflow,
-- quote comparison, bid_recommendations, purchase orders) keeps working
-- unchanged.
--
-- Money convention note: bids.price and bid_line_items.unit_price are
-- pre-existing DOLLAR (numeric) columns - see server/src/routes/award-workflow.ts
-- ("bids.price is dollars; amount_cents = round(price * 100)"). The new
-- columns added here (subtotal_cents, tax_cents, discount_cents, total_cents,
-- deposit_cents) are integer CENTS, matching the rest of the money-handling
-- code added this session (payment_authorizations, platform_revenue). The
-- conversion happens once, in server/src/lib/bid-totals.ts.
--
-- Idempotent: safe to re-run. Apply standalone via psql, e.g.
--   docker exec -i aibos_postgres psql -U aibos -d divini_procure < db/schema-bid-studio.sql
-- Zero em dashes by convention.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- extend the existing bids table ----------
alter table if exists bids add column if not exists scope_instance_id uuid references scope_instances(id) on delete set null;
alter table if exists bids add column if not exists expires_at timestamptz;
alter table if exists bids add column if not exists deposit_cents bigint;
alter table if exists bids add column if not exists deposit_percent_basis_points int;
alter table if exists bids add column if not exists tax_cents bigint;
alter table if exists bids add column if not exists discount_cents bigint;
alter table if exists bids add column if not exists subtotal_cents bigint;
alter table if exists bids add column if not exists total_cents bigint;
alter table if exists bids add column if not exists assumptions text;
alter table if exists bids add column if not exists exclusions text[] not null default '{}';
alter table if exists bids add column if not exists terms text;
alter table if exists bids add column if not exists current_version int not null default 0;

-- ---------- extend the existing bid_line_items table ----------
alter table if exists bid_line_items add column if not exists description text;
alter table if exists bid_line_items add column if not exists category text;
alter table if exists bid_line_items add column if not exists optional boolean not null default false;
alter table if exists bid_line_items add column if not exists selected boolean not null default true;
alter table if exists bid_line_items add column if not exists sort_order int not null default 0;

-- ---------- payment schedule ----------
create table if not exists bid_payment_milestones (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid not null references bids(id) on delete cascade,
  label text not null,
  percent_basis_points int,   -- either a percent of the total...
  amount_cents bigint,        -- ...or a flat amount. One of the two is set.
  due_event text not null default 'milestone'
    check (due_event in ('deposit', 'milestone', 'completion', 'net_15', 'net_30', 'net_60', 'other')),
  sort_order int not null default 0,
  created_at timestamptz default now()
);
create index if not exists idx_bid_payment_milestones_bid on bid_payment_milestones (bid_id, sort_order);

-- ---------- immutable draft/submission version snapshots ----------
create table if not exists bid_versions (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid not null references bids(id) on delete cascade,
  version_number int not null,
  snapshot_json jsonb not null,
  change_summary text,
  created_by text references users(id),
  created_at timestamptz not null default now(),
  unique (bid_id, version_number)
);
create index if not exists idx_bid_versions_bid on bid_versions (bid_id);

-- ---------- reusable vendor bid templates ("save as template" workflow) ----------
create table if not exists bid_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references companies(id) on delete cascade,
  category text,
  name text not null,
  assumptions text,
  exclusions text[] not null default '{}',
  terms text,
  deposit_percent_basis_points int,
  created_by text references users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_bid_templates_org on bid_templates (organization_id);

create table if not exists bid_template_line_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references bid_templates(id) on delete cascade,
  name text not null,
  description text,
  category text,
  qty numeric not null default 1,
  unit text,
  unit_price numeric,
  optional boolean not null default false,
  sort_order int not null default 0
);
create index if not exists idx_bid_template_line_items_template on bid_template_line_items (template_id);
