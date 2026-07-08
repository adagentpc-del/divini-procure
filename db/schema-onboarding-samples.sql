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
