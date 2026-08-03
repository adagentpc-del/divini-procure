-- ============================================================================
-- Divini Procure - DIVINI SCOPE BUILDER (structured procurement requirements)
-- ----------------------------------------------------------------------------
-- Helps a developer define exactly what is being purchased/delivered/
-- installed for a bid package, as STRUCTURED data (typed fields per trade),
-- not a free-text blob. Reduces scope gaps, change orders, and disputes by
-- making the requirement set explicit and versioned before it goes out to
-- vendors.
--
--   scope_templates / scope_template_fields - reusable, trade-specific
--     requirement definitions. Global defaults (organization_id null) ship
--     seeded per common construction category; an organization may define
--     its own custom template.
--   scope_instances - one filled-out scope for a real package. Standard
--     narrative sections (site conditions, access, delivery/install,
--     exclusions, acceptance criteria, change-order rules) live directly on
--     this row since they apply to virtually every scope regardless of
--     trade; trade-specific structured answers live in scope_responses.
--   scope_responses - the typed answer to each template field.
--   scope_versions - an immutable snapshot taken every time a scope is
--     published or republished (preserve revision history).
--   scope_change_events - append-only log of what changed and when.
--
-- On publish, a scope_instance's structured content is synced into
-- packages.requirements (text[]) as readable lines - the first real writer
-- of that column, which server/src/routes/intel.ts already reads for
-- vendor-package matching.
--
-- Idempotent: safe to re-run. Apply standalone via psql, e.g.
--   docker exec -i aibos_postgres psql -U aibos -d divini_procure < db/schema-scope-builder.sql
-- Zero em dashes by convention.
-- ============================================================================

create extension if not exists "pgcrypto";

create table if not exists scope_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references companies(id) on delete cascade,  -- null = global default
  category text not null,
  name text not null,
  description text,
  active boolean not null default true,
  created_by text references users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_scope_templates_org_category on scope_templates (organization_id, category);

create table if not exists scope_template_fields (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references scope_templates(id) on delete cascade,
  field_key text not null,
  label text not null,
  field_type text not null check (field_type in ('text', 'number', 'quantity', 'date', 'boolean', 'select', 'multiselect')),
  unit text,               -- for quantity fields, e.g. "sq ft", "linear ft", "each"
  options jsonb,           -- for select/multiselect: array of option labels
  required boolean not null default false,
  section text,            -- groups fields into UI sections
  sort_order int not null default 0,
  help_text text,
  created_at timestamptz default now(),
  unique (template_id, field_key)
);
create index if not exists idx_scope_template_fields_template on scope_template_fields (template_id, sort_order);

create table if not exists scope_instances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references companies(id) on delete cascade,
  package_id uuid references packages(id) on delete cascade,
  template_id uuid references scope_templates(id) on delete set null,
  category text not null,
  title text not null,

  site_conditions text,
  access_restrictions text,
  delivery_requirements text,
  install_requirements text,
  exclusions text[] not null default '{}',
  acceptance_criteria text[] not null default '{}',
  change_order_rules text,

  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  current_version int not null default 0,

  created_by text references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_scope_instances_org on scope_instances (organization_id);
create index if not exists idx_scope_instances_package on scope_instances (package_id);

create table if not exists scope_responses (
  id uuid primary key default gen_random_uuid(),
  scope_instance_id uuid not null references scope_instances(id) on delete cascade,
  field_key text not null,
  value_text text,
  value_number numeric,
  value_bool boolean,
  value_date date,
  value_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scope_instance_id, field_key)
);
create index if not exists idx_scope_responses_instance on scope_responses (scope_instance_id);

-- Immutable. Never update or delete a row: this is the estimate-versus-actual
-- style audit trail for what the scope said at each publish point.
create table if not exists scope_versions (
  id uuid primary key default gen_random_uuid(),
  scope_instance_id uuid not null references scope_instances(id) on delete cascade,
  version_number int not null,
  snapshot_json jsonb not null,
  change_summary text,
  created_by text references users(id),
  created_at timestamptz not null default now(),
  unique (scope_instance_id, version_number)
);
create index if not exists idx_scope_versions_instance on scope_versions (scope_instance_id);

