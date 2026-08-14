/**
 * Shared authorization helpers for the Phase 1 financial spine routes
 * (budget/allowance ledgers, awards, invoices, payments, financial
 * summaries). Every one of these mirrors an existing, already-verified
 * pattern from award-workflow.ts / change-orders.ts / retainage.ts rather
 * than inventing a new authorization model - see each function's reference.
 */
import { q1 } from "../pool.js";

/** True when the user is a member of the given company. Mirrors award-workflow.ts. */
export async function isMemberOfCompany(userId: string, companyId: string | null | undefined): Promise<boolean> {
  if (!companyId) return false;
  const row = await q1(`select 1 from company_members where user_id = $1 and company_id = $2`, [
    userId,
    companyId,
  ]);
  return !!row;
}

/** Resolve the developer (owning) company of a building. Mirrors change-orders.ts. */
export async function buildingDeveloperCompany(buildingId: string): Promise<string | null> {
  const row = await q1<{ company_id: string }>(`select company_id from buildings where id = $1`, [
    buildingId,
  ]);
  return row?.company_id ?? null;
}

/**
 * True when the signed-in user is the developer that owns the package, i.e. a
 * member of the company that owns the package's building. Mirrors
 * db.ts/award-workflow.ts's userOwnsPackage.
 */
export async function userOwnsPackage(userId: string, packageId: string): Promise<boolean> {
  const row = await q1(
    `select 1 from packages p
       join buildings b on b.id = p.building_id
       join company_members cm on cm.company_id = b.company_id
      where p.id = $1 and cm.user_id = $2`,
    [packageId, userId],
  );
  return !!row;
}

/** Resolve a package's building_id + developer company_id in one query. */
export async function packageContext(
  packageId: string,
): Promise<{ building_id: string; developer_company_id: string } | null> {
  const row = await q1<{ building_id: string; developer_company_id: string }>(
    `select p.building_id, b.company_id as developer_company_id
       from packages p join buildings b on b.id = p.building_id
      where p.id = $1`,
    [packageId],
  );
  return row ?? null;
}

/** Resolve a bid's package/building/developer/vendor context in one query. */
export async function bidContext(bidId: string): Promise<{
  package_id: string;
  building_id: string;
  developer_company_id: string;
  vendor_company_id: string;
  price: number | string | null;
  status: string;
  awarded: boolean;
} | null> {
  const row = await q1<any>(
    `select b.id as bid_id, b.package_id, b.vendor_company_id, b.price, b.status, b.awarded,
            p.building_id, bl.company_id as developer_company_id
       from bids b
       join packages p on p.id = b.package_id
       join buildings bl on bl.id = p.building_id
      where b.id = $1`,
    [bidId],
  );
  return row ?? null;
}
