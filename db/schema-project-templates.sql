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
