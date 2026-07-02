-- =====================================================================
-- Divini Procure - consolidated schema (single source for first deploy)
-- ---------------------------------------------------------------------
-- Apply on the server with:
--   docker exec -i divini_procure_db psql -U aibos -d divini_procure < db/apply-all.sql
--
-- Every source schema file uses idempotent CREATE ... IF NOT EXISTS, so this
-- bundle is safe to re-run. On a brand-new database, run it TWICE: a second
-- pass resolves any cross-file foreign-key that was declared before its parent
-- table existed on the first pass. Files are concatenated parents-first.
-- Zero em dashes.
-- =====================================================================


-- ===== schema.sql =====
-- ============================================================================
-- Divini Procure — PLAIN POSTGRES schema (local self-hosted stack)
-- ----------------------------------------------------------------------------
-- Ported from supabase/migrations/0001..0003. Supabase-specific bits removed:
--   * RLS / policies (auth.uid() / auth.jwt())  -> authorization now lives in
--     the Express backend (server/src/db.ts enforces the same intent).
--   * storage.buckets / storage.objects schema   -> replaced by local-disk
--     file storage (FILE_STORAGE_DIR) + the documents table's storage_path.
--   * references to auth.users(id)               -> replaced by a plain `users`
--     table keyed by the Authentik OIDC `sub` (text).
--   * supabase roles (authenticated/anon)        -> not used.
-- Tables / columns / relationships are otherwise IDENTICAL to the migrations,
-- so the app's data shape is unchanged.
--
-- CREATE THE DB + APPLY (run once on the local Postgres at localhost:5433):
--   createdb -h localhost -p 5433 -U aibos divini_procure
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema.sql
-- (or:  psql -h localhost -p 5433 -U aibos -d divini_procure -f db/schema.sql)
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- identity ----------
-- Authentik OIDC users. `id` is the OIDC `sub` claim (stable user id).
-- The backend upserts a row here on first authenticated request.
create table if not exists users (
  id text primary key,                -- OIDC sub
  email text,
  created_at timestamptz default now()
);

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('buyer','vendor')),
  name text not null,
  contact_name text, contact_title text, phone text, email text,
  street text, city text, region text,
  logo_url text, billing_email text,
  rating numeric default 0,
  created_at timestamptz default now()
);

create table if not exists company_members (
  company_id uuid references companies(id) on delete cascade,
  user_id text references users(id) on delete cascade,
  role text default 'owner',
  seat int default 1,
  created_at timestamptz default now(),
  primary key (company_id, user_id)
);

create table if not exists vendor_profiles (
  company_id uuid primary key references companies(id) on delete cascade,
  trust int default 50,
  verify_status text default 'pending' check (verify_status in ('pending','ai-verified','approved','flagged')),
  rating numeric default 0,
  services text[] default '{}'
);

create table if not exists vendor_credentials (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  type text not null, doc_url text, registry text, result text,
  confidence numeric, ok boolean default true,
  status text default 'pending',
  scanned_at timestamptz,
  created_at timestamptz default now()
);

-- ---------- projects & bidding ----------
create table if not exists buildings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade, -- buyer/developer
  name text not null, sub text, location text, developer text,
  budget numeric, progress int default 0,
  created_at timestamptz default now()
);

create table if not exists packages (
  id uuid primary key default gen_random_uuid(),
  building_id uuid references buildings(id) on delete cascade,
  category text not null,
  status text default 'open' check (status in ('draft','open','shortlisting','awarded','closed')),
  budget_min numeric, budget_max numeric,
  deadline date, requirements text[] default '{}',
  created_at timestamptz default now()
);

create table if not exists bids (
  id uuid primary key default gen_random_uuid(),
  package_id uuid references packages(id) on delete cascade,
  vendor_company_id uuid references companies(id) on delete cascade,
  price numeric, days int, note text,
  status text default 'submitted' check (status in ('draft','submitted','shortlisted','rebid','awarded','revision')),
  is_draft boolean default false,
  docs_ok boolean default false,
  awarded boolean default false,
  paid boolean default false,
  accepted jsonb,
  created_at timestamptz default now()
);

create table if not exists bid_line_items (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid references bids(id) on delete cascade,
  name text, qty numeric default 1, unit_price numeric
);

create table if not exists bid_revisions (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid references bids(id) on delete cascade,
  proposed jsonb not null,
  status text default 'pending' check (status in ('pending','accepted','declined')),
  created_by text references users(id),
  created_at timestamptz default now()
);

-- ---------- messaging, files, reviews ----------
create table if not exists threads (
  id uuid primary key default gen_random_uuid(),
  package_id uuid references packages(id) on delete cascade,
  vendor_company_id uuid references companies(id) on delete cascade,
  buyer_company_id uuid references companies(id) on delete cascade,
  category text,
  created_at timestamptz default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references threads(id) on delete cascade,
  sender_company_id uuid references companies(id) on delete cascade,
  body text,
  created_at timestamptz default now()
);

create table if not exists files (
  id uuid primary key default gen_random_uuid(),
  owner_company_id uuid references companies(id) on delete cascade,
  package_id uuid references packages(id) on delete set null,
  bid_id uuid references bids(id) on delete set null,
  thread_id uuid references threads(id) on delete set null,
  name text, storage_path text,
  created_at timestamptz default now()
);

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  rater_company_id uuid references companies(id) on delete cascade,
  ratee_company_id uuid references companies(id) on delete cascade,
  package_id uuid references packages(id) on delete set null,
  stars int check (stars between 1 and 5),
  body text,
  created_at timestamptz default now()
);

-- ---------- notifications, billing, payouts ----------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id text references users(id) on delete cascade,
  title text, detail text, kind text,
  read boolean default false,
  created_at timestamptz default now()
);

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  plan text, price numeric, status text default 'active',
  intro boolean default false, referral boolean default false,
  current_period_end timestamptz,
  created_at timestamptz default now()
);

create table if not exists payouts (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid references bids(id) on delete cascade,
  amount numeric, method text check (method in ('ach','wire')),
  status text default 'pending',
  created_at timestamptz default now()
);

-- ---------- feature flags (from 0003) ----------
create table if not exists feature_flags (
  key text primary key, label text not null, description text,
  audience text not null default 'both' check (audience in ('buyer','vendor','both','admin')),
  enabled boolean not null default false, category text, sort int default 0
);

insert into feature_flags (key,label,description,audience,enabled,category,sort) values
  ('cad_documents','CAD & document intake','Upload and share CAD, drawings, specs, schedules, and images (DWG, DXF, PDF, RVT, IFC, XLSX, images) on projects and bid packages.','both',true,'CAD & Drawings',10),
  ('cad_viewer','In-browser CAD / 3D preview','Preview DXF/IFC/3D models and drawings in the browser without downloading.','both',false,'CAD & Drawings',20),
  ('ai_takeoff','AI quantity takeoff','AI reads drawings and proposes a quantity takeoff / bill of quantities for review.','buyer',false,'CAD & Drawings',30),
  ('text_to_cad','Text-to-CAD concepts','Generate concept CAD/geometry from a text description for early planning.','buyer',false,'CAD & Drawings',40),
  ('boq_line_items','Bill of Quantities (line-item bidding)','Structured line items per package; vendors price each line for apples-to-apples bids.','both',true,'Procurement',50),
  ('rfq_qa','RFQ clarifications (Q&A)','Vendors ask questions on a package; developer answers, visible to all bidders.','both',true,'Procurement',60),
  ('addenda','Addenda & revisions','Broadcast addenda/updates to all bidders on a package.','both',true,'Procurement',70),
  ('sealed_bids','Sealed bidding','Hide bid amounts from the developer until the deadline passes.','buyer',false,'Procurement',80),
  ('prequalification','Vendor prequalification','Require verified license/insurance/compliance before a vendor can bid.','both',true,'Trust & Compliance',90),
  ('bid_scoring','Weighted bid scoring','Score bids on price/timeline/trust with an award recommendation.','buyer',false,'Procurement',100),
  ('cost_codes','CSI / cost codes','Tag packages and line items with CSI division / cost codes.','both',false,'Procurement',110),
  ('payments_ach','ACH / wire payments','Pay awarded vendors by ACH or wire.','buyer',true,'Payments',120),
  ('paypal_subscriptions','PayPal vendor subscription','$100/mo vendor plan billed via PayPal.','vendor',true,'Payments',130),
  ('messaging','In-app messaging','Direct messaging between developers and vendors per package.','both',true,'Collaboration',140)
on conflict (key) do nothing;

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  building_id uuid references buildings(id) on delete set null,
  package_id uuid references packages(id) on delete set null,
  name text not null, kind text, storage_path text, size bigint,
  uploaded_by text references users(id), created_at timestamptz default now()
);

create table if not exists package_line_items (
  id uuid primary key default gen_random_uuid(),
  package_id uuid references packages(id) on delete cascade,
  item_no text, description text not null, qty numeric default 1, unit text,
  cost_code text, notes text, sort int default 0, created_at timestamptz default now()
);

create table if not exists bid_items (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid references bids(id) on delete cascade,
  line_item_id uuid references package_line_items(id) on delete cascade,
  unit_price numeric, qty numeric, amount numeric, note text
);

create table if not exists rfq_questions (
  id uuid primary key default gen_random_uuid(),
  package_id uuid references packages(id) on delete cascade,
  vendor_company_id uuid references companies(id) on delete set null,
  question text not null, answer text, answered_at timestamptz, created_at timestamptz default now()
);

-- ---------- helpful indexes (match common query paths) ----------
create index if not exists idx_company_members_user on company_members(user_id);
create index if not exists idx_buildings_company on buildings(company_id);
create index if not exists idx_packages_building on packages(building_id);
create index if not exists idx_bids_package on bids(package_id);
create index if not exists idx_bids_vendor on bids(vendor_company_id);
create index if not exists idx_documents_package on documents(package_id);
create index if not exists idx_documents_building on documents(building_id);
create index if not exists idx_pli_package on package_line_items(package_id);
create index if not exists idx_rfq_package on rfq_questions(package_id);

-- ===== schema-native-auth.sql =====
-- ============================================================================
-- Divini Procure - NATIVE email/password auth (replaces Authentik OIDC)
-- ----------------------------------------------------------------------------
-- Idempotent ALTERs that extend the existing `users` table (db/schema.sql) with
-- the columns the native auth flow needs: a scrypt password hash, an
-- email-verification gate + token, and a password-reset token.
--
-- Procure applies schema files manually via psql (no migration runner). Apply
-- ONCE, after db/schema.sql, on the local Postgres at localhost:5433:
--
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-native-auth.sql
--
-- Safe to re-run: every statement is guarded with IF NOT EXISTS.
-- Zero em dashes by convention.
-- ============================================================================

alter table users add column if not exists password_hash  text;
alter table users add column if not exists email_verified  boolean default false;
alter table users add column if not exists verify_token    text;
alter table users add column if not exists verify_expires  timestamptz;
alter table users add column if not exists reset_token     text;
alter table users add column if not exists reset_expires   timestamptz;

-- Native auth matches users by email (UPSERT BY EMAIL preserves id + memberships).
-- A unique, case-insensitive index makes that lookup correct and fast.
create unique index if not exists idx_users_email_lower on users (lower(email));

-- Token lookups during verify / reset.
create index if not exists idx_users_verify_token on users (verify_token);
create index if not exists idx_users_reset_token  on users (reset_token);

-- ===== schema-contacts.sql =====
-- Divini Procure - GENERIC CONTACTS + CSV IMPORT BATCHES
-- ======================================================
-- Net-new, additive layer that backs the generic admin CSV Import tool. Two
-- tables:
--
--   contacts        a lightweight, generic contact/lead record (people or
--                   organizations) that an admin can bulk-import. Optionally
--                   scoped to an owning company (owner_company_id). The
--                   exists_in_partner flag supports MANUAL cross-platform
--                   de-dup against Divini Partner.
--
--   import_batches  one summary row per committed import run (any entity type),
--                   recording how many rows were created / skipped as duplicates
--                   / errored, plus who ran it and when.
--
-- These are the ONLY new tables the generic import tool requires. Developers
-- (companies.kind='buyer'), investors (investor_profiles) and products
-- (products) all already exist; the import tool writes into those existing
-- tables directly and never alters them.
--
-- Idempotent: safe to re-run. Apply standalone via psql, e.g.
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-contacts.sql
--   (or:  psql -h localhost -p 5433 -U aibos -d divini_procure -f db/schema-contacts.sql)
-- Zero em dashes by convention.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Generic contact / lead record. owner_company_id is optional (a contact may
-- belong to a developer organization, or be unscoped at the platform level).
-- exists_in_partner is a MANUAL flag for cross-platform de-dup against Divini
-- Partner; nothing sets it automatically.
-- ---------------------------------------------------------------------------
create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  owner_company_id uuid,
  name text,
  email text,
  phone text,
  company_name text,
  role text,
  source text,
  exists_in_partner boolean default false,
  notes text,
  created_by text,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- One summary row per committed import run (developers / investors / contacts /
-- products). Lets an admin audit what each import did.
-- ---------------------------------------------------------------------------
create table if not exists import_batches (
  id uuid primary key default gen_random_uuid(),
  entity_type text,
  row_count int,
  created_count int,
  duplicate_count int,
  error_count int,
  created_by text,
  created_at timestamptz default now()
);

create index if not exists idx_contacts_owner_company on contacts (owner_company_id);

-- ===== schema-crm.sql =====
-- Divini Procure - CRM / SALES PIPELINE + DEMO/ONBOARDING MEETINGS
-- ================================================================
-- Admin-facing sales pipeline. A crm_records row is a tracked subject (a
-- developer, vendor, investor, or other prospect) moving through pipeline
-- stages from first contact to active (or paused / lost). onboarding_meetings
-- log demo and onboarding sessions held against a record: requested documents,
-- follow-up tasks, the assigned admin, a profile-completeness score, and an
-- outcome status.
--
-- The subject MAY reference an existing companies(id) and/or users(id), but
-- both are nullable so a brand-new prospect can be tracked before they have an
-- account. This is additive and stands alone; it does not touch any existing
-- table.
--
-- Idempotent: safe to re-run. Apply standalone via psql, e.g.
--   docker exec -i aibos_postgres psql -U aibos -d divini_procure < db/schema-crm.sql
-- Zero em dashes by convention.

