-- Divini Procure: fix "delete my account" hard-failing for real users.
--
-- ALFY2 Section 06 (DB integrity/lifecycle). db.ts's deleteMyAccount()
-- hard-deletes the users row. 34 foreign keys across 17 tables reference
-- users(id) for "who did this" attribution columns (created_by,
-- uploaded_by, owner_user_id, assigned_to, etc.) and were left at
-- Postgres's default ON DELETE NO ACTION. Any user who had personally
-- authored so much as a single document upload, pipeline opportunity,
-- follow-up workflow, submittal, etc. - while their company survived them
-- (i.e. they were not the last member) - could not delete their own
-- account at all: the DELETE raised a raw foreign-key-violation error,
-- surfaced to the user as a generic 500.
--
-- Reproduced live 2026-08-08: a user who uploaded one document, in a
-- two-member company, got
--   "update or delete on table \"users\" violates foreign key constraint
--    \"documents_uploaded_by_fkey\" on table \"documents\""
-- on POST /account/delete - a real GDPR/CCPA right-to-erasure request
-- that could never complete for any user with genuine product usage. This
-- was not caught by Section 02's earlier "PASS" on account deletion
-- because that testing used fresh accounts with no cross-references.
--
-- Fix: ON DELETE SET NULL on every one of these attribution FKs (all
-- columns are already nullable - verified before writing this file). The
-- underlying record (the document, the pipeline opportunity, the
-- submittal) is NOT deleted - it just loses the specific-user attribution,
-- which is the correct semantic for account deletion: the business record
-- survives for the company/team that still owns it, only the erased
-- user's identity is unlinked from it. This does not touch any FK that
-- represents actual ownership/tenancy (company_id, vendor_company_id,
-- building_id, etc.) - those remain CASCADE/RESTRICT as already defined
-- elsewhere; only "who acted" attribution columns are affected here.
--
-- Idempotent: safe to re-run (drop if exists, then re-add).
-- Zero em dashes by convention.

