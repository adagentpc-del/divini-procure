-- Certificate of Insurance tracking
CREATE TABLE IF NOT EXISTS coi_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  building_id uuid REFERENCES buildings(id) ON DELETE SET NULL,
  certificate_type text NOT NULL CHECK (certificate_type IN ('general_liability','workers_comp','umbrella','auto','professional','other')),
  carrier_name text,
  policy_number text,
  coverage_amount_cents bigint,
  aggregate_amount_cents bigint,
  effective_date date,
  expiry_date date NOT NULL,
  storage_path text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expiring_soon','expired','suspended')),
  verified_by text,
  verified_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS coi_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  certificate_type text NOT NULL CHECK (certificate_type IN ('general_liability','workers_comp','umbrella','auto','professional','other')),
  min_coverage_cents bigint,
  required boolean NOT NULL DEFAULT true,
  created_by text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coi_certificates_company ON coi_certificates(company_id);
CREATE INDEX IF NOT EXISTS idx_coi_certificates_expiry ON coi_certificates(expiry_date);
CREATE INDEX IF NOT EXISTS idx_coi_certificates_building ON coi_certificates(building_id);
