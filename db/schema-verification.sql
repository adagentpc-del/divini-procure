-- ---------------------------------------------------------------------------
-- Divini Procure - ADMIN VERIFICATION WORKFLOWS schema. ADDITIVE.
--
-- Backs server/src/routes/verification.ts:
--   (A) admin review of vendor credentials (license / insurance / compliance
--       docs) -> recomputes vendor_profiles.verify_status.
--   (B) admin verification of investor accreditation / KYC on
--       investor_qualification_records -> may approve investor_profiles.
--
-- Idempotent. Apply with:
--   psql "$DATABASE_URL" -f db/schema-verification.sql
-- ---------------------------------------------------------------------------

-- Review trail columns on vendor_credentials (additive, idempotent).
alter table if exists vendor_credentials add column if not exists reviewed_by text;
alter table if exists vendor_credentials add column if not exists reviewed_at timestamptz;
alter table if exists vendor_credentials add column if not exists review_notes text;

-- Self-serve document upload columns (additive, idempotent). Backs
-- POST /api/me/verification/documents (section C below): a vendor attaches
-- an already-uploaded documents.storage_path (see the standard POST
-- /api/documents pipeline - no new storage invented here) as file_key, plus
-- the original file_name for display. Previously referenced by that route's
-- INSERT with no matching column ever added - a genuine bug that made the
-- vendor self-serve upload path 500 on every real call. Fixed as part of
-- competitive gap #4 (docs/competitive-analysis-2026-08.md): the "free,
-- mandatory" verification gate had no working self-serve way to satisfy it.
alter table if exists vendor_credentials add column if not exists file_key text;
alter table if exists vendor_credentials add column if not exists file_name text;

-- Append-only audit log for every admin verification action.
create table if not exists verification_audit (
  id uuid primary key default gen_random_uuid(),
  subject_type text,
  subject_id uuid,
  action text,
  actor_email text,
  detail jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_verification_audit_subject
  on verification_audit (subject_type, subject_id);
create index if not exists idx_verification_audit_created
  on verification_audit (created_at desc);
