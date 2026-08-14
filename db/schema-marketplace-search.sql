-- Divini Procure - Phase 0 item 21: modest, Postgres-native server-side
-- marketplace search.
--
-- SearchBids.tsx (the vendor-facing "Find bids" page) fetched EVERY open
-- package matching the vendor's own service categories via GET
-- /packages/open, then did 100% client-side substring filtering on
-- building name/category/developer/location in the browser - no
-- pagination, no server-side text query, every vendor's browser
-- downloading the full result set regardless of what they typed. This
-- adds real server-side full-text-ish search using pg_trgm (trigram
-- indexes accelerate both ILIKE '%term%' substring matching AND fuzzy
-- similarity), NOT a vector/semantic search stack and NOT Elasticsearch -
-- there is no demonstrated need for either at this data volume, per this
-- phase's explicit instruction.
--
-- Zero em dashes by convention.

create extension if not exists pg_trgm;

create index if not exists idx_buildings_name_trgm on buildings using gin (name gin_trgm_ops);
create index if not exists idx_buildings_location_trgm on buildings using gin (location gin_trgm_ops);
create index if not exists idx_buildings_developer_trgm on buildings using gin (developer gin_trgm_ops);
create index if not exists idx_packages_category_trgm on packages using gin (category gin_trgm_ops);