alter table ai_extraction_runs drop constraint if exists ai_extraction_runs_created_by_fkey;
alter table ai_extraction_runs add constraint ai_extraction_runs_created_by_fkey foreign key (created_by) references users(id) on delete set null;
alter table bid_revisions drop constraint if exists bid_revisions_created_by_fkey;
alter table bid_revisions add constraint bid_revisions_created_by_fkey foreign key (created_by) references users(id) on delete set null;
alter table bid_templates drop constraint if exists bid_templates_created_by_fkey;
alter table bid_templates add constraint bid_templates_created_by_fkey foreign key (created_by) references users(id) on delete set null;
alter table bid_versions drop constraint if exists bid_versions_created_by_fkey;
alter table bid_versions add constraint bid_versions_created_by_fkey foreign key (created_by) references users(id) on delete set null;
alter table blueprint_document_package_links drop constraint if exists blueprint_document_package_links_linked_by_fkey;
alter table blueprint_document_package_links add constraint blueprint_document_package_links_linked_by_fkey foreign key (linked_by) references users(id) on delete set null;
alter table blueprint_summary_fields drop constraint if exists blueprint_summary_fields_edited_by_fkey;
alter table blueprint_summary_fields add constraint blueprint_summary_fields_edited_by_fkey foreign key (edited_by) references users(id) on delete set null;
alter table blueprint_trade_suggestions drop constraint if exists blueprint_trade_suggestions_reviewed_by_fkey;
alter table blueprint_trade_suggestions add constraint blueprint_trade_suggestions_reviewed_by_fkey foreign key (reviewed_by) references users(id) on delete set null;
alter table budget_imports drop constraint if exists budget_imports_created_by_fkey;
alter table budget_imports add constraint budget_imports_created_by_fkey foreign key (created_by) references users(id) on delete set null;
alter table current_engagements drop constraint if exists current_engagements_created_by_fkey;
alter table current_engagements add constraint current_engagements_created_by_fkey foreign key (created_by) references users(id) on delete set null;
alter table deliveries drop constraint if exists deliveries_created_by_fkey;
alter table deliveries add constraint deliveries_created_by_fkey foreign key (created_by) references users(id) on delete set null;
alter table document_addenda drop constraint if exists document_addenda_created_by_fkey;
alter table document_addenda add constraint document_addenda_created_by_fkey foreign key (created_by) references users(id) on delete set null;
alter table document_addenda drop constraint if exists document_addenda_published_by_fkey;
alter table document_addenda add constraint document_addenda_published_by_fkey foreign key (published_by) references users(id) on delete set null;
alter table document_addendum_acknowledgments drop constraint if exists document_addendum_acknowledgments_acknowledged_by_fkey;
alter table document_addendum_acknowledgments add constraint document_addendum_acknowledgments_acknowledged_by_fkey foreign key (acknowledged_by) references users(id) on delete set null;
alter table documents drop constraint if exists documents_uploaded_by_fkey;
alter table documents add constraint documents_uploaded_by_fkey foreign key (uploaded_by) references users(id) on delete set null;
alter table follow_up_actions drop constraint if exists follow_up_actions_approved_by_fkey;
alter table follow_up_actions add constraint follow_up_actions_approved_by_fkey foreign key (approved_by) references users(id) on delete set null;
alter table follow_up_enrollments drop constraint if exists follow_up_enrollments_created_by_fkey;
alter table follow_up_enrollments add constraint follow_up_enrollments_created_by_fkey foreign key (created_by) references users(id) on delete set null;
alter table follow_up_templates drop constraint if exists follow_up_templates_created_by_fkey;
alter table follow_up_templates add constraint follow_up_templates_created_by_fkey foreign key (created_by) references users(id) on delete set null;
alter table follow_up_workflows drop constraint if exists follow_up_workflows_created_by_fkey;
alter table follow_up_workflows add constraint follow_up_workflows_created_by_fkey foreign key (created_by) references users(id) on delete set null;
alter table packages drop constraint if exists packages_published_by_fkey;
alter table packages add constraint packages_published_by_fkey foreign key (published_by) references users(id) on delete set null;
alter table packages drop constraint if exists packages_terms_acknowledged_by_fkey;
alter table packages add constraint packages_terms_acknowledged_by_fkey foreign key (terms_acknowledged_by) references users(id) on delete set null;
alter table pipeline_activities drop constraint if exists pipeline_activities_created_by_fkey;
alter table pipeline_activities add constraint pipeline_activities_created_by_fkey foreign key (created_by) references users(id) on delete set null;
alter table pipeline_opportunities drop constraint if exists pipeline_opportunities_created_by_fkey;
alter table pipeline_opportunities add constraint pipeline_opportunities_created_by_fkey foreign key (created_by) references users(id) on delete set null;
alter table pipeline_opportunities drop constraint if exists pipeline_opportunities_owner_user_id_fkey;
alter table pipeline_opportunities add constraint pipeline_opportunities_owner_user_id_fkey foreign key (owner_user_id) references users(id) on delete set null;
alter table pipeline_stage_history drop constraint if exists pipeline_stage_history_changed_by_fkey;
alter table pipeline_stage_history add constraint pipeline_stage_history_changed_by_fkey foreign key (changed_by) references users(id) on delete set null;
alter table pipeline_tasks drop constraint if exists pipeline_tasks_assigned_to_fkey;
alter table pipeline_tasks add constraint pipeline_tasks_assigned_to_fkey foreign key (assigned_to) references users(id) on delete set null;
alter table pipeline_tasks drop constraint if exists pipeline_tasks_completed_by_fkey;
alter table pipeline_tasks add constraint pipeline_tasks_completed_by_fkey foreign key (completed_by) references users(id) on delete set null;
alter table pipeline_tasks drop constraint if exists pipeline_tasks_created_by_fkey;
alter table pipeline_tasks add constraint pipeline_tasks_created_by_fkey foreign key (created_by) references users(id) on delete set null;
alter table quantity_observations drop constraint if exists quantity_observations_created_by_fkey;
alter table quantity_observations add constraint quantity_observations_created_by_fkey foreign key (created_by) references users(id) on delete set null;
alter table quantity_observations drop constraint if exists quantity_observations_updated_by_fkey;
alter table quantity_observations add constraint quantity_observations_updated_by_fkey foreign key (updated_by) references users(id) on delete set null;
alter table scope_change_events drop constraint if exists scope_change_events_actor_fkey;
alter table scope_change_events add constraint scope_change_events_actor_fkey foreign key (actor) references users(id) on delete set null;
alter table scope_instances drop constraint if exists scope_instances_created_by_fkey;
alter table scope_instances add constraint scope_instances_created_by_fkey foreign key (created_by) references users(id) on delete set null;
alter table scope_templates drop constraint if exists scope_templates_created_by_fkey;
alter table scope_templates add constraint scope_templates_created_by_fkey foreign key (created_by) references users(id) on delete set null;
alter table scope_versions drop constraint if exists scope_versions_created_by_fkey;
alter table scope_versions add constraint scope_versions_created_by_fkey foreign key (created_by) references users(id) on delete set null;
alter table submittals drop constraint if exists submittals_created_by_fkey;
alter table submittals add constraint submittals_created_by_fkey foreign key (created_by) references users(id) on delete set null;
