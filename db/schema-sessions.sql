-- Server-side session tracking for true logout revocation.
-- Each sign-in inserts a row; logout deletes it; verifySession checks it.
-- Expired rows are cleaned up by the cron job / periodic DELETE.

create table if not exists user_sessions (
  jti         text        primary key,
  user_id     uuid        not null references users(id) on delete cascade,
  email       text,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create index if not exists user_sessions_user_id_idx on user_sessions(user_id);
create index if not exists user_sessions_expires_at_idx on user_sessions(expires_at);
