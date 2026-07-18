-- Divini Procure: FK and constraint gap-closure migration.
-- Addresses audit items #33 (opportunity_teasers.company_id missing FK).
-- Safe to run multiple times (IF NOT EXISTS / DO blocks guard each change).
-- Zero em dashes by convention.

-- #33: opportunity_teasers.company_id has no FK constraint, allowing orphaned
-- rows that can never be reached through a company join. Add the constraint with
-- ON DELETE CASCADE so teaser records are removed when a company is deleted.
-- Run a cleanup pass first so the constraint application does not fail on
-- pre-existing orphans.

-- Step 1: remove any orphaned teasers whose company no longer exists.
delete from opportunity_teasers
 where company_id not in (select id from companies)
   and company_id is not null;

-- Step 2: add the FK if it does not already exist.
do $$
begin
  if not exists (
    select 1
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on tc.constraint_name = kcu.constraint_name
       and tc.table_schema    = kcu.table_schema
     where tc.constraint_type = 'FOREIGN KEY'
       and tc.table_name       = 'opportunity_teasers'
       and kcu.column_name     = 'company_id'
  ) then
    alter table opportunity_teasers
      add constraint opportunity_teasers_company_id_fk
      foreign key (company_id) references companies (id) on delete cascade;
  end if;
end
$$;
