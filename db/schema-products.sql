-- Divini Procure - PRODUCT CATALOG / SKU MANAGEMENT
-- =================================================
-- A vendor company (companies.kind='vendor') publishes a catalog of products /
-- SKUs with specs, imagery, finishes, materials, lead times and a price. Each
-- product carries a price-visibility band that controls who may see price_cents:
--   public      -> any signed-in user
--   trade       -> any signed-in company (the default professional tier)
--   developer   -> only developers/buyers (companies.kind='buyer')
--   admin_only  -> admins only
-- The vendor company's own members and admins always see price.
--
-- Reuses the EXISTING model: vendors are companies(id). Additive: does NOT touch
-- any existing table. Money is stored as integer cents (price_cents bigint).
--
-- Idempotent: safe to re-run. Apply standalone via psql, e.g.
--   docker exec -i aibos_postgres psql -U aibos -d divini_procure < db/schema-products.sql
-- Zero em dashes by convention.

create table if not exists products (
  id uuid primary key default gen_random_uuid(),

  -- the vendor company that owns this product (companies.kind='vendor')
  vendor_company_id uuid references companies(id) on delete cascade,

  name        text,
  sku         text,
  category    text,
  subcategory text,
  description text,

  image_urls text[],
  spec_url   text,

  dimensions text,
  finishes   text[],
  materials  text[],

  lead_time_days int,

  -- integer cents; see price_visibility for who may read it
  price_cents bigint,

  -- public | trade | developer | admin_only
  price_visibility text default 'trade' check (
    price_visibility in ('public','trade','developer','admin_only')
  ),

  -- 1..5 suitability ratings (nullable)
  commercial_rating  int,
  hospitality_rating int,

  warranty  text,
  file_urls text[],

  -- active | discontinued | draft
  status text default 'active' check (status in ('active','discontinued','draft')),

  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists products_vendor_company_id_idx on products (vendor_company_id);
create index if not exists products_category_idx on products (category);