create table if not exists scope_change_events (
  id uuid primary key default gen_random_uuid(),
  scope_instance_id uuid not null references scope_instances(id) on delete cascade,
  event_type text not null check (event_type in ('created', 'field_updated', 'published', 'republished', 'archived')),
  field_key text,
  old_value jsonb,
  new_value jsonb,
  actor text references users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_scope_change_events_instance on scope_change_events (scope_instance_id, created_at);

-- ---------------------------------------------------------------------------
-- Seed a handful of global default templates for common construction trades.
-- Idempotent: only inserts when no global template of that category/field
-- exists yet. Organizations can add their own via POST /scope/templates.
-- ---------------------------------------------------------------------------
insert into scope_templates (organization_id, category, name, description, created_by)
select null, v.category, v.name, 'Divini default template.', null
from (values
  ('electrical',     'Electrical Rough-In & Trim'),
  ('plumbing',        'Plumbing Rough-In & Fixtures'),
  ('hvac',             'HVAC Install'),
  ('concrete',         'Concrete / Foundation'),
  ('general_labor',    'General Labor / Workforce')
) as v(category, name)
where not exists (
  select 1 from scope_templates t where t.organization_id is null and t.category = v.category
);

insert into scope_template_fields (template_id, field_key, label, field_type, unit, options, required, section, sort_order)
select st.id, v.field_key, v.label, v.field_type, v.unit, v.options::jsonb, v.required, v.section, v.sort_order
from (values
  ('electrical',     'square_footage',           'Square footage',                'quantity', 'sq ft',        null,                                              true,  'Scope',      10),
  ('electrical',     'panel_amperage',           'Service panel amperage',        'number',   'amps',         null,                                              false, 'Scope',      20),
  ('electrical',     'circuit_count',            'Circuit count',                 'number',   'circuits',     null,                                              false, 'Scope',      30),
  ('electrical',     'fixture_count',            'Light fixture count',           'number',   'fixtures',     null,                                              false, 'Scope',      40),
  ('electrical',     'permit_pulled_by',         'Permit pulled by',              'select',   null,           '["Developer","Vendor","Not required"]',          true,  'Compliance', 50),
  ('plumbing',       'fixture_count',            'Fixture count',                 'number',   'fixtures',     null,                                              true,  'Scope',      10),
  ('plumbing',       'pipe_material',            'Pipe material',                 'select',   null,           '["Copper","PEX","PVC","Cast iron"]',             true,  'Scope',      20),
  ('plumbing',       'water_heater_included',    'Water heater included',         'boolean',  null,           null,                                              false, 'Scope',      30),
  ('plumbing',       'permit_pulled_by',         'Permit pulled by',              'select',   null,           '["Developer","Vendor","Not required"]',          true,  'Compliance', 40),
  ('hvac',           'square_footage',           'Conditioned square footage',    'quantity', 'sq ft',        null,                                              true,  'Scope',      10),
  ('hvac',           'system_type',              'System type',                   'select',   null,           '["Split system","Package unit","Mini split","VRF"]', true, 'Scope',   20),
  ('hvac',           'zone_count',               'Zone count',                    'number',   'zones',        null,                                              false, 'Scope',      30),
  ('hvac',           'existing_ductwork',        'Existing ductwork reused',      'boolean',  null,           null,                                              false, 'Scope',      40),
  ('concrete',       'volume',                   'Volume',                        'quantity', 'cubic yards',  null,                                              true,  'Scope',      10),
  ('concrete',       'psi_rating',               'PSI rating',                    'number',   'psi',          null,                                              true,  'Scope',      20),
  ('concrete',       'rebar_included',           'Rebar / reinforcement included','boolean',  null,           null,                                              false, 'Scope',      30),
  ('concrete',       'finish_type',              'Finish type',                   'select',   null,           '["Broom","Smooth trowel","Stamped","Exposed aggregate"]', false, 'Scope', 40),
  ('general_labor',  'worker_count',             'Number of workers',             'number',   'workers',      null,                                              true,  'Scope',      10),
  ('general_labor',  'shift_length',             'Shift length',                  'number',   'hours',        null,                                              true,  'Scope',      20),
  ('general_labor',  'certifications_required',  'Certifications required',       'text',     null,           null,                                              false, 'Compliance', 30),
  ('general_labor',  'supervisor_required',      'Supervisor required on site',   'boolean',  null,           null,                                              false, 'Scope',      40)
) as v(category, field_key, label, field_type, unit, options, required, section, sort_order)
join scope_templates st on st.organization_id is null and st.category = v.category
where not exists (
  select 1 from scope_template_fields f where f.template_id = st.id and f.field_key = v.field_key
);
