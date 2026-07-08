CREATE TABLE IF NOT EXISTS lender_project_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  developer_company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  lender_email text NOT NULL,
  lender_company_name text,
  lender_contact_name text,
  access_token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  granted_by text NOT NULL,
  granted_at timestamptz DEFAULT now(),
  revoked_at timestamptz,
  notes text
);

CREATE TABLE IF NOT EXISTS draw_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  developer_company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  draw_number integer NOT NULL,
  period_start date,
  period_end date,
  total_contract_value_cents bigint NOT NULL DEFAULT 0,
  previous_draws_cents bigint NOT NULL DEFAULT 0,
  this_draw_cents bigint NOT NULL DEFAULT 0,
  retainage_held_cents bigint NOT NULL DEFAULT 0,
  net_draw_cents bigint NOT NULL DEFAULT 0,
  percent_complete numeric(5,2),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','under_review','approved','rejected','funded')),
  submitted_at timestamptz,
  submitted_by text,
  lender_decision_at timestamptz,
  lender_decision_by text,
  lender_notes text,
  inspector_report_path text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(building_id, draw_number)
);

CREATE TABLE IF NOT EXISTS draw_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draw_request_id uuid NOT NULL REFERENCES draw_requests(id) ON DELETE CASCADE,
  package_id uuid REFERENCES packages(id) ON DELETE SET NULL,
  description text NOT NULL,
  scheduled_value_cents bigint NOT NULL DEFAULT 0,
  previous_billed_cents bigint NOT NULL DEFAULT 0,
  this_period_cents bigint NOT NULL DEFAULT 0,
  stored_materials_cents bigint NOT NULL DEFAULT 0,
  completed_pct numeric(5,2) DEFAULT 0,
  retainage_pct numeric(5,2) DEFAULT 10.00,
  retainage_cents bigint NOT NULL DEFAULT 0,
  sort_order integer DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_lender_access_building ON lender_project_access(building_id);
CREATE INDEX IF NOT EXISTS idx_lender_access_token ON lender_project_access(access_token);
CREATE INDEX IF NOT EXISTS idx_draw_requests_building ON draw_requests(building_id);
