-- Quick-hit features schema additions

-- Investor watchlist: saved search criteria for deal alerts
CREATE TABLE IF NOT EXISTS investor_watchlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_class text,
  location text,
  min_target_return numeric,
  max_min_investment_cents bigint,
  investor_type text,
  notify_email boolean NOT NULL DEFAULT true,
  last_notified_at timestamptz,
  label text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_health_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  budget_score integer,
  schedule_score integer,
  vendor_score integer,
  documentation_score integer,
  score_details jsonb,
  computed_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_health_snapshots_building ON project_health_snapshots(building_id, computed_at DESC);

CREATE TABLE IF NOT EXISTS progress_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  uploaded_by_company_id uuid NOT NULL REFERENCES companies(id),
  uploaded_by_email text NOT NULL,
  storage_path text NOT NULL,
  caption text,
  phase text CHECK (phase IN ('pre_construction','foundation','framing','mep_rough','drywall','finishes','substantial_completion','final','other')),
  taken_at date,
  is_milestone boolean NOT NULL DEFAULT false,
  visible_to_investors boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_progress_photos_building ON progress_photos(building_id, taken_at DESC);
