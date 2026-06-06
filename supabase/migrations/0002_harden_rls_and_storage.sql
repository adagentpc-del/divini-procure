drop policy if exists revisions_rw on bid_revisions;
create policy revisions_rw on bid_revisions for all to authenticated
using (
  bid_id in (select id from bids where vendor_company_id in (select user_company_ids())
             or package_id in (select p.id from packages p join buildings b on b.id=p.building_id
                               where b.company_id in (select user_company_ids())))
) with check (
  bid_id in (select id from bids where vendor_company_id in (select user_company_ids())
             or package_id in (select p.id from packages p join buildings b on b.id=p.building_id
                               where b.company_id in (select user_company_ids())))
);
drop policy if exists "logos read" on storage.objects;
revoke execute on function public.user_company_ids() from anon, public;
