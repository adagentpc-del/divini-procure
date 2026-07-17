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
