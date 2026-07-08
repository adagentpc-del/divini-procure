CREATE TABLE IF NOT EXISTS retainage_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  package_id uuid REFERENCES packages(id) ON DELETE SET NULL,
  vendor_company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  developer_company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contract_amount_cents bigint NOT NULL DEFAULT 0,
  retainage_pct numeric(5,2) NOT NULL DEFAULT 10.00,
  retainage_held_cents bigint NOT NULL DEFAULT 0,
  retainage_released_cents bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'holding' CHECK (status IN ('holding','partial_release','fully_released','disputed')),
  release_trigger text,
  milestone_required text,
  release_requested_at timestamptz,
  release_approved_at timestamptz,
  release_approved_by text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lien_waivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retainage_id uuid REFERENCES retainage_records(id) ON DELETE SET NULL,
  building_id uuid NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  vendor_company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  developer_company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  waiver_type text NOT NULL CHECK (waiver_type IN ('conditional_progress','unconditional_progress','conditional_final','unconditional_final')),
  through_date date,
  payment_amount_cents bigint,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','submitted','accepted','rejected')),
  storage_path text,
  requested_by text,
  submitted_by text,
  accepted_by text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_retainage_vendor ON retainage_records(vendor_company_id);
CREATE INDEX IF NOT EXISTS idx_retainage_developer ON retainage_records(developer_company_id);
CREATE INDEX IF NOT EXISTS idx_retainage_building ON retainage_records(building_id);
CREATE INDEX IF NOT EXISTS idx_lien_waivers_building ON lien_waivers(building_id);
CREATE INDEX IF NOT EXISTS idx_lien_waivers_vendor ON lien_waivers(vendor_company_id);
