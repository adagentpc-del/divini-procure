-- CAN-SPAM compliance: email suppressions + per-recipient unsubscribe tokens.
-- Apply after db/apply-all.sql.

-- Global suppressions table. Once an address is here it is skipped on all
-- future campaign sends regardless of segment. An address is added when the
-- recipient clicks their unique unsubscribe link (GET /api/unsubscribe?token=).
create table if not exists email_suppressions (
  email          text        primary key,
  unsubscribed_at timestamptz not null default now(),
  source         text        -- 'campaign_link' | 'admin' | 'bounce'
);

-- One-time unsubscribe token per campaign send. Stored alongside the
-- campaign_recipients row so the token is traceable to a specific send without
-- exposing the recipient's email in the URL.
alter table campaign_recipients
  add column if not exists unsubscribe_token text unique;

create index if not exists idx_campaign_recipients_unsub_token
  on campaign_recipients (unsubscribe_token);
