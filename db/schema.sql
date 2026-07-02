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
