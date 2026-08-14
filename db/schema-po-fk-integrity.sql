-- Divini Procure - Phase 0 relational integrity fix (procurement-money spine).
--
-- purchase_orders.package_id / building_id / developer_company_id /
-- vendor_company_id and change_orders.vendor_company_id /
-- developer_company_id were bare uuid columns with no foreign key
-- constraint at all - a typo, a bad manual insert, or a bug anywhere
-- upstream could silently create a PO or change order pointing at a
-- package/building/company that does not exist, and nothing in the
-- database would ever catch it. purchase_orders.bid_id already had a
-- correct FK; this brings the rest of the same table (and the equally
-- money-relevant change_orders table) up to the same standard.
--
-- Scope: this phase intentionally does NOT attempt a repo-wide FK
-- cleanup. platform_revenue, payout_instructions, connect_accounts, and
-- bid_invites.developer_company_id are similarly bare uuid columns
-- identified during this audit but are deferred to Phase 1 - documented
-- in the Phase 0 completion report rather than rushed in here.
--
-- Safety: before writing this file, every one of the 6 columns below was
-- checked for orphaned values (a non-null uuid with no matching row in
-- the referenced table) against both divini_procure and divini_test.
-- Zero orphans were found in either database for any column, so these
-- constraints are added directly with no cleanup migration required. All
-- six columns were already nullable, so no data had to change shape to
-- accept ON DELETE SET NULL.
-- Zero em dashes by convention.

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'purchase_orders_package_id_fkey') then
    alter table purchase_orders
      add constraint purchase_orders_package_id_fkey
        foreign key (package_id) references packages(id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'purchase_orders_building_id_fkey') then
    alter table purchase_orders
      add constraint purchase_orders_building_id_fkey
        foreign key (building_id) references buildings(id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'purchase_orders_developer_company_id_fkey') then
    alter table purchase_orders
      add constraint purchase_orders_developer_company_id_fkey
        foreign key (developer_company_id) references companies(id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'purchase_orders_vendor_company_id_fkey') then
    alter table purchase_orders
      add constraint purchase_orders_vendor_company_id_fkey
        foreign key (vendor_company_id) references companies(id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'change_orders_vendor_company_id_fkey') then
    alter table change_orders
      add constraint change_orders_vendor_company_id_fkey
        foreign key (vendor_company_id) references companies(id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'change_orders_developer_company_id_fkey') then
    alter table change_orders
      add constraint change_orders_developer_company_id_fkey
        foreign key (developer_company_id) references companies(id) on delete set null;
  end if;
end
$$;
