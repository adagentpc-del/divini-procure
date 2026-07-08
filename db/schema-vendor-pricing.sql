-- Divini Procure - VENDOR PRICING TIERS
-- =====================================
-- Lets a vendor company publish multiple price points for the same product /
-- service at different tiers (retail, trade, developer-specific, project-specific,
-- contract, volume, preferred, grandfathered, private admin) and control who can
-- see each one via a visibility band. A developer (companies.kind='buyer') only
-- ever sees the rows a vendor has chosen to expose to them; the vendor sees all of
-- their own rows; admins see everything.
--
-- Reuses the EXISTING model: vendors + developers are companies(id), projects are
-- buildings(id). Additive: this does NOT touch any existing table.
--
-- Money is stored as integer cents (price_cents bigint). Idempotent: safe to
-- re-run. Apply standalone via psql, e.g.
--   docker exec -i aibos_postgres psql -U aibos -d divini_procure < db/schema-vendor-pricing.sql
-- Zero em dashes by convention.

create table if not exists vendor_pricing (
  id uuid primary key default gen_random_uuid(),

  -- the vendor company that owns / manages this price (companies.kind='vendor')
  vendor_company_id uuid references companies(id) on delete cascade,

  -- optional scoping: a specific developer (companies.kind='buyer') and/or a
  -- specific project (buildings.id) this price is meant for
  developer_company_id uuid references companies(id) on delete set null,
  project_id           uuid references buildings(id) on delete set null,

  -- retail | trade | developer_specific | project_specific | contract |
  -- volume | preferred | grandfathered | private_admin
  pricing_type text check (
    pricing_type in (
      'retail','trade','developer_specific','project_specific','contract',
      'volume','preferred','grandfathered','private_admin'
    )
  ),

  product_label text,
  sku           text,
  unit          text,
  price_cents   bigint,
  min_qty       int default 1,
  currency      text default 'USD',

  -- public | trade | developer | project | admin_only
  visibility text check (
    visibility in ('public','trade','developer','project','admin_only')
  ) default 'trade',

  notes      text,
  active     boolean default true,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists vendor_pricing_vendor_idx    on vendor_pricing(vendor_company_id);
create index if not exists vendor_pricing_developer_idx on vendor_pricing(developer_company_id);
create index if not exists vendor_pricing_project_idx   on vendor_pricing(project_id);
