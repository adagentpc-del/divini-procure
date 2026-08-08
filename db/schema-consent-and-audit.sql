-- Florida E-SIGN Act: capture terms agreement at registration.
-- These columns record when, which version, and from which IP a user agreed.
alter table users
  add column if not exists terms_agreed_at  timestamptz,
  add column if not exists terms_version    text,
  add column if not exists consent_ip       text;

-- Index for audit queries by consent date.
create index if not exists idx_users_terms_agreed_at
  on users (terms_agreed_at)
  where terms_agreed_at is not null;

-- Audit log: ownership transfer entries.
-- Captures who transferred, to which company, and the new owner.
create table if not exists ownership_transfer_audit (
  id             bigserial    primary key,
  company_id     text         not null,
  acting_user_id text         not null,
  new_owner_email text        not null,
  transferred_at timestamptz  not null default now(),
  ip_address     text
);
create index if not exists idx_ownership_transfer_company
  on ownership_transfer_audit (company_id);

-- Audit log: campaign blast entries (CAN-SPAM / independent audit trail).
create table if not exists campaign_blast_audit (
  id             bigserial    primary key,
  campaign_id    text         not null,
  company_id     text         not null,
  sent_by_user_id text        not null,
  recipient_count int         not null default 0,
  sent_at        timestamptz  not null default now()
);
create index if not exists idx_campaign_blast_campaign
  on campaign_blast_audit (campaign_id);

-- Append-only legal-document acceptance log. The users.terms_agreed_at /
-- terms_version / consent_ip columns above capture only the MOST RECENT
-- acceptance (an UPDATE overwrites the prior value), so there is no way to
-- prove what a user agreed to at an earlier point in time if terms_version
-- changes more than once. This table is the durable history: one row per
-- acceptance event, never updated or deleted. Written alongside (not instead
-- of) the existing users columns, so no existing caller of those columns
-- needs to change.
create table if not exists user_legal_acceptances (
  id           bigserial    primary key,
  user_id      text         not null references users(id) on delete cascade,
  document_type text        not null,   -- 'terms' | 'privacy' | 'payment_policy' | 'vendor_agreement' | 'referral_partner_agreement' | ...
  version      text         not null,   -- matches the hardcoded version string used at the acceptance site
  accepted_at  timestamptz  not null default now(),
  source       text,                    -- e.g. 'register', 'onboarding_vendor_agreement'
  ip_address   text
);
create index if not exists idx_user_legal_acceptances_user
  on user_legal_acceptances (user_id, document_type, accepted_at desc);
