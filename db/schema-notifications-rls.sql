-- Divini Procure - Phase 0: RLS on the notifications table, added at the
-- same time it becomes a genuinely user-readable table for the first time
-- (server/src/routes/notifications.ts's GET /notifications and PATCH
-- .../read - previously write-only, with no route reading it at all).
--
-- SELECT/UPDATE: your own row only, or admin - identical shape to the
-- `users` table's own-row policy in schema-rls.sql.
-- INSERT: your own row, or admin. Every writer that targets a DIFFERENT
-- user (the notify-vendor fan-out in lib/notify.ts, and blueprint.ts's
-- addendum-publish notification loop) already runs the insert through
-- runAsAdmin() for exactly this reason - see lib/notify.ts and the
-- comment on blueprint.ts's addendum-publish insert. The one remaining
-- writer (routes/follow-up.ts's processDueFollowUps) is a true background
-- job with no request context at all, which pool.ts already treats as
-- admin-equivalent automatically.
--
-- Zero em dashes by convention.

alter table notifications enable row level security;
alter table notifications force row level security;

drop policy if exists notifications_select on notifications;
create policy notifications_select on notifications
  for select using (
    user_id = current_setting('app.user_id', true)
    or current_user_is_admin()
  );

drop policy if exists notifications_insert on notifications;
create policy notifications_insert on notifications
  for insert with check (
    user_id = current_setting('app.user_id', true)
    or current_user_is_admin()
  );

drop policy if exists notifications_update on notifications;
create policy notifications_update on notifications
  for update using (
    user_id = current_setting('app.user_id', true)
    or current_user_is_admin()
  );

drop policy if exists notifications_delete on notifications;
create policy notifications_delete on notifications
  for delete using (
    user_id = current_setting('app.user_id', true)
    or current_user_is_admin()
  );