create table if not exists crm_records (
  id uuid primary key default gen_random_uuid(),

  -- developer | vendor | investor | other
  subject_type text not null default 'other'
    check (subject_type in ('developer', 'vendor', 'investor', 'other')),
  subject_company_id uuid,
  subject_user_id    text,

  name  text,
  email text,
  phone text,

  -- prospect | contacted | demo_scheduled | onboarding_started | active | paused | lost
  stage text not null default 'prospect'
    check (stage in ('prospect', 'contacted', 'demo_scheduled',
                     'onboarding_started', 'active', 'paused', 'lost')),

  source           text,
  owner_admin      text,
  notes            text,
  next_action      text,
  next_action_date date,

  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists onboarding_meetings (
  id uuid primary key default gen_random_uuid(),
  crm_record_id uuid references crm_records(id) on delete cascade,
  subject_company_id uuid,

  title        text,
  scheduled_at timestamptz,
  notes        text,
  requested_docs   text[],
  follow_up_tasks  text[],
  assigned_admin   text,
  profile_completeness int,

  -- scheduled | completed | no_show | cancelled
  status text not null default 'scheduled'
    check (status in ('scheduled', 'completed', 'no_show', 'cancelled')),

  created_by text,
  created_at timestamptz default now()
);

create index if not exists crm_records_stage_idx on crm_records(stage);
create index if not exists onboarding_meetings_record_idx on onboarding_meetings(crm_record_id);

-- ===== schema-engagements.sql =====
-- ============================================================================
-- Divini Procure — CURRENT ENGAGEMENTS tracker (idempotent add-on)
-- ----------------------------------------------------------------------------
-- A lightweight "what you have going on" log so existing vendors / developers /
-- investors can record and track the work they already have in flight, separate
-- from formal procurement packages/bids. Company-scoped via company_members.
--
-- APPLY (run once on the local Postgres at localhost:5433):
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-engagements.sql
-- ============================================================================

create extension if not exists "pgcrypto";

create table if not exists current_engagements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  created_by text references users(id),
  title text not null,
  type text,
  status text default 'active',
  counterparty text,
  value_cents bigint,
  location text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_current_engagements_company on current_engagements(company_id);

-- ===== schema-products.sql =====
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

-- ===== schema-vendor-pricing.sql =====
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

-- ===== schema-vendor-import.sql =====
-- Divini Procure - Existing-Vendor CSV Import batch log (optional, additive).
--
-- One row per committed import batch, summarising what the developer brought in:
-- how many rows, how many new starter vendor profiles were created, how many
-- rows linked to an existing vendor company, how many grandfathered relationship
-- attestations were queued for admin review, and how many rows errored.
--
-- This is a log only. No fee logic lives here; grandfathered relationships are
-- written through developer_vendor_relationships via lib/relationships.ts, which
-- keeps the pair-scoped 2% rule and admin-review gating intact.
-- Idempotent. Zero em dashes by convention.

create table if not exists vendor_import_batches (
  id                    uuid primary key default gen_random_uuid(),
  developer_company_id  uuid not null references companies(id) on delete cascade,
  row_count             int not null default 0,
  created_count         int not null default 0,
  linked_count          int not null default 0,
  grandfathered_count   int not null default 0,
  error_count           int not null default 0,
  created_by            text references users(id) on delete set null,
  created_at            timestamptz not null default now()
);

create index if not exists vendor_import_batches_developer_idx
  on vendor_import_batches(developer_company_id);

-- ===== schema-quote-compare.sql =====
-- ============================================================================
-- Divini Procure — Quote Comparison Engine (idempotent add-on)
-- ----------------------------------------------------------------------------
-- Enhancement to the existing schema (db/schema.sql). Adds:
--   * bid_recommendations: the buyer's saved comparison decision per package.
--   * comparison columns on `bids` (lead_time_days, freight_cents, warranty_text,
--     install_cents, scope_notes) so vendors/buyers can capture apples-to-apples
--     dimensions beyond price.
--
-- APPLY (run once against the local Postgres at localhost:5433):
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-quote-compare.sql
-- Re-runnable: every statement is guarded with IF NOT EXISTS.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- comparison dimensions on bids (add only if missing) ----------
alter table bids add column if not exists lead_time_days int;
alter table bids add column if not exists freight_cents bigint;
alter table bids add column if not exists warranty_text text;
alter table bids add column if not exists install_cents bigint;
alter table bids add column if not exists scope_notes text;

-- ---------- buyer's recommendation / award decision per package ----------
create table if not exists bid_recommendations (
  id uuid primary key default gen_random_uuid(),
  package_id uuid references packages(id) on delete cascade,
  selected_bid_id uuid references bids(id),
  notes text,
  status text default 'draft',
  decided_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- One recommendation row per package (upsert target).
create unique index if not exists uniq_bid_recommendations_package
  on bid_recommendations(package_id);

-- ===== schema-rfq-assist.sql =====
-- ============================================================================
-- Divini Procure — RFQ ASSIST schema (idempotent add-on)
-- ----------------------------------------------------------------------------
-- Adds CAD/spec file categorisation to the existing `documents` table and a new
-- `rfq_suggested_lines` table that holds the DETERMINISTIC auto-suggested bid /
-- RFQ line items the developer can review and accept into the real BOQ
-- (package_line_items).
--
-- This file is ADDITIVE and IDEMPOTENT (alter ... if not exists / create table
-- if not exists). It is applied the SAME WAY as db/schema.sql — run once against
-- the local Postgres AFTER db/schema.sql (+ db/schema-superadmin.sql):
--
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-rfq-assist.sql
--   (or:  psql -h localhost -p 5433 -U aibos -d divini_procure -f db/schema-rfq-assist.sql)
--
-- Re-running it is safe. Zero em dashes by convention of the ported routers.
--
-- NOTE: `documents` already links to packages (package_id uuid references
-- packages(id) on delete set null) and buildings, so NO new link column is
-- needed. We only add `category` to tag what kind of drawing/spec a file is.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- documents: category tag ----------
-- Classifies an uploaded file so the suggester knows which uploads are text
-- specs vs binary CAD. Values used by the app: cad | spec | drawing |
-- finish_schedule | other. Left nullable; existing rows keep null.
alter table documents add column if not exists category text;

-- ---------- rfq_suggested_lines ----------
-- Deterministic auto-suggested line items for a package's RFQ/BOQ. These are
-- NOT the real bill of quantities; the developer reviews them and accepts the
-- ones they want, which then get inserted into package_line_items and the
-- suggestion is marked 'applied'.
create table if not exists rfq_suggested_lines (
  id uuid primary key default gen_random_uuid(),
  package_id uuid references packages(id) on delete cascade,
  name text,
  category text,
  qty numeric,
  unit text,
  spec text,
  notes text,
  status text default 'suggested',   -- suggested | applied | dismissed
  created_at timestamptz default now()
);

create index if not exists idx_rfq_suggested_package on rfq_suggested_lines(package_id);
create index if not exists idx_documents_category on documents(category);

-- ===== schema-award-workflow.sql =====
-- ============================================================================
-- Divini Procure - Award-to-Procurement Workflow (idempotent add-on)
-- ----------------------------------------------------------------------------
-- After a bid is awarded, the developer (the building/package owner) manages
-- the procurement lifecycle that follows the award:
--   1. award confirmation     -> a purchase order is drafted from the bid
--   2. purchase order          -> status draft -> issued -> acknowledged ->
--                                 in_production -> fulfilled (or cancelled)
--   3. payment authorization   -> RECORD ONLY. This system NEVER moves money.
--                                 Each row is a recorded authorization/release
--                                 against a purchase order for audit purposes.
--   4. production/delivery/install -> referenced via the existing deliveries
--                                     system (db/schema-delivery.sql). Not
--                                     rebuilt here.
--   5. closeout + warranty documents -> stored as award_documents rows linked
--                                        to the purchase order.
--
-- Submittals (db/schema-approvals.sql) and deliveries (db/schema-delivery.sql)
-- already exist as separate systems. This add-on links to them by package id;
-- it does NOT duplicate them.
--
-- Money is stored as integer cents (amount_cents bigint). The originating
-- bid's price is dollars (bids.price numeric), so amount_cents = round(price*100).
--
-- APPLY (run once against the local Postgres at localhost:5433):
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-award-workflow.sql
-- Re-runnable: every statement is guarded with IF NOT EXISTS. Zero em dashes.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- purchase orders (one per awarded bid, draftable) ----------
-- status lifecycle: draft | issued | acknowledged | in_production | fulfilled | cancelled
create table if not exists purchase_orders (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid references bids(id) on delete set null,
  package_id uuid,
  building_id uuid,
  developer_company_id uuid,
  vendor_company_id uuid,
  po_number text,
  amount_cents bigint,
  status text default 'draft'
    check (status in ('draft','issued','acknowledged','in_production','fulfilled','cancelled')),
  terms text,
  notes text,
  issued_at timestamptz,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------- payment authorizations (RECORD ONLY: no fund movement) ----------
-- status lifecycle: pending | authorized | released | void
create table if not exists payment_authorizations (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid references purchase_orders(id) on delete cascade,
  amount_cents bigint,
  fee_percentage numeric,
  fee_cents bigint,
  payer_type text,
  status text default 'pending'
    check (status in ('pending','authorized','released','void')),
  authorized_by text,
  authorized_at timestamptz,
  notes text,
  created_at timestamptz default now()
);

-- ---------- closeout / warranty / po / other documents ----------
create table if not exists award_documents (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid references purchase_orders(id) on delete cascade,
  doc_kind text check (doc_kind in ('closeout','warranty','po','other')),
  title text,
  url text,
  created_by text,
  created_at timestamptz default now()
);

-- ---------- indexes (match common query paths) ----------
create index if not exists idx_purchase_orders_developer on purchase_orders(developer_company_id);
create index if not exists idx_purchase_orders_vendor on purchase_orders(vendor_company_id);
create index if not exists idx_purchase_orders_package on purchase_orders(package_id);
create index if not exists idx_payment_auth_po on payment_authorizations(purchase_order_id);
create index if not exists idx_award_documents_po on award_documents(purchase_order_id);

-- ===== schema-change-orders.sql =====
-- ============================================================================
-- Divini Procure - Change Order Management (idempotent add-on)
-- ----------------------------------------------------------------------------
-- Additive enhancement to the existing schema (db/schema.sql). Layers a change
-- order lifecycle on top of a project (buildings) and, optionally, a package.
-- A developer (the building's owning company) raises a change order against a
-- vendor, capturing cost and schedule impact, and advances it through a review
-- workflow. When investor approval is required the change order also carries an
-- independent investor approval status. Every create and status change appends
-- an immutable change_order_audit row (actor = current user email).
--
--   * change_orders:      one record per change order on a project/package.
--   * change_order_audit: append-only activity log (create + status changes).
--
-- Lifecycle (status):
--   draft -> submitted -> under_review -> approved | rejected | cancelled
--
-- Investor approval (investor_approval_status), independent of status:
--   not_required | pending -> approved | rejected
--
-- APPLY (run once against the local Postgres at localhost:5433):
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-change-orders.sql
-- Re-runnable: every statement is guarded with IF NOT EXISTS. Integer cents.
-- Zero em dashes by convention.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- change order record (per project / optional package) ----------
create table if not exists change_orders (
  id uuid primary key default gen_random_uuid(),
  building_id uuid references buildings(id) on delete cascade,
  package_id uuid references packages(id) on delete set null,
  vendor_company_id uuid,
  developer_company_id uuid,
  co_number text,
  title text,
  description text,
  cost_impact_cents bigint default 0,
  schedule_impact_days int default 0,
  status text default 'draft'
    check (status in ('draft','submitted','under_review','approved','rejected','cancelled')),
  investor_approval_required boolean default false,
  investor_approval_status text default 'not_required'
    check (investor_approval_status in ('not_required','pending','approved','rejected')),
  document_url text,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------- append-only audit log per change order ----------
create table if not exists change_order_audit (
  id uuid primary key default gen_random_uuid(),
  change_order_id uuid references change_orders(id) on delete cascade,
  actor_email text,
  action text,
  detail jsonb,
  created_at timestamptz default now()
);

-- ---------- indexes (match common query paths) ----------
create index if not exists idx_change_orders_building on change_orders(building_id);
create index if not exists idx_change_orders_developer on change_orders(developer_company_id);
create index if not exists idx_change_order_audit_co on change_order_audit(change_order_id);

-- ===== schema-delivery.sql =====
-- ============================================================================
-- Divini Procure — Delivery & Installation Tracking (idempotent add-on)
-- ----------------------------------------------------------------------------
-- Enhancement to the existing schema (db/schema.sql). Adds a delivery/install
-- lifecycle on top of awarded packages so the buyer and the assigned vendor can
-- track Production -> Shipped -> Delivered -> Installing -> Installed -> Complete,
-- record the relevant dates, keep a punch list, and read an events log.
--
--   * deliveries:           one delivery record per package/vendor pairing.
--   * delivery_punch_items: open/resolved punch list items per delivery.
--   * delivery_events:      append-only activity log (every status/date change).
--
-- APPLY (run once against the local Postgres at localhost:5433):
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-delivery.sql
-- Re-runnable: every statement is guarded with IF NOT EXISTS.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- delivery record (per package / vendor) ----------
-- status lifecycle: in_production | shipped | delivered | installing | installed | complete | delayed
create table if not exists deliveries (
  id uuid primary key default gen_random_uuid(),
  package_id uuid references packages(id) on delete cascade,
  vendor_company_id uuid references companies(id),
  submittal_id uuid,
  production_status text default 'not_started',
  shipping_status text default 'not_shipped',
  ship_date date,
  expected_delivery date,
  delivery_date date,
  install_date date,
  completion_date date,
  status text default 'in_production',
  notes text,
  created_by text references users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------- punch list items per delivery ----------
create table if not exists delivery_punch_items (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid references deliveries(id) on delete cascade,
  description text,
  resolved boolean default false,
  created_at timestamptz default now()
);

-- ---------- append-only events log per delivery ----------
create table if not exists delivery_events (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid references deliveries(id) on delete cascade,
  label text,
  actor text,
  created_at timestamptz default now()
);

-- ---------- indexes (match common query paths) ----------
create index if not exists idx_deliveries_package on deliveries(package_id);
create index if not exists idx_delivery_punch_delivery on delivery_punch_items(delivery_id);
create index if not exists idx_delivery_events_delivery on delivery_events(delivery_id);

-- ===== schema-approvals.sql =====
-- ============================================================================
-- Divini Procure — SUBMITTAL & APPROVAL management (idempotent add-on)
-- ----------------------------------------------------------------------------
-- A construction-style submittal workflow on top of a procurement package: a
-- vendor (or the package owner) creates a submittal, then it moves through a
-- linear status lifecycle with a full audit trail. Read/write authorization is
-- enforced in the Express backend (server/src/routes/submittals.ts): the
-- package owner OR the assigned vendor company, mirroring userOwnsPackage +
-- company_members membership. Admins are allowed. Zero em dashes by convention.
--
-- Statuses (linear, with the ability to send back to revision_required):
--   draft -> submitted -> review -> revision_required -> approved
--         -> ordered -> delivered -> installed -> closed
--
-- APPLY (run once on the local Postgres at localhost:5433):
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-approvals.sql
-- ============================================================================

create extension if not exists "pgcrypto";

-- One submittal per item/scope being approved. Optionally tied to a single BOQ
-- line item and to the vendor company responsible for it.
create table if not exists submittals (
  id uuid primary key default gen_random_uuid(),
  package_id uuid references packages(id) on delete cascade,
  line_item_id uuid,
  vendor_company_id uuid references companies(id),
  title text not null,
  type text,
  current_status text not null default 'draft',
  created_by text references users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Append-only audit trail: one row per status change (including the initial
-- draft row written at creation), capturing the actor and any comments.
create table if not exists submittal_history (
  id uuid primary key default gen_random_uuid(),
  submittal_id uuid references submittals(id) on delete cascade,
  status text,
  actor text,
  comments text,
  created_at timestamptz default now()
);

create index if not exists idx_submittals_package on submittals(package_id);
create index if not exists idx_submittal_history_submittal on submittal_history(submittal_id);

-- ===== schema-agreements.sql =====
-- ============================================================================
-- Divini Procure - AGREEMENTS + native e-signature.
--
-- A lightweight agreements engine ported from Divini Partners and mapped onto
-- the Procure data model (companies, buildings=projects, developer_vendor_
-- relationships). An admin (or a company member acting for their own company)
-- creates an agreement from a built-in template (body rendered server-side) or
-- by attaching an uploaded file_url, sends it to a counterparty by email, and
-- the counterparty signs natively (typed signature + affirmation). Every
-- signature captures signer identity, IP, user-agent and a timestamp.
--
-- This RECORDS and tracks the agreement lifecycle; it does not move money.
-- Additive only. No ALTER of existing tables. Idempotent: safe to run repeatedly.
-- ============================================================================

create extension if not exists pgcrypto;

-- Custom (admin-authored) templates. Built-in templates live in code
-- (server/src/lib/agreement-templates.ts); this table holds overrides + extras.
create table if not exists agreement_templates (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  name text not null,
  kind text,
  body text,
  created_by text,
  created_at timestamptz not null default now()
);

-- An issued agreement. Exactly one party_company_id is the issuing/owning side;
-- counterparty_email is who must sign. project_id (a building) and
-- relationship_id (a developer-vendor pair) are optional context links.
create table if not exists agreements (
  id uuid primary key default gen_random_uuid(),
  template_key text,
  title text not null,
  kind text,
  party_company_id uuid references companies(id) on delete set null,
  counterparty_email text,
  project_id uuid references buildings(id) on delete set null,
  relationship_id uuid references developer_vendor_relationships(id) on delete set null,
  body text,
  file_url text,
  status text not null default 'draft'
    check (status in ('draft','sent','viewed','signed','needs_revision','expired','cancelled')),
  sent_at timestamptz,
  viewed_at timestamptz,
  signed_at timestamptz,
  expires_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Native signature record. Tamper-evident enough for an internal marketplace:
-- signer identity + typed signature + IP + user-agent + timestamp + audit blob.
create table if not exists agreement_signatures (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid references agreements(id) on delete cascade,
  signer_name text,
  signer_email text,
  signer_company_id uuid,
  signature_text text,
  signed_at timestamptz not null default now(),
  ip text,
  user_agent text,
  audit jsonb
);

create index if not exists idx_agreements_party on agreements(party_company_id);
create index if not exists idx_agreements_status on agreements(status);
create index if not exists idx_agreement_signatures_agreement on agreement_signatures(agreement_id);

-- ===== schema-split-terms.sql =====
-- ============================================================================
-- Divini Procure - PER-PARTY SPLIT TERMS schema (idempotent)
-- ----------------------------------------------------------------------------
-- The AGREED disbursement-share terms for any party (referral partner, client,
-- vendor, developer profile, or other) on a given revenue context. The payout
-- split engine (server/src/lib/split-engine.ts) reads ACTIVE rows here when a
-- platform_revenue row is collected and produces one payout_instructions row
-- per matching term, feeding the 1-click payout queue.
--
-- A term scopes itself by developer_company_id and/or vendor_company_id and/or
-- program_id. basis says what the share is computed on: 'fee' (the platform fee,
-- fee_cents) or 'payment' (the gross payment base, base_cents). The amount is
-- percentage of that basis, or a fixed flat_cents. Conservative by design: a
-- term only produces a split where it is active AND has a real recipient AND a
-- positive amount. We never invent a split.
--
-- ADDITIVE and IDEMPOTENT (create table if not exists ...). Apply once, AFTER
-- db/schema.sql, db/schema-revenue.sql, db/schema-payouts.sql:
--
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-split-terms.sql
--   (or:  psql -h localhost -p 5433 -U aibos -d divini_procure -f db/schema-split-terms.sql)
--
-- Re-running it is safe. Zero em dashes below this line by convention.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- split terms (agreed per-party share rules) ----------
-- One row per agreed share for one recipient on one revenue context. The
-- recipient is identified by recipient_kind plus the relevant id column
-- (company / user / referral partner). basis 'fee' computes on fee_cents,
-- 'payment' on base_cents. percentage is a share of the basis; flat_cents is a
-- fixed amount (used when percentage is null). active gates whether the engine
-- reads it.
create table if not exists split_terms (
  id uuid primary key default gen_random_uuid(),
  recipient_kind text check (recipient_kind in ('referral_partner','client','vendor','profile','other')),
  recipient_company_id uuid,
  recipient_user_id text,
  recipient_referral_partner_id uuid,
  developer_company_id uuid,
  vendor_company_id uuid,
  program_id uuid,
  basis text check (basis in ('fee','payment')) default 'fee',
  percentage numeric,
  flat_cents bigint,
  active boolean default true,
  notes text,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists split_terms_developer_idx on split_terms (developer_company_id);
create index if not exists split_terms_active_idx on split_terms (active);

-- ===== schema-bid-invites.sql =====
-- ============================================================================
-- Divini Procure - BID INVITES (one-click invite-matched-vendor handoff)
-- ----------------------------------------------------------------------------
-- A developer (buyer) who runs vendor matching in the Procurement Intelligence
-- view can invite a matched vendor to bid on a specific package, capturing the
-- match score at invite time. The invited vendor sees the opportunity in their
-- "invited opportunities" list and can act on it.
--
-- One canonical invite row per (package, vendor) pair. status tracks the
-- handoff lifecycle. match_score is the Divini-Score + relationship blended
-- score from intel ranking at the moment of the invite (for context only).
--
-- ADDITIVE and IDEMPOTENT (create table if not exists ...). Apply once on the
-- local Postgres at localhost:5433, AFTER db/schema.sql and the moat / fee
-- add-ons:
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-bid-invites.sql
-- Zero em dashes by convention.
-- ============================================================================

create extension if not exists "pgcrypto";

create table if not exists bid_invites (
  id uuid primary key default gen_random_uuid(),
  package_id uuid references packages(id) on delete cascade,
  vendor_company_id uuid references companies(id) on delete cascade,
  developer_company_id uuid,
  status text default 'invited' check (status in ('invited','viewed','bid_submitted','declined','expired')),
  match_score int,
  message text,
  invited_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (package_id, vendor_company_id)
);

create index if not exists idx_bid_invites_vendor on bid_invites(vendor_company_id);

-- ===== schema-fee-matrix.sql =====
-- Divini Procure - FEE MATRIX + payer_type
-- =========================================================
-- Additive layer on top of the grandfathered existing-relationship fee.
-- A configurable matrix of platform fee rules (standard platform fee, preferred
-- vendor placement, white glove, referral partner, capital introduction) with a
-- payer_type dimension (who pays / how it is collected) and a scope dimension
-- (global default, or scoped to a specific developer, vendor, developer-vendor
-- pair, or program). This does NOT touch developer_vendor_relationships: a pair
-- already grandfathered (relationship_status = 'grandfathered_2_percent') ALWAYS
-- wins and is resolved first in server/src/lib/fee-matrix.ts. The matrix only
-- decides what applies when no grandfathered pair governs the context.
--
-- Idempotent: safe to re-run. Apply standalone via psql, e.g.
--   docker exec -i aibos_postgres psql -U aibos -d divini_procure < db/schema-fee-matrix.sql
-- Zero em dashes by convention. Integer cents (flat_cents bigint).

create table if not exists fee_rules (
  id uuid primary key default gen_random_uuid(),

  -- grandfathered_2pct (informational mirror only; the live grandfathered rate
  -- is resolved from developer_vendor_relationships, never from this table) |
  -- standard_platform | preferred_vendor_placement | white_glove |
  -- referral_partner | capital_introduction
  rule_type text not null check (rule_type in (
    'grandfathered_2pct',
    'standard_platform',
    'preferred_vendor_placement',
    'white_glove',
    'referral_partner',
    'capital_introduction'
  )),

  -- global | developer | vendor | pair | program
  scope text not null default 'global' check (scope in (
    'global', 'developer', 'vendor', 'pair', 'program'
  )),

  developer_company_id uuid references companies(id) on delete cascade,
  vendor_company_id    uuid references companies(id) on delete cascade,
  program_id           uuid,

  percentage numeric,
  flat_cents bigint,

  -- developer_pays | vendor_pays | split_fee | deducted_from_vendor_payment |
  -- added_to_developer_invoice | admin_configured
  payer_type text not null default 'admin_configured' check (payer_type in (
    'developer_pays',
    'vendor_pays',
    'split_fee',
    'deducted_from_vendor_payment',
    'added_to_developer_invoice',
    'admin_configured'
  )),

  billing_cycle text,
  active boolean not null default true,
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_fee_rules_rule_type on fee_rules (rule_type);
create index if not exists idx_fee_rules_developer on fee_rules (developer_company_id);
create index if not exists idx_fee_rules_vendor on fee_rules (vendor_company_id);

create table if not exists fee_rule_audit (
  id uuid primary key default gen_random_uuid(),
  fee_rule_id uuid,
  actor_email text,
  action text,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_fee_rule_audit_rule on fee_rule_audit (fee_rule_id);

-- ---------------------------------------------------------------------------
-- Seed default GLOBAL rules. There is no unique constraint to lean on (a scope
-- may legitimately have many rows), so each seed inserts only when no global
-- row of that rule_type exists yet. Re-running is a no-op.
-- ---------------------------------------------------------------------------

-- Standard platform fee: 10% default, developer pays.
insert into fee_rules (rule_type, scope, percentage, payer_type, notes, created_by)
select 'standard_platform', 'global', 10.0, 'developer_pays',
       'Default Divini Procure platform/referral fee.', 'seed'
where not exists (
  select 1 from fee_rules where rule_type = 'standard_platform' and scope = 'global'
);

-- Preferred vendor placement: flat monthly placement fee, vendor pays.
insert into fee_rules (rule_type, scope, flat_cents, payer_type, billing_cycle, notes, created_by)
select 'preferred_vendor_placement', 'global', 50000, 'vendor_pays', 'monthly',
       'Flat monthly preferred placement fee charged to the vendor.', 'seed'
where not exists (
  select 1 from fee_rules where rule_type = 'preferred_vendor_placement' and scope = 'global'
);

-- White glove concierge service: percentage, developer pays.
insert into fee_rules (rule_type, scope, percentage, payer_type, notes, created_by)
select 'white_glove', 'global', 15.0, 'developer_pays',
       'White glove concierge procurement service fee.', 'seed'
where not exists (
  select 1 from fee_rules where rule_type = 'white_glove' and scope = 'global'
);

-- Referral partner share: percentage, admin configured per arrangement.
insert into fee_rules (rule_type, scope, percentage, payer_type, notes, created_by)
select 'referral_partner', 'global', 5.0, 'admin_configured',
       'Referral partner revenue share. Configure per arrangement.', 'seed'
where not exists (
  select 1 from fee_rules where rule_type = 'referral_partner' and scope = 'global'
);

-- Capital introduction fee: percentage, admin configured.
insert into fee_rules (rule_type, scope, percentage, payer_type, notes, created_by)
select 'capital_introduction', 'global', 2.0, 'admin_configured',
       'Capital introduction fee for investor matching. Configure per arrangement.', 'seed'
where not exists (
  select 1 from fee_rules where rule_type = 'capital_introduction' and scope = 'global'
);

-- ===== schema-grandfathered-fee.sql =====
-- Divini Procure - GRANDFATHERED EXISTING-RELATIONSHIP FEE
-- =========================================================
-- Tracks a SPECIFIC developer (buyer company) <-> vendor company relationship
-- and, when the developer attests the relationship pre-existed Divini Procure
-- (already under contract, already working together, already in active
-- negotiations, or already selected/shortlisted), grandfathers THAT pair into a
-- 2% payment-authorization fee forever. The 2% applies ONLY to that one
-- developer-vendor pair, never globally to the vendor and never to other
-- developers.
--
-- Extends the EXISTING model: developers are companies(kind='buyer'),
-- vendors are companies(kind='vendor'), projects are buildings(id). This does
-- NOT touch referral_partners / partner_commissions (those stay as-is).
--
-- Idempotent: safe to re-run. Apply standalone via psql, e.g.
--   docker exec -i aibos_postgres psql -U aibos -d divini_procure < db/schema-grandfathered-fee.sql
-- Zero em dashes by convention.

create table if not exists developer_vendor_relationships (
  id uuid primary key default gen_random_uuid(),
  developer_company_id uuid not null references companies(id) on delete cascade,
  vendor_company_id    uuid not null references companies(id) on delete cascade,
  project_id           uuid references buildings(id) on delete set null,

  -- no_prior_relationship | existing_relationship_claimed |
  -- existing_relationship_under_review | grandfathered_2_percent |
  -- standard_fee | disputed | inactive
  relationship_status  text not null default 'no_prior_relationship',

  -- developer attestation that the relationship pre-existed the platform
  existing_relationship_confirmed boolean default false,
  -- active_contract | active_negotiation | already_working_together |
  -- already_selected_or_shortlisted | prior_vendor_relationship | other
  existing_relationship_type      text,
  existing_relationship_confirmed_by text references users(id) on delete set null,
  existing_relationship_confirmed_at timestamptz,
  existing_relationship_notes     text,
  supporting_document_url         text,

  -- granular pre-platform flags (one or more may be true)
  active_contract_before_platform              boolean default false,
  active_negotiations_before_platform          boolean default false,
  already_working_together_before_platform     boolean default false,
  already_selected_or_shortlisted_before_platform boolean default false,

  -- grandfathered 2% fee state (relationship-specific, forever)
  grandfathered_fee_eligible        boolean default false,
  grandfathered_fee_percentage      numeric not null default 2.00,
  grandfathered_fee_applies_forever boolean default true,
  grandfathered_fee_started_at      timestamptz,

  -- standard fee captured for contrast/reporting (nullable; resolved from
  -- platform settings at calc time when null)
  standard_fee_percentage numeric,

  -- developer_checkbox | admin_override | contract_upload | negotiation_proof |
  -- legacy_relationship | manual_adjustment
  fee_rule_source text,

  -- not_required | pending_review | approved | rejected | needs_more_info
  admin_review_status text not null default 'not_required',
  admin_reviewed_by   text references users(id) on delete set null,
  admin_reviewed_at   timestamptz,
  admin_notes         text,

  audit_log_id uuid,
  created_by   text references users(id) on delete set null,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),

  -- one canonical relationship row per developer-vendor pair
  unique (developer_company_id, vendor_company_id)
);

create index if not exists dvr_developer_idx on developer_vendor_relationships(developer_company_id);
create index if not exists dvr_vendor_idx    on developer_vendor_relationships(vendor_company_id);
create index if not exists dvr_review_idx    on developer_vendor_relationships(admin_review_status);
create index if not exists dvr_status_idx    on developer_vendor_relationships(relationship_status);

-- Append-only audit trail for every relationship/fee event.
create table if not exists dvr_audit_log (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid references developer_vendor_relationships(id) on delete cascade,
  developer_company_id uuid,
  vendor_company_id    uuid,
  actor_user_id text,
  actor_email   text,
  -- relationship_created | existing_relationship_confirmed | status_change |
  -- admin_review | fee_override | fee_change | document_uploaded | disputed |
  -- deactivated
  action text not null,
  detail jsonb,
  created_at timestamptz default now()
);

create index if not exists dvr_audit_rel_idx on dvr_audit_log(relationship_id);

-- Safety: ensure columns exist if an older partial version of the table was
-- created previously (no-ops when already present).
alter table developer_vendor_relationships add column if not exists project_id uuid references buildings(id) on delete set null;
alter table developer_vendor_relationships add column if not exists supporting_document_url text;
alter table developer_vendor_relationships add column if not exists standard_fee_percentage numeric;
alter table developer_vendor_relationships add column if not exists fee_rule_source text;
alter table developer_vendor_relationships add column if not exists admin_reviewed_by text;
alter table developer_vendor_relationships add column if not exists admin_reviewed_at timestamptz;

-- ===== schema-procure-rev.sql =====
-- ============================================================================
-- Divini Procure - REFERRAL REVENUE / COMMISSION + PAYOUT schema (idempotent)
-- ----------------------------------------------------------------------------
-- Enhancement on top of the EXISTING referral_partners table (see
-- db/schema-superadmin.sql). Brings Procure's referral revenue-share up to the
-- Divini Partners admin level: a PROFIT-BASED commission ledger plus payout
-- tracking/management. Ported in shape from Divini Partners' rev-partner /
-- rev-payout schemas, mapped to Procure's `companies` (not `organizations`).
--
-- ADDITIVE and IDEMPOTENT (create table if not exists ...). Apply once, AFTER
-- db/schema.sql and db/schema-superadmin.sql, the same way:
--
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-procure-rev.sql
--   (or:  psql -h localhost -p 5433 -U aibos -d divini_procure -f db/schema-procure-rev.sql)
--
-- Re-running it is safe. Zero em dashes below this line by convention.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- partner commissions (the profit-based ledger) ----------
-- One row per earning event attributed to a referral partner. The commission is
-- a share of Divini's PROFIT on the event (platform_fee - processing_cost),
-- NEVER a share of the gross invoice. net_profit_cents and commission_cents are
-- computed server-side at insert time from the partner's revenue_share_pct /
-- commission_type. Rows can be excluded from a payout roll-up without deletion.
create table if not exists partner_commissions (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid references referral_partners(id) on delete cascade,
  referred_company_id uuid references companies(id) on delete set null,
  source text default 'subscription',          -- subscription | transaction | setup | enterprise | manual_adjustment
  gross_cents bigint default 0,                 -- original invoice (reference only)
  platform_fee_cents bigint default 0,          -- platform fee we collected
  processing_cost_cents bigint default 0,       -- processing cost we paid
  net_profit_cents bigint default 0,            -- max(0, platform_fee - processing_cost)
  commission_cents bigint default 0,            -- net_profit * share% (or flat)
  status text default 'pending',                -- pending | approved | paid | held | disputed
  excluded boolean default false,               -- excluded from payout roll-up
  created_at timestamptz default now()
);
create index if not exists partner_commissions_partner_idx on partner_commissions (partner_id);

-- ---------- partner payouts (period roll-up + disbursement tracking) ----------
-- A payout is a per-partner, per-period roll-up of non-excluded commissions.
-- commission_owed_cents = sum(commission_cents) + manual_adjustment_cents.
-- This table RECORDS and TRACKS payouts; it never moves money.
create table if not exists partner_payouts (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid references referral_partners(id) on delete cascade,
  period text,                                  -- free-text period label, e.g. '2026-06'
  gross_volume_cents bigint default 0,
  platform_fees_cents bigint default 0,
  processing_costs_cents bigint default 0,
  net_profit_cents bigint default 0,
  commission_pct numeric,
  commission_owed_cents bigint default 0,
  commission_paid_cents bigint default 0,
  manual_adjustment_cents bigint default 0,
  status text default 'pending',                -- pending | approved | scheduled | paid | held | disputed | cancelled
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists partner_payouts_partner_idx on partner_payouts (partner_id);

-- ===== schema-revenue.sql =====
-- ============================================================================
-- Divini Procure - PLATFORM REVENUE LEDGER schema (idempotent)
-- ----------------------------------------------------------------------------
-- The accrual ledger for Divini's own platform revenue. When a developer
-- awards a bid and authorizes a payment, the correct fee (grandfathered /
-- matrix / standard) is resolved and a platform_revenue row is RECORDED here at
-- status 'accrued'. This table RECORDS and ACCRUES revenue; it NEVER charges a
-- card or moves money. An admin later marks a row 'invoiced'/'collected'/etc by
-- hand. Re-running this file is safe (create table if not exists ...).
--
-- Apply once, AFTER db/schema.sql and db/schema-award-workflow.sql:
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-revenue.sql
--   (or:  psql -h localhost -p 5433 -U aibos -d divini_procure -f db/schema-revenue.sql)
--
-- Zero em dashes below this line by convention.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- platform revenue (the accrual ledger) ----------
-- One row per accrued revenue event. source_type tells you where it came from
-- (a procurement fee on a payment authorization, a capital-introduction fee, a
-- subscription, or a manual entry). base_cents is the amount the fee was
-- computed on; fee_cents is what Divini accrues. fee_source / payer_type carry
-- the fee-matrix resolution context so the ledger is self-explaining. status
-- moves accrued -> invoiced -> collected (or waived / void) by ADMIN action
-- only; nothing here auto-charges. payment_authorization_id is the idempotency
-- key for procurement fees (one accrual per authorization).
create table if not exists platform_revenue (
  id uuid primary key default gen_random_uuid(),
  source_type text not null default 'procurement_fee'
    check (source_type in ('procurement_fee','capital_introduction','subscription','manual')),
  developer_company_id uuid,
  vendor_company_id uuid,
  purchase_order_id uuid,
  payment_authorization_id uuid,
  program_id uuid,
  base_cents bigint,
  fee_percentage numeric,
  fee_cents bigint,
  fee_source text,
  payer_type text,
  status text not null default 'accrued'
    check (status in ('accrued','invoiced','collected','waived','void')),
  collected_at timestamptz,
  notes text,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists platform_revenue_status_idx on platform_revenue (status);
create index if not exists platform_revenue_developer_idx on platform_revenue (developer_company_id);
-- One accrual per payment authorization (idempotency for procurement fees).
create unique index if not exists platform_revenue_payment_auth_uniq
  on platform_revenue (payment_authorization_id)
  where payment_authorization_id is not null;

-- ===== schema-payouts.sql =====
-- ============================================================================
-- Divini Procure - STRIPE CONNECT PAYOUT RAIL schema (idempotent)
-- ----------------------------------------------------------------------------
-- The disbursement rail. A recipient (referral partner, client, vendor, or any
-- profile) connects a bank account via a STRIPE-HOSTED onboarding link; we store
-- ONLY the Stripe Connect account id (acct_...), boolean status flags, and the
-- bank last4 that Stripe returns. We NEVER store a raw bank account or routing
-- number; the numbers live with Stripe (the licensed money transmitter).
--
-- When a platform_revenue row is collected, the agreed split for each party is
-- computed and a payout_instructions row is queued. An admin/owner RELEASES a
-- split with one click; only then does the server INSTRUCT Stripe to transfer
-- the funds to the recipient's bank. NOTHING here moves money on its own; the
-- live transfer is gated on a configured Stripe key AND payouts_enabled.
--
-- ADDITIVE and IDEMPOTENT (create table if not exists ...). Apply once, AFTER
-- db/schema.sql, db/schema-revenue.sql, db/schema-superadmin.sql, the same way:
--
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-payouts.sql
--   (or:  psql -h localhost -p 5433 -U aibos -d divini_procure -f db/schema-payouts.sql)
--
-- Re-running it is safe. Zero em dashes below this line by convention.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- connect accounts (Stripe Connect onboarding state) ----------
-- One row per payout recipient owner. owner_kind tells you whether the bank
-- belongs to a company (vendor/client/developer profile), an investor user, or
-- a referral partner. stripe_account_id is the ONLY Stripe identifier we keep
-- (acct_...). charges_enabled / payouts_enabled / details_submitted mirror the
-- Stripe account capability flags; payouts_enabled is the gate that must be true
-- before any release attempts a transfer. bank_last4 is the masked tail Stripe
-- returns for display only. We store NO raw bank account or routing numbers.
create table if not exists connect_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_kind text check (owner_kind in ('company','investor','referral_partner')),
  owner_company_id uuid,
  owner_user_id text,
  owner_referral_partner_id uuid,
  stripe_account_id text,
  status text default 'not_started'
    check (status in ('not_started','onboarding','restricted','enabled','disabled')),
  charges_enabled boolean default false,
  payouts_enabled boolean default false,
  details_submitted boolean default false,
  bank_last4 text,
  country text,
  default_currency text default 'usd',
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (owner_kind, owner_company_id, owner_user_id, owner_referral_partner_id)
);
create index if not exists connect_accounts_company_idx on connect_accounts (owner_company_id);

-- ---------- payout instructions (the disbursement queue) ----------
-- One row per recipient split for a revenue event. basis_cents is the amount the
-- split was computed on (typically the platform fee), split_percentage is the
-- agreed share, amount_cents is what the recipient is owed. status flows
-- pending -> ready (when the recipient has a payouts-enabled connect account) ->
-- releasing -> paid, or blocked / failed / held / canceled. stripe_transfer_id
-- is the id of the Stripe transfer once a release succeeds. Nothing here moves
-- money; the transfer is instructed only from the 1-click release route.
create table if not exists payout_instructions (
  id uuid primary key default gen_random_uuid(),
  source_revenue_id uuid,
  payment_authorization_id uuid,
  purchase_order_id uuid,
  recipient_kind text check (recipient_kind in ('referral_partner','client','vendor','profile')),
  recipient_company_id uuid,
  recipient_user_id text,
  recipient_referral_partner_id uuid,
  connect_account_id uuid references connect_accounts(id) on delete set null,
  basis_cents bigint,
  split_percentage numeric,
  amount_cents bigint,
  currency text default 'usd',
  status text default 'pending'
    check (status in ('pending','ready','releasing','paid','failed','blocked','held','canceled')),
  stripe_transfer_id text,
  failure_reason text,
  released_by text,
  released_at timestamptz,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists payout_instructions_status_idx on payout_instructions (status);

-- ---------- payout audit (append-only action log) ----------
-- Every connect/onboard/queue/release/block/fail/hold/cancel action appends a
-- row here so the disbursement trail is fully auditable.
create table if not exists payout_audit (
  id uuid primary key default gen_random_uuid(),
  instruction_id uuid,
  actor_email text,
  action text,
  detail jsonb,
  created_at timestamptz default now()
);
create index if not exists payout_audit_instruction_idx on payout_audit (instruction_id);

-- ===== schema-verification.sql =====
-- ---------------------------------------------------------------------------
-- Divini Procure - ADMIN VERIFICATION WORKFLOWS schema. ADDITIVE.
--
-- Backs server/src/routes/verification.ts:
--   (A) admin review of vendor credentials (license / insurance / compliance
--       docs) -> recomputes vendor_profiles.verify_status.
--   (B) admin verification of investor accreditation / KYC on
--       investor_qualification_records -> may approve investor_profiles.
--
-- Idempotent. Apply with:
--   psql "$DATABASE_URL" -f db/schema-verification.sql
-- ---------------------------------------------------------------------------

-- Review trail columns on vendor_credentials (additive, idempotent).
alter table if exists vendor_credentials add column if not exists reviewed_by text;
alter table if exists vendor_credentials add column if not exists reviewed_at timestamptz;
alter table if exists vendor_credentials add column if not exists review_notes text;

-- Append-only audit log for every admin verification action.
create table if not exists verification_audit (
  id uuid primary key default gen_random_uuid(),
  subject_type text,
  subject_id uuid,
  action text,
  actor_email text,
  detail jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_verification_audit_subject
  on verification_audit (subject_type, subject_id);
create index if not exists idx_verification_audit_created
  on verification_audit (created_at desc);

-- ===== schema-profile-collateral.sql =====
-- Divini Procure - PROFILE COLLATERAL: pitch decks / marketing collateral +
-- custom programs / offerings shown on a company profile.
-- =========================================================================
-- Additive layer that lets ANY company (a real-estate developer / buyer OR a
-- vendor) attach uploaded pitch decks / marketing collateral and publish custom
-- programs / offerings on its profile. This complements (does NOT duplicate) the
-- existing teasers-profiles layer:
--
--   * opportunity_teasers       -> investment-compliance-constrained teasers
--                                  (CTA limited to request access / info / intro).
--   * developer_public_profiles -> the developer's public bio / markets.
--   * THIS FILE                  -> general uploaded collateral + general custom
--                                  offerings with a free-form CTA, for buyers AND
--                                  vendors.
--
-- Decks REUSE the existing documents pipeline: a profile_decks row references a
-- documents.storage_path that was created by the standard POST /api/documents
-- multipart upload, and downloads use the same signed-url path. We do not invent
-- new storage here.
--
-- Idempotent: safe to re-run. Apply via psql:
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-profile-collateral.sql
-- Zero em dashes by convention.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. PROFILE DECKS
-- A pitch deck / marketing collateral file attached to a company profile. The
-- bytes live on disk under documents.storage_path (uploaded via the standard
-- documents pipeline); this row carries the public-facing title, visibility and
-- ordering. is_public controls whether it surfaces on the public profile.
-- ---------------------------------------------------------------------------
create table if not exists profile_decks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  document_id uuid references documents(id) on delete set null,
  storage_path text not null,
  title text,
  description text,
  file_name text,
  is_public boolean default true,
  sort int default 0,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- 2. PROFILE PROGRAMS / OFFERINGS
-- A custom program / offering a company publishes on its profile: a title, a
-- short summary, longer details, free-form price / terms text, and a call to
-- action. active controls public visibility; sort controls ordering. This is a
-- general marketing offering and is NOT investment-compliance-constrained the
-- way opportunity_teasers are.
-- ---------------------------------------------------------------------------
create table if not exists profile_programs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  title text,
  summary text,
  details text,
  price_terms text,
  cta_label text,
  cta_url text,
  active boolean default true,
  sort int default 0,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists idx_profile_decks_company_id on profile_decks (company_id);
create index if not exists idx_profile_programs_company_id on profile_programs (company_id);

-- ===== schema-teasers-profiles.sql =====
-- Divini Procure - OPPORTUNITY TEASERS + PUBLIC/PRIVATE DEVELOPER PROFILES +
-- EVENT-SPACE / VENUE BRIDGE PROFILES
-- =========================================================================
-- Additive layer on top of the existing model (companies, buildings=projects,
-- investment_programs, company_members). Three concerns:
--
--   1. opportunity_teasers: a PUBLIC-SAFE summary of an investment program a
--      developer wants to surface to the marketplace. Teasers must NEVER carry
--      "invest now" language; the call to action is a request for access /
--      information / introduction. Restricted program financials never live
--      here; only the deliberately public ranges the developer stores on the
--      teaser itself.
--
--   2. developer_public_profiles: the PUBLIC face of a developer company. The
--      private side (subscriptions, internal fees, deal pipeline, investor
--      financials) stays in its existing tables and is never exposed here.
--
--   3. event_space_profiles: a bridge profile letting a developer surface an
--      event space / venue tied to a project, linking out to Divini Partners
--      for venue and sponsorship workflows.
--
-- Money is not stored here; teasers carry human-readable RANGE strings only, so
-- no exact restricted figures leak. Idempotent: safe to re-run. Apply via psql:
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-teasers-profiles.sql
-- Zero em dashes by convention.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. OPPORTUNITY TEASERS
-- A public-safe teaser derived from an investment program. request_cta is the
-- only call to action and is constrained to non-solicitation language.
-- ---------------------------------------------------------------------------
create table if not exists opportunity_teasers (
  id uuid primary key default gen_random_uuid(),
  program_id uuid references investment_programs(id) on delete cascade,
  company_id uuid,
  headline text,
  asset_class text,
  market text,
  target_raise_range text,
  min_investment_range text,
  investor_type text,
  accredited_required boolean default true,
  nda_required boolean default false,
  public_highlights text[],
  request_cta text default 'Request introduction',
  is_public boolean default false,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- 2. DEVELOPER PUBLIC PROFILES
-- One PUBLIC profile per developer company. Private posture stays elsewhere.
-- ---------------------------------------------------------------------------
create table if not exists developer_public_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid unique references companies(id) on delete cascade,
  bio text,
  markets text[],
  asset_classes text[],
  completed_projects text,
  public_opportunities boolean default true,
  is_public boolean default true,
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- 3. EVENT-SPACE / VENUE BRIDGE PROFILES
-- A developer surfaces an event space / venue, optionally tied to a project.
-- venue_profile_link bridges out to Divini Partners.
-- ---------------------------------------------------------------------------
create table if not exists event_space_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  project_id uuid references buildings(id) on delete set null,
  name text,
  event_space_available boolean default true,
  capacity int,
  photos text[],
  venue_profile_link text,
  preferred_vendors text[],
  procurement_needs text,
  sponsorship_opportunities text,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists idx_opportunity_teasers_program_id
  on opportunity_teasers (program_id);
create index if not exists idx_developer_public_profiles_company_id
  on developer_public_profiles (company_id);
create index if not exists idx_event_space_profiles_company_id
  on event_space_profiles (company_id);

-- ===== schema-project-roles.sql =====
-- ============================================================================
-- Divini Procure - Project Roles: Designer + GC dashboards (idempotent add-on)
-- ----------------------------------------------------------------------------
-- Additive enhancement to the existing schema (db/schema.sql). Lets a developer
-- (the building's owning company) invite per-project stakeholders by role
-- (designer, gc, owner, asset_manager, procurement_manager, read_only) and gives
-- Designers and General Contractors their own project workspaces of items.
--
--   * project_stakeholders: who has access to a project, and in what role.
--   * designer_items:       design-side records (finish schedules, samples,
--                           substitutions, aesthetic approvals, FF&E comments).
--   * gc_items:             field/construction records (install requirements,
--                           logistics, dimensions, delivery coordination,
--                           licenses, insurance, field conflicts).
--
-- A developer owns a project when a member of the building's company_id. Access
-- to a project is also granted to anyone with a project_stakeholders row whose
-- email matches the project for that role.
--
-- APPLY (run once against the local Postgres at localhost:5433):
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-project-roles.sql
-- Re-runnable: every statement is guarded with IF NOT EXISTS. UUID keys via
-- gen_random_uuid(). Zero em dashes by convention.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- per-project stakeholders (who can see the project) ----------
create table if not exists project_stakeholders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references buildings(id) on delete cascade,
  company_id uuid,
  email text,
  role text
    check (role in ('designer','gc','owner','asset_manager','procurement_manager','read_only')),
  permissions jsonb,
  invited_by text,
  created_at timestamptz default now(),
  unique (project_id, email, role)
);

create index if not exists project_stakeholders_project_idx
  on project_stakeholders (project_id);

-- ---------- designer items (design-side records on a project) ----------
create table if not exists designer_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references buildings(id) on delete cascade,
  kind text
    check (kind in ('finish_schedule','sample','substitution','aesthetic_approval','ffe_comment')),
  title text,
  detail text,
  status text default 'open'
    check (status in ('open','in_review','approved','rejected','closed')),
  link text,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists designer_items_project_idx
  on designer_items (project_id);

-- ---------- gc items (field/construction records on a project) ----------
create table if not exists gc_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references buildings(id) on delete cascade,
  kind text
    check (kind in ('install_requirement','logistics','dimension','delivery_coordination','license','insurance','field_conflict')),
  title text,
  detail text,
  status text default 'open'
    check (status in ('open','in_progress','resolved','blocked','closed')),
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists gc_items_project_idx
  on gc_items (project_id);

-- ===== schema-project-templates.sql =====
-- ===========================================================================
-- Project Templates for Divini Procure
-- ---------------------------------------------------------------------------
-- A library of reusable, asset-type-specific procurement blueprints. Each
-- template suggests the bid packages (CSI-style categories), documents,
-- vendor categories, a phased timeline, common risk flags, and the sections an
-- investor report should carry. Developers browse templates and apply one to a
-- project (a `buildings` row), optionally materializing draft bid packages.
--
-- Idempotent: safe to re-run. UUID via gen_random_uuid(). Zero em dashes.
-- ===========================================================================

create table if not exists project_templates (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  name text not null,
  asset_type text,
  description text,
  suggested_bid_packages text[] default '{}',
  suggested_documents text[] default '{}',
  vendor_categories text[] default '{}',
  timeline jsonb default '[]'::jsonb,
  risk_flags text[] default '{}',
  investor_report_sections text[] default '{}',
  builtin boolean default true,
  created_by text,
  created_at timestamptz default now()
);

create index if not exists idx_project_templates_asset_type on project_templates (asset_type);

-- ---------------------------------------------------------------------------
-- Seed: 10 built-in templates. Each insert is guarded so re-runs are no-ops.
-- ---------------------------------------------------------------------------

insert into project_templates (key, name, asset_type, description, suggested_bid_packages, suggested_documents, vendor_categories, timeline, risk_flags, investor_report_sections, builtin)
select 'multifamily_ground_up', 'Multifamily Ground-Up', 'Residential',
  'Ground-up multifamily development. Whole-building FF&E, finishes, and unit fit-out procurement across repeated unit types.',
  array['Cabinetry','Millwork','Countertops & Stone','Flooring','Tile','Lighting','Plumbing Fixtures','Appliances','Electrical','Hardware','FF&E','Window Treatments'],
  array['Architectural Plans','Unit Finish Schedule','FF&E Schedule','Specifications','Project Budget','Unit Matrix'],
  array['Cabinet Manufacturer','Flooring Supplier','Lighting Supplier','Plumbing Supplier','Appliance Distributor','Stone Fabricator'],
  '[{"phase":"Design & Specification","weeks":8},{"phase":"Bid & Award","weeks":6},{"phase":"Procurement & Lead Time","weeks":16},{"phase":"Delivery & Install","weeks":12}]'::jsonb,
  array['Long appliance lead times','Unit-count quantity escalation','Tariff exposure on imported stone','Finish substitution drift across units'],
  array['Budget','Savings','Vendor Awards','Risk','Timeline'],
  true
where not exists (select 1 from project_templates where key='multifamily_ground_up');

insert into project_templates (key, name, asset_type, description, suggested_bid_packages, suggested_documents, vendor_categories, timeline, risk_flags, investor_report_sections, builtin)
select 'luxury_condo', 'Luxury Condo', 'Residential',
  'High-end condominium tower. Premium finishes, designer FF&E, and amenity-grade materials with elevated QA expectations.',
  array['Custom Cabinetry','Millwork','Natural Stone','Hardwood Flooring','Designer Tile','Decorative Lighting','Premium Plumbing Fixtures','Luxury Appliances','Smart Home / Electrical','Door Hardware','FF&E','Closet Systems'],
  array['Architectural Plans','Interior Design Package','Finish Schedule','FF&E Schedule','Material Specifications','Budget','Sample Approval Log'],
  array['Custom Cabinet Maker','Stone Fabricator','Luxury Appliance Dealer','Designer Lighting Supplier','Hardwood Supplier','Plumbing Showroom'],
  '[{"phase":"Design & Specification","weeks":12},{"phase":"Sample & Approval","weeks":6},{"phase":"Bid & Award","weeks":6},{"phase":"Procurement & Lead Time","weeks":20},{"phase":"Delivery & Install","weeks":14}]'::jsonb,
  array['Imported material lead times','Designer sample approval delays','Price volatility on natural stone','Single-source premium vendors'],
  array['Budget','Savings','Vendor Awards','Risk','Timeline'],
  true
where not exists (select 1 from project_templates where key='luxury_condo');

insert into project_templates (key, name, asset_type, description, suggested_bid_packages, suggested_documents, vendor_categories, timeline, risk_flags, investor_report_sections, builtin)
select 'hotel_renovation', 'Hotel Renovation', 'Hospitality',
  'Brand-standard hotel renovation (PIP). Guestroom and public-area FF&E and finishes coordinated to brand specifications and phased occupancy.',
  array['Casegoods','Seating & Upholstery','Carpet & Flooring','Lighting','Bathroom Fixtures','Window Treatments','Artwork & Accessories','Millwork','Appliances (Minibar/Coffee)','Electrical','FF&E','Signage'],
  array['PIP / Brand Standards','Renovation Plans','FF&E Schedule','Finish Schedule','Specifications','Budget','Phasing Plan'],
  array['Casegoods Manufacturer','Hospitality FF&E Supplier','Commercial Carpet Supplier','Lighting Supplier','Window Treatment Vendor','Artwork Vendor'],
  '[{"phase":"PIP & Design","weeks":8},{"phase":"Bid & Award","weeks":5},{"phase":"Procurement & Lead Time","weeks":18},{"phase":"Phased Install","weeks":16}]'::jsonb,
  array['Occupied-renovation phasing constraints','Brand-standard compliance','FF&E lead times vs reopening date','Freight and warehousing costs'],
  array['Budget','Savings','Vendor Awards','Risk','Timeline'],
  true
where not exists (select 1 from project_templates where key='hotel_renovation');

insert into project_templates (key, name, asset_type, description, suggested_bid_packages, suggested_documents, vendor_categories, timeline, risk_flags, investor_report_sections, builtin)
select 'restaurant_buildout', 'Restaurant Build-Out', 'Hospitality',
  'Full-service restaurant build-out. Commercial kitchen equipment, dining FF&E, bar, and finish procurement on an aggressive open-date schedule.',
  array['Commercial Kitchen Equipment','Refrigeration','Bar Equipment','Dining Furniture','Lighting','Flooring','Tile','Millwork','Plumbing Fixtures','Electrical','Smallwares & FF&E','Signage'],
  array['Floor Plans','Kitchen Equipment Schedule','FF&E Schedule','Finish Schedule','Specifications','Budget','Health Code Requirements'],
  array['Restaurant Equipment Dealer','Refrigeration Supplier','Furniture Supplier','Lighting Supplier','Bar Equipment Vendor','Smallwares Distributor'],
  '[{"phase":"Design & Equipment Spec","weeks":5},{"phase":"Bid & Award","weeks":4},{"phase":"Procurement & Lead Time","weeks":10},{"phase":"Install & Open","weeks":8}]'::jsonb,
  array['Equipment lead times vs open date','Health-code and permit dependencies','Single-vendor kitchen package risk','Utility coordination'],
  array['Budget','Savings','Vendor Awards','Risk','Timeline'],
  true
where not exists (select 1 from project_templates where key='restaurant_buildout');

insert into project_templates (key, name, asset_type, description, suggested_bid_packages, suggested_documents, vendor_categories, timeline, risk_flags, investor_report_sections, builtin)
select 'mixed_use', 'Mixed-Use Development', 'Mixed-Use',
  'Multi-component development combining residential, retail, and amenity spaces. Procurement coordinated across distinct use programs and tenant fit-outs.',
  array['Cabinetry','Millwork','Stone & Countertops','Flooring','Tile','Lighting','Plumbing Fixtures','Appliances','Electrical','Hardware','FF&E','Storefront & Glazing'],
  array['Architectural Plans','Unit & Tenant Matrix','Finish Schedule','FF&E Schedule','Specifications','Budget','Phasing Plan'],
  array['Cabinet Manufacturer','Flooring Supplier','Lighting Supplier','Plumbing Supplier','Appliance Distributor','Storefront Vendor'],
  '[{"phase":"Design & Specification","weeks":10},{"phase":"Bid & Award","weeks":6},{"phase":"Procurement & Lead Time","weeks":18},{"phase":"Phased Delivery & Install","weeks":16}]'::jsonb,
  array['Cross-program coordination complexity','Tenant fit-out timing variance','Quantity escalation across components','Long-lead glazing and storefront'],
  array['Budget','Savings','Vendor Awards','Risk','Timeline'],
  true
where not exists (select 1 from project_templates where key='mixed_use');

insert into project_templates (key, name, asset_type, description, suggested_bid_packages, suggested_documents, vendor_categories, timeline, risk_flags, investor_report_sections, builtin)
select 'amenity_space', 'Amenity Space', 'Amenity',
  'Shared amenity package (lobby, lounge, fitness, pool deck, co-working). Statement finishes and FF&E with high design sensitivity and lower quantity.',
  array['Millwork','Lounge & Lobby Furniture','Fitness Equipment','Decorative Lighting','Stone & Tile','Flooring','Window Treatments','Artwork & Accessories','Plumbing Fixtures','FF&E','Outdoor / Pool Furniture'],
  array['Design Package','Finish Schedule','FF&E Schedule','Specifications','Budget','Sample Board'],
  array['Furniture Supplier','Fitness Equipment Dealer','Lighting Supplier','Stone Fabricator','Outdoor Furniture Vendor','Artwork Vendor'],
  '[{"phase":"Design & Specification","weeks":8},{"phase":"Bid & Award","weeks":4},{"phase":"Procurement & Lead Time","weeks":14},{"phase":"Install & Style","weeks":6}]'::jsonb,
  array['Designer sample approval delays','Custom furniture lead times','Lower volume / fewer competitive bidders','Outdoor material weather exposure'],
  array['Budget','Savings','Vendor Awards','Risk','Timeline'],
  true
where not exists (select 1 from project_templates where key='amenity_space');

insert into project_templates (key, name, asset_type, description, suggested_bid_packages, suggested_documents, vendor_categories, timeline, risk_flags, investor_report_sections, builtin)
select 'model_unit', 'Model Unit', 'Residential',
  'Merchandised model / sales unit. Fast-track, designer-curated finishes and FF&E to support pre-leasing or pre-sales on a compressed schedule.',
  array['Cabinetry','Countertops','Flooring','Tile','Lighting','Plumbing Fixtures','Appliances','Window Treatments','Furniture','Accessories & Art','Closet Systems','FF&E'],
  array['Unit Plan','Merchandising Package','Finish Schedule','FF&E Schedule','Budget','Specifications'],
  array['Furniture Supplier','Cabinet Manufacturer','Lighting Supplier','Appliance Distributor','Window Treatment Vendor','Accessories Vendor'],
  '[{"phase":"Merchandising Design","weeks":4},{"phase":"Bid & Award","weeks":2},{"phase":"Procurement & Lead Time","weeks":8},{"phase":"Install & Stage","weeks":4}]'::jsonb,
  array['Compressed schedule vs lead times','In-stock vs custom tradeoffs','Single model drives high per-unit cost','Staging coordination'],
  array['Budget','Savings','Vendor Awards','Risk','Timeline'],
  true
where not exists (select 1 from project_templates where key='model_unit');

insert into project_templates (key, name, asset_type, description, suggested_bid_packages, suggested_documents, vendor_categories, timeline, risk_flags, investor_report_sections, builtin)
select 'office_ti', 'Office Tenant Improvement', 'Commercial',
  'Commercial office tenant improvement. Workstations, casegoods, finishes, and base-building coordination on a lease-driven schedule.',
  array['Systems Furniture / Workstations','Casegoods','Seating','Carpet & Flooring','Lighting','Ceiling & Acoustics','Millwork','Glass & Demountable Walls','Electrical / Data','Appliances (Pantry)','FF&E','Signage'],
  array['Space Plan','Furniture Schedule','Finish Schedule','Specifications','Budget','Base-Building Standards'],
  array['Office Furniture Dealer','Flooring Supplier','Lighting Supplier','Demountable Wall Vendor','Acoustics Supplier','Signage Vendor'],
  '[{"phase":"Space Plan & Spec","weeks":6},{"phase":"Bid & Award","weeks":4},{"phase":"Procurement & Lead Time","weeks":12},{"phase":"Install & Move-In","weeks":8}]'::jsonb,
  array['Furniture lead times vs lease commencement','Base-building standard compliance','Data/electrical coordination','Move-in date penalties'],
  array['Budget','Savings','Vendor Awards','Risk','Timeline'],
  true
where not exists (select 1 from project_templates where key='office_ti');

insert into project_templates (key, name, asset_type, description, suggested_bid_packages, suggested_documents, vendor_categories, timeline, risk_flags, investor_report_sections, builtin)
select 'retail_buildout', 'Retail Build-Out', 'Commercial',
  'Retail or showroom build-out. Fixtures, display systems, finishes, and brand-standard FF&E on a landlord and grand-opening schedule.',
  array['Store Fixtures & Displays','Millwork','Casework','Flooring','Tile','Lighting','Storefront & Glazing','Signage','Slatwall / Display Systems','Electrical','FF&E','Window Treatments'],
  array['Store Plan','Fixture Schedule','Finish Schedule','Brand Standards','Specifications','Budget'],
  array['Store Fixture Manufacturer','Millwork Vendor','Lighting Supplier','Signage Vendor','Flooring Supplier','Storefront Vendor'],
  '[{"phase":"Design & Brand Spec","weeks":5},{"phase":"Bid & Award","weeks":3},{"phase":"Procurement & Lead Time","weeks":10},{"phase":"Install & Open","weeks":6}]'::jsonb,
  array['Fixture lead times vs opening date','Brand-standard compliance','Landlord work-letter dependencies','Custom millwork shop capacity'],
  array['Budget','Savings','Vendor Awards','Risk','Timeline'],
  true
where not exists (select 1 from project_templates where key='retail_buildout');

insert into project_templates (key, name, asset_type, description, suggested_bid_packages, suggested_documents, vendor_categories, timeline, risk_flags, investor_report_sections, builtin)
select 'senior_living', 'Senior Living', 'Residential',
  'Senior living / assisted-living community. Durable, code-compliant FF&E and finishes balancing residential warmth with clinical and accessibility requirements.',
  array['Casegoods','Resident Seating & Upholstery','Common-Area Furniture','Flooring (Slip-Resistant)','Carpet','Lighting','Bathroom Fixtures (ADA)','Grab Bars & Safety Hardware','Millwork','Appliances','Window Treatments','FF&E'],
  array['Architectural Plans','FF&E Schedule','Finish Schedule','ADA / Accessibility Requirements','Specifications','Budget','Infection-Control Standards'],
  array['Healthcare FF&E Supplier','Commercial Flooring Supplier','Seating Manufacturer','Lighting Supplier','ADA Fixture Supplier','Window Treatment Vendor'],
  '[{"phase":"Design & Compliance Review","weeks":9},{"phase":"Bid & Award","weeks":5},{"phase":"Procurement & Lead Time","weeks":16},{"phase":"Delivery & Install","weeks":12}]'::jsonb,
  array['ADA and code compliance','Antimicrobial / infection-control material specs','Durability and warranty requirements','Resident-occupancy phasing'],
  array['Budget','Savings','Vendor Awards','Risk','Timeline'],
  true
where not exists (select 1 from project_templates where key='senior_living');

-- ===== schema-roles-onboarding.sql =====
-- ============================================================================
-- Divini Procure -- Roles onboarding enhancement (idempotent).
-- ----------------------------------------------------------------------------
-- Extends onboarding beyond developer/buyer to rich VENDOR and INVESTOR flows.
--   * Allows the new `investor` company kind (alongside buyer + vendor).
--   * Adds vendor/investor profile array fields to `companies`.
-- Reuses the website/description/state columns added by
-- schema-developer-onboarding.sql (apply that file first, or both, order-free).
--
-- Safe to re-run: every statement is guarded.
--
-- APPLY (manual, on the local Postgres at localhost:5433):
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-roles-onboarding.sql
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- companies.kind: allow investor ----------
alter table companies drop constraint if exists companies_kind_check;
alter table companies add constraint companies_kind_check
  check (kind in ('buyer','vendor','investor'));

-- ---------- companies: vendor + investor profile fields ----------
alter table companies add column if not exists coverage_areas text[] default '{}';     -- vendor service territories
alter table companies add column if not exists service_categories text[] default '{}'; -- vendor industry / service categories
alter table companies add column if not exists capabilities text[] default '{}';       -- vendor capabilities (Manufacturing/Distribution/...)
alter table companies add column if not exists focus_areas text[] default '{}';         -- investor focus / asset classes
alter table companies add column if not exists geographies text[] default '{}';         -- investor target geographies

-- ===== schema-developer-onboarding.sql =====
-- ============================================================================
-- Divini Procure -- Developer onboarding enhancement (idempotent).
-- ----------------------------------------------------------------------------
-- Adds the richer real-estate-DEVELOPER profile fields to `companies` and makes
-- the `documents` table able to attach brand media (logo/images/deck/brochure)
-- to a company via company_id + category.
--
-- Safe to re-run: every statement is guarded with "if not exists".
--
-- APPLY (manual, on the local Postgres at localhost:5433):
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-developer-onboarding.sql
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- companies: richer developer profile ----------
alter table companies add column if not exists website text;
alter table companies add column if not exists description text;
alter table companies add column if not exists state text;            -- distinct from existing region
alter table companies add column if not exists ownership_group text;
alter table companies add column if not exists development_team text;
alter table companies add column if not exists asset_types text[] default '{}';
alter table companies add column if not exists headquarters text;      -- optional, distinct from street

-- ---------- documents: allow company-level brand media + a category ----------
-- (documents already has company_id in the base schema, but keep this guarded so
--  this file is self-sufficient even against older databases.)
alter table documents add column if not exists company_id uuid references companies(id) on delete cascade;
alter table documents add column if not exists category text;          -- logo|image|deck|brochure|other

create index if not exists idx_documents_company on documents(company_id);
create index if not exists idx_documents_category on documents(category);

-- ===== schema-onboarding-samples.sql =====
-- ============================================================================
-- Divini Procure - Category Vendor-Onboarding Templates + Sample Request
-- workflow (idempotent add-on)
-- ----------------------------------------------------------------------------
-- Additive enhancement to the existing schema (db/schema.sql). Two concerns:
--
--   * vendor_onboarding_templates: a per-category checklist of the documents
--       and profile fields a vendor must supply to be onboarded for that
--       category (cabinetry, millwork, lighting, ...). Seeded with 14 default
--       categories; admins may upsert / extend a category's requirements.
--
--   * sample_requests: a developer (a member of the buyer company) requests a
--       physical material sample (tile, flooring, fabric, ...) from a vendor,
--       optionally tied to a project (buildings). The request moves through a
--       lifecycle the vendor and the developer each advance:
--           requested -> vendor_review -> shipped -> delivered
--                     -> approved | rejected
--       The vendor sets vendor_review / shipped (+ tracking + response); the
--       developer (or, on delivery, either side) records approved / rejected
--       (+ approval notes).
--
-- APPLY (run once against the local Postgres at localhost:5433):
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-onboarding-samples.sql
-- Re-runnable: every statement is guarded (IF NOT EXISTS / WHERE NOT EXISTS).
-- UUIDs via gen_random_uuid(). Zero em dashes by convention.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- per-category onboarding requirements ----------
create table if not exists vendor_onboarding_templates (
  id uuid primary key default gen_random_uuid(),
  category text unique,
  required_docs text[] default '{}',
  required_fields text[] default '{}',
  notes text,
  created_at timestamptz default now()
);

-- ---------- physical material sample requests ----------
create table if not exists sample_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references buildings(id) on delete set null,
  developer_company_id uuid references companies(id) on delete cascade,
  vendor_company_id uuid references companies(id) on delete set null,
  material_type text
    check (material_type in
      ('tile','flooring','fabric','drapery','stone','paint','hardware','finish','other')),
  product_label text,
  quantity int default 1,
  ship_to_address text,
  status text default 'requested'
    check (status in
      ('requested','vendor_review','shipped','delivered','approved','rejected')),
  tracking_number text,
  vendor_response text,
  approval_notes text,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_sample_requests_developer on sample_requests(developer_company_id);
create index if not exists idx_sample_requests_vendor on sample_requests(vendor_company_id);

-- ---------- seed 14 default category onboarding templates ----------
-- Each insert is guarded so re-running this file never duplicates a category.
insert into vendor_onboarding_templates (category, required_docs, required_fields, notes)
select 'cabinetry',
  array['Certificate of Insurance (COI)','W9','Product catalog','Spec sheets','CAD / shop drawings','Lead time sheet','Trade pricing sheet'],
  array['Categories served','Service area','Install capability','Order minimums','Standard lead times'],
  'Casework, cabinet boxes, and built-ins. CAD / shop drawings required for custom runs.'
where not exists (select 1 from vendor_onboarding_templates where category = 'cabinetry');

insert into vendor_onboarding_templates (category, required_docs, required_fields, notes)
select 'millwork',
  array['Certificate of Insurance (COI)','W9','Product catalog','Spec sheets','CAD / shop drawings','Lead time sheet','Trade pricing sheet'],
  array['Categories served','Service area','Install capability','Order minimums','Standard lead times'],
  'Custom architectural millwork and trim. Shop drawings required before fabrication.'
where not exists (select 1 from vendor_onboarding_templates where category = 'millwork');

insert into vendor_onboarding_templates (category, required_docs, required_fields, notes)
select 'lighting',
  array['Certificate of Insurance (COI)','W9','Product catalog','Spec sheets','Cut sheets','Lead time sheet','Trade pricing sheet'],
  array['Categories served','Service area','Install capability','Order minimums','Standard lead times'],
  'Decorative and architectural lighting. Cut sheets and photometric data where applicable.'
where not exists (select 1 from vendor_onboarding_templates where category = 'lighting');

insert into vendor_onboarding_templates (category, required_docs, required_fields, notes)
select 'flooring',
  array['Certificate of Insurance (COI)','W9','Product catalog','Spec sheets','Sample / swatch sheet','Lead time sheet','Trade pricing sheet'],
  array['Categories served','Service area','Install capability','Order minimums','Standard lead times'],
  'Hard and soft flooring. Provide wear ratings and a sample / swatch sheet.'
where not exists (select 1 from vendor_onboarding_templates where category = 'flooring');

insert into vendor_onboarding_templates (category, required_docs, required_fields, notes)
select 'tile',
  array['Certificate of Insurance (COI)','W9','Product catalog','Spec sheets','Sample / swatch sheet','Lead time sheet','Trade pricing sheet'],
  array['Categories served','Service area','Install capability','Order minimums','Standard lead times'],
  'Ceramic, porcelain, and mosaic tile. Note dye-lot handling and overage policy.'
where not exists (select 1 from vendor_onboarding_templates where category = 'tile');

insert into vendor_onboarding_templates (category, required_docs, required_fields, notes)
select 'drapery',
  array['Certificate of Insurance (COI)','W9','Product catalog','Fabric spec sheets','Sample / swatch sheet','Lead time sheet','Trade pricing sheet'],
  array['Categories served','Service area','Install capability','Order minimums','Standard lead times'],
  'Window treatments and soft goods. Fabric content, width, and fire rating required.'
where not exists (select 1 from vendor_onboarding_templates where category = 'drapery');

insert into vendor_onboarding_templates (category, required_docs, required_fields, notes)
select 'doors',
  array['Certificate of Insurance (COI)','W9','Product catalog','Spec sheets','CAD / shop drawings','Lead time sheet','Trade pricing sheet'],
  array['Categories served','Service area','Install capability','Order minimums','Standard lead times'],
  'Interior and entry doors. Include fire rating and hardware prep schedules.'
where not exists (select 1 from vendor_onboarding_templates where category = 'doors');

insert into vendor_onboarding_templates (category, required_docs, required_fields, notes)
select 'hardware',
  array['Certificate of Insurance (COI)','W9','Product catalog','Spec sheets','Finish sample card','Lead time sheet','Trade pricing sheet'],
  array['Categories served','Service area','Install capability','Order minimums','Standard lead times'],
  'Door and cabinet hardware. Provide a finish sample card and keying capability.'
where not exists (select 1 from vendor_onboarding_templates where category = 'hardware');

insert into vendor_onboarding_templates (category, required_docs, required_fields, notes)
select 'furniture',
  array['Certificate of Insurance (COI)','W9','Product catalog','Spec sheets','COM / COL spec sheet','Lead time sheet','Trade pricing sheet'],
  array['Categories served','Service area','Install capability','Order minimums','Standard lead times'],
  'Case goods, seating, and FF&E. Note COM / COL handling and white-glove delivery.'
where not exists (select 1 from vendor_onboarding_templates where category = 'furniture');

insert into vendor_onboarding_templates (category, required_docs, required_fields, notes)
select 'electrical',
  array['Certificate of Insurance (COI)','W9','License / certification','Product catalog','Spec sheets','Lead time sheet','Trade pricing sheet'],
  array['Categories served','Service area','Install capability','Order minimums','Standard lead times'],
  'Electrical fixtures and gear. State / local license and certifications required.'
where not exists (select 1 from vendor_onboarding_templates where category = 'electrical');

insert into vendor_onboarding_templates (category, required_docs, required_fields, notes)
select 'plumbing',
  array['Certificate of Insurance (COI)','W9','License / certification','Product catalog','Spec sheets','Lead time sheet','Trade pricing sheet'],
  array['Categories served','Service area','Install capability','Order minimums','Standard lead times'],
  'Plumbing fixtures and fittings. State / local license and certifications required.'
where not exists (select 1 from vendor_onboarding_templates where category = 'plumbing');

insert into vendor_onboarding_templates (category, required_docs, required_fields, notes)
select 'stone',
  array['Certificate of Insurance (COI)','W9','Product catalog','Spec sheets','Slab / sample sheet','CAD / shop drawings','Lead time sheet','Trade pricing sheet'],
  array['Categories served','Service area','Install capability','Order minimums','Standard lead times'],
  'Natural and engineered stone. Slab selection, seam plan, and shop drawings required.'
where not exists (select 1 from vendor_onboarding_templates where category = 'stone');

insert into vendor_onboarding_templates (category, required_docs, required_fields, notes)
select 'appliances',
  array['Certificate of Insurance (COI)','W9','Product catalog','Spec sheets','Cut sheets','Lead time sheet','Trade pricing sheet'],
  array['Categories served','Service area','Install capability','Order minimums','Standard lead times'],
  'Major and small appliances. Provide cut sheets, rough-in dimensions, and warranty terms.'
where not exists (select 1 from vendor_onboarding_templates where category = 'appliances');

insert into vendor_onboarding_templates (category, required_docs, required_fields, notes)
select 'specialty_fabrication',
  array['Certificate of Insurance (COI)','W9','Product catalog','Spec sheets','CAD / shop drawings','Sample / swatch sheet','Lead time sheet','Trade pricing sheet'],
  array['Categories served','Service area','Install capability','Order minimums','Standard lead times'],
  'Custom and specialty fabrication. Shop drawings and a sample required before production.'
where not exists (select 1 from vendor_onboarding_templates where category = 'specialty_fabrication');

-- ===== schema-invite-prefill.sql =====
-- ============================================================================
-- Divini Procure — INVITE PRE-FILL columns (idempotent add-on)
-- ----------------------------------------------------------------------------
-- Extends invite_codes so an admin can create a pre-filled CLAIM PROFILE for a
-- prospect company (e.g. a real-estate developer). The /join/:code page renders
-- the company's info as a public "claim page" that launches onboarding
-- pre-filled.
--
-- This file is ADDITIVE and IDEMPOTENT. Apply it the SAME WAY as
-- db/schema-superadmin.sql, AFTER that file has been applied:
--
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-invite-prefill.sql
--   (or:  psql -h localhost -p 5433 -U aibos -d divini_procure -f db/schema-invite-prefill.sql)
--
-- Re-running it is safe. One alter per statement by convention.
-- Zero em dashes below this line.
-- ============================================================================

alter table invite_codes add column if not exists company_name text;
alter table invite_codes add column if not exists company_website text;
alter table invite_codes add column if not exists prefill jsonb default '{}'::jsonb;

-- ===== schema-investment.sql =====
-- Divini Procure - DEVELOPER INVESTMENT + INVESTOR MATCHING
-- =========================================================
-- Additive layer that turns the existing developer organization (a company of
-- kind='buyer') into an entity that can ALSO raise capital, and adds an
-- investor identity (keyed by user, no investor company kind required) plus a
-- DETERMINISTIC matching pipeline between investment programs and investors.
--
-- Reuses the existing model: developers are companies(kind='buyer'), projects
-- are buildings(id), users are users(id), membership is company_members. ONE
-- subscription (subscription_entitlements) covers BOTH the procurement profile
-- and the investment profile for a company.
--
-- Compliance posture: AI/deterministic logic may SCORE and SURFACE matches, but
-- it may NOT verify accreditation, approve investors, or publish offerings. All
-- of those remain human/admin actions. Money is stored as integer cents.
--
-- Idempotent: safe to re-run. Apply standalone via psql, e.g.
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-investment.sql
--   (or:  psql -h localhost -p 5433 -U aibos -d divini_procure -f db/schema-investment.sql)
-- Zero em dashes by convention.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- ONE subscription covers BOTH the procurement profile AND the investment
-- profile for a company. Net-new; does not replace any existing billing.
-- ---------------------------------------------------------------------------
create table if not exists subscription_entitlements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid unique references companies(id) on delete cascade,
  plan text default 'standard',
  procurement_profile boolean default true,
  investment_profile boolean default true,
  seats int default 2,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Seats inside a developer organization. Distinguishes procurement vs
-- investment vs admin seats. Permissions is a free-form jsonb grant blob.
-- ---------------------------------------------------------------------------
create table if not exists developer_seats (
  id uuid primary key default gen_random_uuid(),
  organization_company_id uuid references companies(id) on delete cascade,
  user_id text,
  email text,
  seat_type text check (seat_type in (
    'developer_procurement_seat',
    'developer_investment_seat',
    'developer_admin_seat'
  )),
  permissions jsonb,
  status text default 'active',
  invited_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (organization_company_id, email, seat_type)
);

-- ---------------------------------------------------------------------------
-- A developer organization's investment profile (one per company). This is the
-- top-level capital-raising posture; individual deals live in
-- investment_programs.
-- ---------------------------------------------------------------------------
create table if not exists developer_investment_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid unique references companies(id) on delete cascade,
  investment_contact_name text,
  investment_contact_email text,
  investment_contact_phone text,
  capital_raising_status text,
  open_to_investors boolean,
  accredited_accepted boolean,
  non_accredited_accepted boolean,
  min_investment_cents bigint,
  max_investment_cents bigint,
  preferred_investor_type text,
  target_raise_cents bigint,
  capital_stack text,
  offering_type text,
  investment_structure text,
  target_returns text,
  hold_period text,
  distribution_schedule text,
  risk_level text,
  markets text[],
  asset_classes text[],
  track_record text,
  nda_required boolean,
  accreditation_required boolean,
  kyc_required boolean,
  qualification_requirements text,
  compliance_notes text,
  status text default 'draft' check (status in (
    'draft','submitted_for_review','needs_edits','approved','active','paused','closed','rejected'
  )),
  admin_review_status text default 'not_required',
  admin_notes text,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- An individual investment program / offering (a deal). Optionally tied to a
-- project (buildings.id). Visibility + status drive what investors can see.
-- ---------------------------------------------------------------------------
create table if not exists investment_programs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  project_id uuid references buildings(id) on delete set null,
  name text,
  program_type text,
  asset_class text,
  location text,
  project_stage text,
  target_raise_cents bigint,
  min_investment_cents bigint,
  max_investment_cents bigint,
  investor_type_accepted text,
  accredited_only boolean,
  non_accredited_accepted boolean,
  offering_type text,
  investment_vehicle text,
  projected_return text,
  preferred_return text,
  equity_multiple text,
  irr_target text,
  hold_period text,
  distribution_schedule text,
  use_of_funds text,
  capital_stack text,
  risk_level text,
  exit_strategy text,
  qualification_requirements text,
  nda_required boolean,
  kyc_required boolean,
  proof_of_funds_required boolean,
  visibility text default 'public_teaser' check (visibility in (
    'public_teaser','approved_investor_preview','nda_required','accredited_only',
    'non_accredited_program','family_office_only','admin_approved_only',
    'private_invite_only','closed'
  )),
  status text default 'draft' check (status in (
    'draft','submitted_for_review','needs_edits','approved','active','paused','closed','rejected'
  )),
  admin_review_status text default 'not_required',
  admin_notes text,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Offering documents attached to a program. May be NDA-gated or
-- accredited-only; the route layer enforces who can fetch them.
-- ---------------------------------------------------------------------------
create table if not exists offering_documents (
  id uuid primary key default gen_random_uuid(),
  program_id uuid references investment_programs(id) on delete cascade,
  company_id uuid,
  doc_type text check (doc_type in ('deck','offering_memo','track_record','other')),
  title text,
  url text,
  nda_gated boolean default false,
  accredited_only boolean default false,
  uploaded_by text,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Investor identity (keyed by user). access_level + status + admin_review
-- gate what an investor may see. PII is masked to developers until intro.
-- ---------------------------------------------------------------------------
create table if not exists investor_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id text unique,
  company_id uuid,
  full_name text,
  entity_name text,
  email text,
  phone text,
  location text,
  investor_type text,
  accreditation_status text,
  entity_type text,
  website text,
  preferred_contact text,
  status text default 'starter_profile',
  access_level text default 'public_teaser_only',
  admin_review_status text default 'pending_review',
  admin_notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Investor matching preferences (drives deterministic scoring).
-- ---------------------------------------------------------------------------
create table if not exists investor_preferences (
  id uuid primary key default gen_random_uuid(),
  investor_id uuid unique references investor_profiles(id) on delete cascade,
  asset_classes text[],
  markets text[],
  min_investment_cents bigint,
  max_investment_cents bigint,
  total_allocation_cents bigint,
  preferred_deal_size_cents bigint,
  preferred_hold_period text,
  target_return text,
  risk_tolerance text,
  income_vs_growth text,
  liquidity_preference text,
  preferred_structure text,
  deal_types text[],
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Investor self-reported qualification + admin verification status. AI must
-- never set the *_verification / kyc / aml status to anything verified.
-- ---------------------------------------------------------------------------
create table if not exists investor_qualification_records (
  id uuid primary key default gen_random_uuid(),
  investor_id uuid references investor_profiles(id) on delete cascade,
  accredited text,
  non_accredited boolean,
  qualified_purchaser text,
  family_office boolean,
  proof_of_funds boolean,
  kyc_completed boolean,
  nda_willing boolean,
  can_review_private boolean,
  education_interest boolean,
  investment_experience text,
  jurisdiction text,
  suitability_notes text,
  accreditation_verification_status text default 'not_verified',
  kyc_status text default 'not_started',
  aml_status text default 'not_started',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists investor_documents (
  id uuid primary key default gen_random_uuid(),
  investor_id uuid references investor_profiles(id) on delete cascade,
  doc_type text,
  url text,
  status text default 'uploaded',
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Introduction requests: an investor asks to be introduced to a program. The
-- developer (or admin) approves/declines. pipeline_status tracks the deal flow.
-- ---------------------------------------------------------------------------
create table if not exists investor_introduction_requests (
  id uuid primary key default gen_random_uuid(),
  program_id uuid references investment_programs(id) on delete cascade,
  investor_id uuid references investor_profiles(id) on delete cascade,
  status text default 'requested' check (status in (
    'requested','approved','declined','info_requested','nda_required','intro_made'
  )),
  pipeline_status text default 'matched',
  developer_notes text,
  admin_notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (program_id, investor_id)
);

create table if not exists nda_records (
  id uuid primary key default gen_random_uuid(),
  program_id uuid references investment_programs(id) on delete set null,
  investor_id uuid references investor_profiles(id) on delete cascade,
  signer_name text,
  signed_at timestamptz default now(),
  ip text,
  audit jsonb
);

create table if not exists compliance_flags (
  id uuid primary key default gen_random_uuid(),
  subject_type text,
  subject_id uuid,
  flag text,
  level text,
  notes text,
  created_by text,
  created_at timestamptz default now(),
  resolved boolean default false
);

create table if not exists investment_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id text,
  actor_email text,
  action text,
  subject_type text,
  subject_id uuid,
  detail jsonb,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Indexes on the obvious foreign keys + lookup columns.
-- ---------------------------------------------------------------------------
create index if not exists idx_dev_seats_org on developer_seats (organization_company_id);
create index if not exists idx_dev_seats_user on developer_seats (user_id);
create index if not exists idx_inv_profiles_company on developer_investment_profiles (company_id);
create index if not exists idx_inv_programs_company on investment_programs (company_id);
create index if not exists idx_inv_programs_project on investment_programs (project_id);
create index if not exists idx_inv_programs_status on investment_programs (status);
create index if not exists idx_inv_programs_visibility on investment_programs (visibility);
create index if not exists idx_offering_docs_program on offering_documents (program_id);
create index if not exists idx_investor_profiles_user on investor_profiles (user_id);
create index if not exists idx_investor_prefs_investor on investor_preferences (investor_id);
create index if not exists idx_investor_qual_investor on investor_qualification_records (investor_id);
create index if not exists idx_investor_docs_investor on investor_documents (investor_id);
create index if not exists idx_intro_requests_program on investor_introduction_requests (program_id);
create index if not exists idx_intro_requests_investor on investor_introduction_requests (investor_id);
create index if not exists idx_nda_records_program on nda_records (program_id);
create index if not exists idx_nda_records_investor on nda_records (investor_id);
create index if not exists idx_compliance_flags_subject on compliance_flags (subject_type, subject_id);
create index if not exists idx_inv_audit_subject on investment_audit_log (subject_type, subject_id);

-- ===== schema-investment-governance.sql =====
-- Divini Procure - INVESTMENT GOVERNANCE (broker / permissions / compliance)
-- =========================================================================
-- ADDITIVE governance layer that sits ALONGSIDE the existing investment system
-- (schema-investment.sql). It does NOT modify any existing table. It adds:
--
--   broker_profiles        a capital-introducer / broker / advisor identity,
--                          admin-reviewed before it is approved.
--   investor_permissions   explicit, admin-granted permission LEVELS that tie an
--                          existing investor_profiles row (optionally a specific
--                          investment_programs row) to a capability level.
--   program_compliance     per-program legal + compliance review state, sponsor
--                          disclosure, offering exemption, and a restricted
--                          materials flag. One row per program.
--   document_access_log    an append-only audit trail of who viewed which
--                          offering / governance document and when.
--
-- Compliance posture (mirrors the existing layer): AI / automation may NEVER
-- verify accreditation, approve investors / brokers, or publish offerings. Every
-- status here defaults to a pending / not-started state and only an admin/human
-- action advances it. No "invest now" semantics; access is "request access".
--
-- Foreign keys are intentionally LOOSE (no hard references to investor_profiles /
-- investment_programs) so this file is safe to apply independently and in any
-- order relative to schema-investment.sql. The route layer enforces linkage.
--
-- Idempotent: safe to re-run. Apply standalone via psql, e.g.
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-investment-governance.sql
-- Zero em dashes by convention.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- BROKER / CAPITAL INTRODUCER identity. Keyed by user (one profile per user).
-- License status is self-reported and admin-confirmed; AI never sets it to a
-- verified value. status starts at pending_review.
-- ---------------------------------------------------------------------------
create table if not exists broker_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id text unique,
  company_id uuid,
  broker_type text check (broker_type in (
    'capital_introducer','broker','advisor','referral_partner','family_office_rep'
  )),
  license_status text default 'not_provided',
  license_number text,
  investor_network_type text,
  compliance_notes text,
  rev_share_terms text,
  status text default 'pending_review' check (status in (
    'pending_review','approved','restricted','rejected'
  )),
  admin_notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- INVESTOR PERMISSION LEVELS. An admin grants an explicit capability level to
-- an investor, optionally scoped to a single program. Never auto-granted.
--   investor_basic    public teaser / educational only
--   investor_budget   may see budget / sizing detail
--   investor_approval may participate in approval / private review flows
--   owner_full        full owner-equivalent visibility
--   asset_manager     asset-manager visibility across a program
-- ---------------------------------------------------------------------------
create table if not exists investor_permissions (
  id uuid primary key default gen_random_uuid(),
  investor_id uuid,
  program_id uuid,
  level text check (level in (
    'investor_basic','investor_budget','investor_approval','owner_full','asset_manager'
  )),
  granted_by text,
  notes text,
  created_at timestamptz default now(),
  unique (investor_id, program_id, level)
);

-- ---------------------------------------------------------------------------
-- PER-PROGRAM COMPLIANCE. One row per program. Legal + compliance review states
-- start at not_started and only an admin advances them. restricted_materials
-- gates whether offering materials may be surfaced at all.
-- ---------------------------------------------------------------------------
create table if not exists program_compliance (
  id uuid primary key default gen_random_uuid(),
  program_id uuid unique,
  legal_review_status text default 'not_started' check (legal_review_status in (
    'not_started','in_review','cleared','flagged'
  )),
  compliance_review_status text default 'not_started' check (compliance_review_status in (
    'not_started','in_review','cleared','flagged'
  )),
  sponsor_disclosure text,
  offering_exemption_type text,
  restricted_materials boolean default false,
  reviewed_by text,
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- DOCUMENT ACCESS LOG. Append-only audit trail. Written whenever a viewer opens
-- an offering / governance document. Never updated or deleted by the app.
-- ---------------------------------------------------------------------------
create table if not exists document_access_log (
  id uuid primary key default gen_random_uuid(),
  doc_type text,
  doc_id uuid,
  program_id uuid,
  viewer_user_id text,
  viewer_email text,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Indexes on the obvious lookup columns.
-- ---------------------------------------------------------------------------
create index if not exists idx_broker_profiles_user on broker_profiles (user_id);
create index if not exists idx_investor_permissions_investor on investor_permissions (investor_id);
create index if not exists idx_program_compliance_program on program_compliance (program_id);
create index if not exists idx_document_access_log_program on document_access_log (program_id);

-- ===== schema-subscriptions.sql =====
-- ---------------------------------------------------------------------------
-- Subscription Tiers + Entitlements for Divini Procure.
--
-- Net-new + ADDITIVE. This file:
--   1. Creates `subscription_tiers`: the catalogue of plans (developer / vendor
--      / investor audiences) with per-tier feature flags + usage limits. A NULL
--      limit means UNLIMITED.
--   2. Seeds a sensible default set of tiers (idempotent on the `key`).
--   3. EXTENDS the pre-existing `subscription_entitlements` table (created by
--      db/schema-investment.sql) with the columns that record a company's
--      assigned tier and its EFFECTIVE limits. It NEVER recreates or redefines
--      that table; only `alter table ... add column if not exists`.
--
-- Money is stored as integer cents. UUIDs via gen_random_uuid().
--
-- Idempotent: safe to re-run. Apply standalone via psql, e.g.
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-subscriptions.sql
--   (or:  psql -h localhost -p 5433 -U aibos -d divini_procure -f db/schema-subscriptions.sql)
-- Zero em dashes by convention.
-- ---------------------------------------------------------------------------

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- The plan catalogue. One row per purchasable tier. A NULL *_limit column means
-- UNLIMITED for that resource. price_cents is the recurring price in cents.
-- ---------------------------------------------------------------------------
create table if not exists subscription_tiers (
  id uuid primary key default gen_random_uuid(),
  key text unique,
  name text,
  audience text check (audience in ('developer', 'vendor', 'investor')),
  price_cents bigint default 0,
  active_project_limit int,
  bid_package_limit int,
  vendor_invite_limit int,
  investment_program_limit int,
  investor_match_limit int,
  seat_limit int default 2,
  ai_features boolean default false,
  reporting_access boolean default false,
  white_glove boolean default false,
  sort int default 0,
  created_at timestamptz default now()
);

create index if not exists subscription_tiers_audience_idx on subscription_tiers (audience);

-- ---------------------------------------------------------------------------
-- Default tier seeds. Free tiers are small; pro tiers generous; enterprise /
-- qualified tiers unlimited (NULL limit). Re-runnable: on conflict do nothing.
-- ---------------------------------------------------------------------------
insert into subscription_tiers
  (key, name, audience, price_cents,
   active_project_limit, bid_package_limit, vendor_invite_limit,
   investment_program_limit, investor_match_limit, seat_limit,
   ai_features, reporting_access, white_glove, sort)
values
  -- Developer (buyer) tiers
  ('developer_free',       'Developer Free',       'developer',       0,
     1,    3,    5,    0,    0,    2,   false, false, false, 10),
  ('developer_pro',        'Developer Pro',        'developer',   29900,
     10,   50,   50,   3,    25,   10,  true,  true,  false, 20),
  ('developer_enterprise', 'Developer Enterprise', 'developer',  149900,
     null, null, null, null, null, null, true, true,  true,  30),

  -- Vendor tiers
  ('vendor_free',          'Vendor Free',          'vendor',          0,
     null, null, 0,    0,    0,    2,   false, false, false, 40),
  ('vendor_pro',           'Vendor Pro',           'vendor',      14900,
     null, null, 25,   0,    0,    10,  true,  true,  false, 50),

  -- Investor tiers
  ('investor_basic',       'Investor Basic',       'investor',        0,
     0,    0,    0,    0,    10,   2,   false, false, false, 60),
  ('investor_qualified',   'Investor Qualified',   'investor',    49900,
     0,    0,    0,    0,    null, 5,   true,  true,  false, 70)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- EXTEND the pre-existing subscription_entitlements table (do NOT recreate).
-- These columns record the assigned tier_key plus the EFFECTIVE per-resource
-- limits + feature flags for the company. When an override column is NULL the
-- application falls back to the tier default. updated_at already exists on the
-- base table; the add-if-not-exists is harmless.
-- ---------------------------------------------------------------------------
alter table subscription_entitlements add column if not exists tier_key text;
alter table subscription_entitlements add column if not exists audience text;
alter table subscription_entitlements add column if not exists ai_features boolean default false;
alter table subscription_entitlements add column if not exists reporting_access boolean default false;
alter table subscription_entitlements add column if not exists white_glove boolean default false;
alter table subscription_entitlements add column if not exists active_project_limit int;
alter table subscription_entitlements add column if not exists bid_package_limit int;
alter table subscription_entitlements add column if not exists vendor_invite_limit int;
alter table subscription_entitlements add column if not exists investment_program_limit int;
alter table subscription_entitlements add column if not exists investor_match_limit int;
alter table subscription_entitlements add column if not exists seat_limit int;
alter table subscription_entitlements add column if not exists updated_at timestamptz default now();

create index if not exists subscription_entitlements_tier_idx on subscription_entitlements (tier_key);

-- ===== schema-admin-tasks.sql =====
-- Divini Procure - ADMIN TASK MANAGEMENT
-- ======================================
-- Lightweight admin-facing task tracker. Tasks can optionally point at any
-- platform entity (account, project, vendor, investor, document, claim, bid,
-- opportunity, program) via a soft (linked_type, linked_id) reference, with no
-- foreign key, so the tracker stays additive and never blocks deletes.
--
-- Admin-only surface. Idempotent: safe to re-run. Apply standalone via psql:
--   docker exec -i aibos_postgres psql -U aibos -d divini_procure < db/schema-admin-tasks.sql
-- Zero em dashes by convention.

create table if not exists admin_tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  detail      text,
  linked_type text check (linked_type in (
                'account', 'project', 'vendor', 'investor', 'document',
                'claim', 'bid', 'opportunity', 'program', 'other')),
  linked_id   uuid,
  assigned_to text,
  priority    text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status      text not null default 'open'   check (status in ('open', 'in_progress', 'done', 'dismissed')),
  due_date    date,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists admin_tasks_status_idx      on admin_tasks (status);
create index if not exists admin_tasks_assigned_to_idx on admin_tasks (assigned_to);

-- ===== schema-campaigns.sql =====
-- ============================================================================
-- Divini Procure - Email Campaigns schema (idempotent add-on)
-- ----------------------------------------------------------------------------
-- A campaign is a named, segment-scoped email (subject + html body) that an
-- admin drafts, sends a TEST of to themselves (or any address), and then
-- EXPLICITLY approves to broadcast to the resolved, deduped audience. The
-- approve-and-send step is the ONLY place mail goes out to the segment; nothing
-- here auto-sends, and a test send is required before approval.
--
-- Recipients are snapshotted per send into campaign_recipients, each row marked
-- sent or failed so the send result is auditable.
--
-- This file is ADDITIVE and IDEMPOTENT (create table if not exists ...). Apply
-- it the SAME WAY as db/schema.sql, once, against the local Postgres AFTER
-- db/schema.sql:
--
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-campaigns.sql
--   (or:  psql -h localhost -p 5433 -U aibos -d divini_procure -f db/schema-campaigns.sql)
--
-- Re-running it is safe. Zero em dashes by convention of the ported routers.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- email campaigns ----------
create table if not exists email_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text not null,
  body_html text not null default '',
  segment text not null default 'all_companies',
  status text not null default 'draft'
    check (status in ('draft', 'test_sent', 'approved', 'sending', 'sent', 'cancelled')),
  test_sent_to text,
  test_sent_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  recipient_count int not null default 0,
  sent_count int not null default 0,
  failed_count int not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- per-send recipient snapshot ----------
create table if not exists campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references email_campaigns(id) on delete cascade,
  email text not null,
  name text,
  company_id uuid,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed')),
  sent_at timestamptz,
  error text
);

create index if not exists idx_campaign_recipients_campaign on campaign_recipients (campaign_id);

-- ===== schema-coo.sql =====
-- ============================================================================
-- Divini Procure - AI COO + Business Health + Command Center (idempotent add-on)
-- ----------------------------------------------------------------------------
-- Deterministic executive-intelligence layer for Divini Procure, ported in
-- shape from Divini Partners (db/schema-coo-health.sql + schema-coo-tasks.sql)
-- and mapped to the PROCUREMENT domain. Two tables:
--
--   * business_health_scores: a 0-100 org (company) health score plus the
--     per-dimension breakdown (pipeline / conversion / revenue / delivery /
--     submittals / compliance / relationships) as jsonb. One row is written per
--     recompute so a company keeps a history; the latest row is the current.
--   * coo_tasks: a ranked executive task feed generated from real procurement
--     signals (overdue submittals, late deliveries, packages past deadline with
--     no award, pending grandfathered-relationship reviews, missing docs on
--     awarded bids). score = impact * urgency. Deduped by (company_id, title).
--
-- Everything is computed deterministically in server/src/lib/procure-coo.ts; no
-- external LLM is called. This file is ADDITIVE and IDEMPOTENT (create table if
-- not exists ...). Apply once, AFTER db/schema.sql:
--
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-coo.sql
--   (or:  psql -h localhost -p 5433 -U aibos -d divini_procure -f db/schema-coo.sql)
--
-- Re-running it is safe. Zero em dashes below this line by convention.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- business health scores (org-level, with history) ----------
create table if not exists business_health_scores (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  score int,
  dimensions jsonb,
  computed_at timestamptz default now()
);

create index if not exists idx_business_health_company on business_health_scores(company_id);

-- ---------- COO task feed (ranked, deduped per company by title) ----------
-- status: open | in_progress | done | dismissed
-- impact / urgency are 1..5 each; score is impact * urgency (1..25).
create table if not exists coo_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete set null,
  title text,
  detail text,
  category text,
  impact int default 0,
  urgency int default 0,
  score int default 0,
  status text default 'open' check (status in ('open','in_progress','done','dismissed')),
  link text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_coo_tasks_company on coo_tasks(company_id);

-- A company has at most one row per generated task title, so regeneration is an
-- upsert rather than an append (keeps the feed from duplicating on every load).
create unique index if not exists uq_coo_tasks_company_title on coo_tasks(company_id, title);

-- ===== schema-moat.sql =====
-- ============================================================================
-- Divini Procure - INTELLIGENCE MOAT (Divini Scores + Relationship Graph)
-- ----------------------------------------------------------------------------
-- The compounding-intelligence layer for the procurement domain. Two persisted
-- artifacts back the moat features:
--
--   divini_scores       a per-company 0..100 reputation/health score with the
--                       deterministic factor breakdown that produced it. One
--                       latest row per company (recomputed on demand) plus the
--                       prior rows kept as history (computed_at ordered).
--
--   relationship_edges  a materialized company-to-company graph derived from
--                       real procurement signals (bids, awards, grandfathered
--                       relationships, current engagements). The graph powers
--                       the Relationship Graph view and relationship-breadth
--                       scoring. Upserted by buildRelationshipEdges().
--
-- The War Room is computed live (no table) from the existing schema.
--
-- ADDITIVE and IDEMPOTENT (create table if not exists ...). Apply once on the
-- local Postgres at localhost:5433, AFTER db/schema.sql and the other add-ons:
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-moat.sql
-- Zero em dashes by convention.
-- ============================================================================

create extension if not exists "pgcrypto";

-- Persisted Divini Score per company. entity_kind mirrors companies.kind
-- ('buyer' = developer, 'vendor'). factors holds the deterministic component
-- breakdown that produced the score, so the UI can render the bars without
-- recomputing. New rows are appended on each recompute; the latest (max
-- computed_at) is the current score.
create table if not exists divini_scores (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  entity_kind text,
  score int,
  factors jsonb,
  computed_at timestamptz default now()
);

create index if not exists idx_divini_scores_company on divini_scores(company_id);
create index if not exists idx_divini_scores_computed on divini_scores(computed_at);

-- Company-to-company relationship edges. One canonical row per
-- (from, to, edge_type) triple, upserted on rebuild. weight accumulates signal
-- strength (e.g. number of bids / awards), detail carries the contextual payload.
create table if not exists relationship_edges (
  id uuid primary key default gen_random_uuid(),
  from_company_id uuid references companies(id) on delete cascade,
  to_company_id uuid references companies(id) on delete cascade,
  edge_type text,
  weight numeric default 1,
  detail jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (from_company_id, to_company_id, edge_type)
);

create index if not exists idx_relationship_edges_from on relationship_edges(from_company_id);
create index if not exists idx_relationship_edges_to on relationship_edges(to_company_id);

-- ===== schema-superadmin.sql =====
-- ============================================================================
-- Divini Procure — SUPER-ADMIN ESSENTIALS schema (idempotent add-on)
-- ----------------------------------------------------------------------------
-- Ported from Divini Partners' admin/referral engine, mapped to Procure's
-- `companies` (not `organizations`) and `users` (OIDC sub text id) model.
--
-- This file is ADDITIVE and IDEMPOTENT (create table if not exists ...). It is
-- applied the SAME WAY as db/schema.sql — run once against the local Postgres
-- AFTER db/schema.sql:
--
--   psql "postgres://aibos:<pw>@localhost:5433/divini_procure" -f db/schema-superadmin.sql
--   (or:  psql -h localhost -p 5433 -U aibos -d divini_procure -f db/schema-superadmin.sql)
--
-- Re-running it is safe. See CHANGES.md / DEPLOY.md.
-- Zero em dashes below this line by convention of the ported routers.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- invite codes ----------
-- Admin-generated invitations to onboard a buyer/vendor company. The `code`
-- powers a public claim link (PUBLIC_APP_URL + /join/:code).
create table if not exists invite_codes (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  email text,
  company_kind text,                 -- 'buyer' | 'vendor' (advisory; not enforced)
  status text default 'pending',     -- pending | claimed | revoked
  created_by text,                   -- admin email
  claimed_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists invite_codes_status_idx on invite_codes (status);

-- ---------- discount codes ----------
create table if not exists discount_codes (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  kind text default 'percent',       -- percent | flat
  value numeric default 0,
  max_uses int,                      -- null = unlimited
  uses int default 0,
  status text default 'active',      -- active | disabled
  applies_to text,                   -- e.g. 'subscription' | 'all'
  expires_at timestamptz,
  created_by text,
  created_at timestamptz default now()
);
create index if not exists discount_codes_status_idx on discount_codes (status);

-- ---------- referral partners ----------
-- A business partner who refers customers in exchange for a revenue share or a
-- flat fee. `company_id` is nullable so a partner need not be a registered
-- company. revenue_share_pct is fully editable post-create (PATCH).
create table if not exists referral_partners (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete set null,
  name text not null,
  partner_email text,
  referral_code text unique not null,
  referral_link text,
  commission_type text default 'percent',  -- percent | flat
  revenue_share_pct numeric,                -- when commission_type = percent
  flat_fee_cents bigint,                    -- when commission_type = flat
  applies_to text,
  status text default 'active',             -- active | disabled
  terms text,
  created_by text,
  created_at timestamptz default now()
);
create index if not exists referral_partners_status_idx on referral_partners (status);

-- ---------- per-user referral codes + referrals + credits ----------
create table if not exists referral_codes (
  id uuid primary key default gen_random_uuid(),
  user_id text unique references users(id) on delete cascade,
  code text unique not null,
  created_at timestamptz default now()
);

create table if not exists user_referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id text references users(id) on delete cascade,
  referred_email text,
  code text,
  status text default 'pending',     -- pending | converted
  created_at timestamptz default now(),
  converted_at timestamptz
);
create index if not exists user_referrals_referrer_idx on user_referrals (referrer_user_id);

create table if not exists platform_credits (
  id uuid primary key default gen_random_uuid(),
  user_id text references users(id) on delete cascade,
  amount_cents bigint not null default 0,
  kind text default 'earned',        -- earned | redeemed | expired | pending
  reason text,
  created_at timestamptz default now()
);
create index if not exists platform_credits_user_idx on platform_credits (user_id);

-- ===== Monetization V2 (success fee + bid credits + verification gate + tiers) =====
-- =====================================================================
-- Divini Procure - Monetization V2 (transaction-marketplace model)
-- ---------------------------------------------------------------------
-- Net-new + additive + idempotent. Backs:
--   * Free vendors get 5 bids per quarter (no rollover; 20/year terminating
--     annually). Usage tracked in vendor_bid_credits; enforcement in
--     lib/bidCredits.ts. A win never consumes a credit; Pro = unlimited.
--   * SUCCESS FEE on platform-sourced awards billed to the winning vendor:
--     2% capped $2,500 standard, 1% capped $1,000 grandfathered. Recorded on
--     payment_authorizations.
--   * Verification GATE: a vendor cannot bid / match / message / be recommended
--     until verify_status = 'verified'. Credential expiry tracked + auto-revoke.
--   * Vendor Pro $149/mo, Verified+ and Featured upsells (subscription_tiers +
--     vendor_featured).
-- Everything is gated by the PROCURE_MONETIZATION_V2 flag at the app layer; the
-- schema is harmless additive structure.
-- Zero em dashes by convention.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------- Free-tier bid credits (per company per quarter) ----------
-- One row per company per period_key (e.g. '2026Q3'). No rollover: a new
-- quarter is a new row starting at 0. The app enforces the per-quarter limit
-- and the annual termination; this table just records usage for audit.
create table if not exists vendor_bid_credits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  period_key text not null,                 -- e.g. 2026Q3
  used int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (company_id, period_key)
);
create index if not exists idx_vendor_bid_credits_company on vendor_bid_credits(company_id);

-- ---------- Featured vendor placement (advertising upsell) ----------
create table if not exists vendor_featured (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  status text not null default 'active'
    check (status in ('active','cancelled','expired')),
  price_cents bigint not null default 9900,
  started_at timestamptz default now(),
  current_period_end timestamptz,
  processor_ref text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create unique index if not exists uq_vendor_featured_company_active
  on vendor_featured(company_id) where status = 'active';

-- ---------- Verification: credential expiry + gate ----------
-- vendor_credentials already exists (license/insurance/compliance docs). Add
-- expiry + a per-credential type + status so the gate can require current docs.
alter table if exists vendor_credentials add column if not exists credential_type text;   -- license|gl_insurance|workers_comp|trade_cert|w9|bond
alter table if exists vendor_credentials add column if not exists expires_at timestamptz;  -- coverage/license expiry
alter table if exists vendor_credentials add column if not exists doc_status text default 'pending'
  check (doc_status in ('pending','approved','rejected','expired'));

-- vendor_profiles.verify_status already exists; add quick-gate timestamps.
alter table if exists vendor_profiles add column if not exists verified_at timestamptz;
alter table if exists vendor_profiles add column if not exists verification_expires_at timestamptz; -- earliest credential expiry

-- ---------- Success fee on awards (payment_authorizations) ----------
alter table if exists payment_authorizations add column if not exists award_cents bigint;
alter table if exists payment_authorizations add column if not exists success_fee_pct numeric;
alter table if exists payment_authorizations add column if not exists success_fee_cap_cents bigint;
alter table if exists payment_authorizations add column if not exists success_fee_cents bigint;
alter table if exists payment_authorizations add column if not exists success_fee_grandfathered boolean default false;
alter table if exists payment_authorizations add column if not exists success_fee_status text default 'accrued'
  check (success_fee_status in ('accrued','invoiced','billed','paid','waived','void'));

-- ---------- Tier catalogue seeds (idempotent; never overwrite admin edits) ----------
-- subscription_tiers exists (key, name, audience, price_cents, *_limit, seat_limit, ai_features...).
-- A NULL limit means unlimited. Free-tier bid limit is enforced via bid credits,
-- not a tier column, since it is per-quarter.
insert into subscription_tiers (key, name, audience, price_cents, seat_limit, ai_features)
values
  ('developer_free', 'Developer', 'developer', 0, 5, true),
  ('vendor_free',    'Vendor Free', 'vendor', 0, 2, false),
  ('vendor_pro',     'Vendor Pro', 'vendor', 14900, 5, true),
  ('verified_plus',  'Divini Verified+', 'vendor', 4900, 2, false),
  ('vendor_featured','Featured Vendor', 'vendor', 9900, 2, false)
on conflict (key) do nothing;
