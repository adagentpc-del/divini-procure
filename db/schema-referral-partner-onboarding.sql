-- Migration: referral partner onboarding -- agreement e-sign + banking info
-- Apply:  psql "$DATABASE_URL" -f db/schema-referral-partner-onboarding.sql

BEGIN;

-- Tracks the signed referral partner agreement (inline e-sign, not DocuSign)
CREATE TABLE IF NOT EXISTS referral_partner_agreements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id      uuid NOT NULL REFERENCES referral_partners(id) ON DELETE CASCADE,
  user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- snapshot of the agreement body at signing time
  agreement_body  text NOT NULL,
  -- e-sign: full legal name typed by the partner
  signed_name     text NOT NULL,
  -- ISO timestamp of acceptance (set server-side)
  signed_at       timestamptz NOT NULL DEFAULT now(),
  -- IP and user-agent stored for audit trail
  signed_ip       text,
  signed_ua       text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rpa_partner ON referral_partner_agreements(partner_id);
CREATE INDEX IF NOT EXISTS idx_rpa_user    ON referral_partner_agreements(user_id);

-- Banking / wire info supplied by referral partners for payout
CREATE TABLE IF NOT EXISTS referral_partner_banking (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id       uuid NOT NULL REFERENCES referral_partners(id) ON DELETE CASCADE,
  user_id          text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- payout method preference
  payout_method    text NOT NULL CHECK (payout_method IN ('wire','ach','check','zelle','paypal')) DEFAULT 'wire',
  -- shared fields
  beneficiary_name text NOT NULL,
  -- wire / ACH
  bank_name        text,
  account_number   text,  -- stored as-is; encrypt at rest via STORAGE_ENCRYPTION_KEY if desired
  routing_number   text,
  account_type     text CHECK (account_type IN ('checking','savings') OR account_type IS NULL),
  -- wire-specific
  swift_code       text,
  iban             text,
  bank_address     text,
  -- alternative methods
  zelle_email      text,
  paypal_email     text,
  check_payable_to text,
  check_address    text,
  -- admin notes
  notes            text,
  verified         boolean NOT NULL DEFAULT false,
  verified_by      text,
  verified_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rpb_partner ON referral_partner_banking(partner_id);
CREATE INDEX IF NOT EXISTS idx_rpb_user ON referral_partner_banking(user_id);

-- Add onboarding status column to referral_partners if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'referral_partners' AND column_name = 'onboarding_status'
  ) THEN
    ALTER TABLE referral_partners
      ADD COLUMN onboarding_status text NOT NULL DEFAULT 'pending'
        CHECK (onboarding_status IN ('pending','agreement_sent','agreement_signed','banking_submitted','complete'));
  END IF;
END
$$;

COMMIT;
