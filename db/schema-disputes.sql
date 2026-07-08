CREATE TABLE IF NOT EXISTS disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid REFERENCES buildings(id) ON DELETE SET NULL,
  package_id uuid REFERENCES packages(id) ON DELETE SET NULL,
  filed_by_company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  against_company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  dispute_type text NOT NULL CHECK (dispute_type IN ('non_payment','scope_disagreement','defective_work','change_order','delay','insurance','lien','other')),
  title text NOT NULL,
  description text NOT NULL,
  amount_in_dispute_cents bigint DEFAULT 0,
  status text NOT NULL DEFAULT 'filed' CHECK (status IN ('filed','responded','mediation','escalated','resolved','closed_no_action')),
  resolution_type text CHECK (resolution_type IN ('mutual_agreement','platform_decision','arbitration','withdrawn','other')),
  resolution_notes text,
  resolved_at timestamptz,
  resolved_by text,
  platform_summary text,
  platform_suggestion text,
  mediator_name text,
  mediator_contact text,
  escalated_at timestamptz,
  response_due_at timestamptz,
  mediation_deadline_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dispute_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id uuid NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  author_company_id uuid NOT NULL REFERENCES companies(id),
  author_email text NOT NULL,
  message text NOT NULL,
  message_type text NOT NULL DEFAULT 'message' CHECK (message_type IN ('message','evidence','offer','counter_offer','admin_note','platform_decision')),
  amount_offered_cents bigint,
  storage_path text,
  is_visible_to_both boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_disputes_filed_by ON disputes(filed_by_company_id);
CREATE INDEX IF NOT EXISTS idx_disputes_against ON disputes(against_company_id);
CREATE INDEX IF NOT EXISTS idx_disputes_building ON disputes(building_id);
CREATE INDEX IF NOT EXISTS idx_dispute_messages_dispute ON dispute_messages(dispute_id);
