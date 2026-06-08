-- Feature flags + CAD/procurement tables (applied to project qrqydaaeswtihmsoztjx)
create table if not exists feature_flags (
  key text primary key, label text not null, description text,
  audience text not null default 'both' check (audience in ('buyer','vendor','both','admin')),
  enabled boolean not null default false, category text, sort int default 0
);
alter table feature_flags enable row level security;
create policy ff_read on feature_flags for select to authenticated using (true);
create policy ff_admin_write on feature_flags for all to authenticated
  using (auth.jwt()->>'email' = 'adagentpc@gmail.com')
  with check (auth.jwt()->>'email' = 'adagentpc@gmail.com');

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
  uploaded_by uuid references auth.users(id), created_at timestamptz default now()
);
alter table documents enable row level security;
create policy docs_read on documents for select to authenticated using (true);
create policy docs_write on documents for all to authenticated
  using (company_id in (select user_company_ids())) with check (company_id in (select user_company_ids()));

create table if not exists package_line_items (
  id uuid primary key default gen_random_uuid(),
  package_id uuid references packages(id) on delete cascade,
  item_no text, description text not null, qty numeric default 1, unit text,
  cost_code text, notes text, sort int default 0, created_at timestamptz default now()
);
alter table package_line_items enable row level security;
create policy pli_read on package_line_items for select to authenticated using (true);
create policy pli_write on package_line_items for all to authenticated using (
  package_id in (select id from packages where building_id in (select id from buildings where company_id in (select user_company_ids())))
) with check (
  package_id in (select id from packages where building_id in (select id from buildings where company_id in (select user_company_ids())))
);

create table if not exists bid_items (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid references bids(id) on delete cascade,
  line_item_id uuid references package_line_items(id) on delete cascade,
  unit_price numeric, qty numeric, amount numeric, note text
);
alter table bid_items enable row level security;
create policy bi_rw on bid_items for all to authenticated using (
  bid_id in (select id from bids where vendor_company_id in (select user_company_ids())
    or package_id in (select p.id from packages p join buildings b on b.id=p.building_id where b.company_id in (select user_company_ids())))
) with check (
  bid_id in (select id from bids where vendor_company_id in (select user_company_ids()))
);

create table if not exists rfq_questions (
  id uuid primary key default gen_random_uuid(),
  package_id uuid references packages(id) on delete cascade,
  vendor_company_id uuid references companies(id) on delete set null,
  question text not null, answer text, answered_at timestamptz, created_at timestamptz default now()
);
alter table rfq_questions enable row level security;
create policy rfq_read on rfq_questions for select to authenticated using (true);
create policy rfq_insert on rfq_questions for insert to authenticated with check (vendor_company_id in (select user_company_ids()));
create policy rfq_answer on rfq_questions for update to authenticated using (
  package_id in (select id from packages where building_id in (select id from buildings where company_id in (select user_company_ids())))
) with check (true);
