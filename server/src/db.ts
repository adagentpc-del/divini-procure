/**
 * Data-access + AUTHORIZATION layer.
 *
 * This reimplements, in the backend, the exact intent of the Supabase RLS
 * policies from supabase/migrations/0001..0003. The pivotal RLS primitive was
 *
 *     user_company_ids() = select company_id from company_members where user_id = auth.uid()
 *
 * i.e. "the companies the current user belongs to". Every policy was expressed
 * in terms of that set. Here, `userCompanyIds(userId)` is that set, and each
 * function below scopes / gates writes the same way the policies did:
 *
 *   - companies:        read = any authed user (marketplace discovery);
 *                       write = only companies the user is a member of.
 *   - company_members:  manage only within your own companies.
 *   - vendor_profiles:  read any; write own company.
 *   - buildings:        read any; write own-company buildings.
 *   - packages:         read any; write only packages whose building is owned
 *                       by one of your companies.
 *   - package_line_items: read any; write only when the package's building is
 *                       owned by your company.
 *   - bids:             read = bids you placed OR bids on a package whose
 *                       building you own; vendor write = your own company's bids.
 *   - bid_items:        write only on your own bids.
 *   - documents:        read any; write own company.
 *   - rfq_questions:    read any; insert as your vendor company; answer only as
 *                       the package's building owner.
 *   - feature_flags:    read any authed; write = ADMIN only (the migration used
 *                       auth.jwt()->>'email' = 'adagentpc@gmail.com').
 *
 * A `ForbiddenError` is thrown when a caller violates the policy; routes map it
 * to HTTP 403. This is the critical correctness work of the re-platform.
 */
import { q, q1, pool } from "./pool.js";
import { getAdminAllowedEmails } from "./config.js";
import { PlanLimitError, enforceLimit } from "./lib/entitlement-guard.js";

/**
 * Enforce a plan limit before a create. Only a PlanLimitError (which extends
 * ForbiddenError -> HTTP 403) is allowed to block; any other failure inside the
 * entitlements engine is swallowed so a missing entitlement/tier row can never
 * turn a create into a 500. entitlements.ts already synthesizes free-tier
 * defaults, so the common path stays correct.
 */
async function guardLimit(
  companyId: string,
  limitKey: Parameters<typeof enforceLimit>[1],
): Promise<void> {
  try {
    await enforceLimit(companyId, limitKey);
  } catch (err) {
    if (err instanceof PlanLimitError) throw err;
    // Defensive: never convert an entitlements lookup failure into a 500.
  }
}

/** True when the email is in ADMIN_ALLOWED_EMAILS (mirrors auth.ts isAdmin). */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return getAdminAllowedEmails().includes(email.toLowerCase());
}

export class ForbiddenError extends Error {
  status = 403;
  constructor(msg = "forbidden") {
    super(msg);
    this.name = "ForbiddenError";
  }
}
export class NotFoundError extends Error {
  status = 404;
  constructor(msg = "not found") {
    super(msg);
    this.name = "NotFoundError";
  }
}

/** Upsert the user row (so company_members.user_id FK is satisfiable). */
export async function ensureUser(userId: string, email: string | null): Promise<void> {
  await q(
    `insert into users (id, email) values ($1, $2)
     on conflict (id) do update set email = coalesce(excluded.email, users.email)`,
    [userId, email],
  );
}

// ===========================================================================
// NATIVE AUTH (email/password) - user records keyed by email
// ===========================================================================

export interface UserRow {
  id: string;
  email: string | null;
  password_hash: string | null;
  email_verified: boolean;
  verify_token: string | null;
  verify_expires: string | null;
  reset_token: string | null;
  reset_expires: string | null;
  created_at: string;
}

/** Look up a user by (case-insensitive) email. */
export async function getUserByEmail(email: string): Promise<UserRow | null> {
  return q1<UserRow>(`select * from users where lower(email) = lower($1)`, [email]);
}

/** Look up a user by id. */
export async function getUserById(id: string): Promise<UserRow | null> {
  return q1<UserRow>(`select * from users where id = $1`, [id]);
}

export async function getUserByVerifyToken(token: string): Promise<UserRow | null> {
  return q1<UserRow>(`select * from users where verify_token = $1`, [token]);
}

/**
 * Look up a user by a password-reset token. The token is SHA-256 hashed before
 * storage so a database breach does not expose usable reset links.
 * The raw token (sent in email) is hashed here before the lookup.
 */
export async function getUserByResetToken(rawToken: string): Promise<UserRow | null> {
  const { createHash } = await import("node:crypto");
  const hashed = createHash("sha256").update(rawToken).digest("hex");
  return q1<UserRow>(`select * from users where reset_token = $1`, [hashed]);
}

/**
 * Register (UPSERT BY EMAIL). If a users row already exists for this email we
 * REUSE it (preserving its id and any company_members) and just set the new
 * password + a fresh verify token, flipping email_verified back to false. If
 * not, we create a fresh row with the supplied id. Returns the user row.
 */
export async function upsertUserForRegistration(args: {
  newUserId: string;
  email: string;
  passwordHash: string;
  verifyToken: string;
  verifyExpires: Date;
  termsAgreedAt?: Date;
  termsVersion?: string;
  consentIp?: string | null;
}): Promise<UserRow> {
  const existing = await getUserByEmail(args.email);
  if (existing) {
    return (await q1<UserRow>(
      `update users set
         email = $2,
         password_hash = $3,
         email_verified = false,
         verify_token = $4,
         verify_expires = $5,
         terms_agreed_at = coalesce($6, terms_agreed_at),
         terms_version = coalesce($7, terms_version),
         consent_ip = coalesce($8, consent_ip)
       where id = $1
       returning *`,
      [existing.id, args.email, args.passwordHash, args.verifyToken, args.verifyExpires.toISOString(),
       args.termsAgreedAt?.toISOString() ?? null, args.termsVersion ?? null, args.consentIp ?? null],
    ))!;
  }
  return (await q1<UserRow>(
    `insert into users (id, email, password_hash, email_verified, verify_token, verify_expires,
                        terms_agreed_at, terms_version, consent_ip)
     values ($1, $2, $3, false, $4, $5, $6, $7, $8)
     returning *`,
    [args.newUserId, args.email, args.passwordHash, args.verifyToken, args.verifyExpires.toISOString(),
     args.termsAgreedAt?.toISOString() ?? null, args.termsVersion ?? null, args.consentIp ?? null],
  ))!;
}

/** Return a user's role within a company, or null if they are not a member. */
export async function getMemberRole(userId: string, companyId: string): Promise<string | null> {
  const row = await q1<{ role: string }>(
    `select role from company_members where user_id = $1 and company_id = $2`,
    [userId, companyId],
  );
  return row?.role ?? null;
}

/** Mark a user verified and clear the verify token. */
export async function markEmailVerified(userId: string): Promise<UserRow | null> {
  return q1<UserRow>(
    `update users set email_verified = true, verify_token = null, verify_expires = null
       where id = $1 returning *`,
    [userId],
  );
}

/** Set a fresh verify token (resend-verification). */
export async function setVerifyToken(
  userId: string,
  token: string,
  expires: Date,
): Promise<void> {
  await q(`update users set verify_token = $2, verify_expires = $3 where id = $1`, [
    userId,
    token,
    expires.toISOString(),
  ]);
}

/**
 * Set a fresh password-reset token. The raw token is SHA-256 hashed before
 * storage so a database breach does not expose usable links. The raw token is
 * sent to the user's inbox and never persisted.
 */
export async function setResetToken(
  userId: string,
  rawToken: string,
  expires: Date,
): Promise<void> {
  const { createHash } = await import("node:crypto");
  const hashed = createHash("sha256").update(rawToken).digest("hex");
  await q(`update users set reset_token = $2, reset_expires = $3 where id = $1`, [
    userId,
    hashed,
    expires.toISOString(),
  ]);
}

/** Apply a new password and clear the reset token. */
export async function applyPasswordReset(userId: string, passwordHash: string): Promise<void> {
  await q(
    `update users set password_hash = $2, reset_token = null, reset_expires = null where id = $1`,
    [userId, passwordHash],
  );
}

// ===========================================================================
// OWNER-EMAIL TRANSFER
// ===========================================================================

/**
 * Transfer ownership of a company to a new email. Reassigns the company_members
 * 'owner' row to a user created/found for newEmail (unverified; they receive a
 * verify/claim email to set their password and take over), and points
 * companies.email at the new address. Only an existing owner/member may invoke
 * this (enforced via assertMemberOfCompany at the route layer / here).
 *
 * Returns { user, created } so the caller can send the right email and know
 * whether a fresh placeholder account was minted.
 */
export async function transferCompanyOwnerEmail(args: {
  actingUserId: string;
  companyId: string;
  newEmail: string;
  newUserId: string; // candidate id if a new user row must be created
  verifyToken: string;
  verifyExpires: Date;
}): Promise<{ user: UserRow; created: boolean }> {
  // The acting user must be a member (owner) of the company.
  await assertMemberOfCompany(args.actingUserId, args.companyId);

  const client = await pool.connect();
  try {
    await client.query("begin");

    // Find or create the target user by email. A brand-new target is created
    // unverified with a fresh verify/claim token; an existing user is reused
    // (their id + memberships are preserved) and given a fresh claim token.
    let target = (
      await client.query<UserRow>(`select * from users where lower(email) = lower($1)`, [args.newEmail])
    ).rows[0];
    let created = false;
    if (!target) {
      target = (
        await client.query<UserRow>(
          `insert into users (id, email, email_verified, verify_token, verify_expires)
           values ($1, $2, false, $3, $4) returning *`,
          [args.newUserId, args.newEmail, args.verifyToken, args.verifyExpires.toISOString()],
        )
      ).rows[0];
      created = true;
    } else {
      target = (
        await client.query<UserRow>(
          `update users set verify_token = $2, verify_expires = $3 where id = $1 returning *`,
          [target.id, args.verifyToken, args.verifyExpires.toISOString()],
        )
      ).rows[0];
    }

    // Reassign the 'owner' membership to the target user. Demote any existing
    // owner(s) to 'admin' (keeps them on the team) then upsert the target as
    // owner. company_members PK is (company_id, user_id).
    await client.query(
      `update company_members set role = 'admin' where company_id = $1 and role = 'owner'`,
      [args.companyId],
    );
    await client.query(
      `insert into company_members (company_id, user_id, role, seat)
       values ($1, $2, 'owner', 1)
       on conflict (company_id, user_id) do update set role = 'owner'`,
      [args.companyId, target.id],
    );

    // Point the company contact email at the new owner.
    await client.query(`update companies set email = $2 where id = $1`, [args.companyId, args.newEmail]);

    await client.query("commit");
    return { user: target, created };
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

/** The set of company ids the user belongs to (the RLS user_company_ids()). */
export async function userCompanyIds(userId: string): Promise<string[]> {
  const rows = await q<{ company_id: string }>(
    `select company_id from company_members where user_id = $1`,
    [userId],
  );
  return rows.map((r) => r.company_id);
}

async function assertMemberOfCompany(userId: string, companyId: string): Promise<void> {
  const row = await q1(
    `select 1 from company_members where user_id = $1 and company_id = $2`,
    [userId, companyId],
  );
  if (!row) throw new ForbiddenError("not a member of this company");
}

/** True when the user's company owns the building that owns this package. */
async function userOwnsPackage(userId: string, packageId: string): Promise<boolean> {
  const row = await q1(
    `select 1 from packages p
       join buildings b on b.id = p.building_id
       join company_members cm on cm.company_id = b.company_id
      where p.id = $1 and cm.user_id = $2`,
    [packageId, userId],
  );
  return !!row;
}

// ===========================================================================
// AUTH PROVIDER support (replaces AuthProvider loadCompany + Onboarding create)
// ===========================================================================

/** The first company the signed-in user belongs to (AuthProvider.loadCompany). */
export async function getMyCompany(userId: string) {
  return q1(
    `select c.* from companies c
       join company_members m on m.company_id = c.id
      where m.user_id = $1
      order by m.created_at asc
      limit 1`,
    [userId],
  );
}

/** createCompanyForUser - creates company, owner membership, vendor profile.
 *  Backward compatible: the original buyer/vendor + contact fields still work;
 *  the richer real-estate-developer profile fields are all optional. */
export async function createCompanyForUser(
  userId: string,
  payload: {
    kind: "buyer" | "vendor" | "investor";
    name: string;
    contact_name?: string;
    contact_title?: string;
    email?: string;
    phone?: string;
    street?: string;
    city?: string;
    region?: string;
    services?: string[];
    // richer developer profile (all optional)
    website?: string;
    description?: string;
    state?: string;
    ownership_group?: string;
    development_team?: string;
    asset_types?: string[];
    headquarters?: string;
    // vendor + investor profile arrays (all optional)
    coverage_areas?: string[];
    service_categories?: string[];
    capabilities?: string[];
    focus_areas?: string[];
    geographies?: string[];
  },
) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const company = (
      await client.query(
        `insert into companies
           (kind, name, contact_name, contact_title, email, phone, street, city, region,
            website, description, state, ownership_group, development_team, asset_types, headquarters,
            coverage_areas, service_categories, capabilities, focus_areas, geographies)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) returning *`,
        [
          payload.kind,
          payload.name,
          payload.contact_name ?? null,
          payload.contact_title ?? null,
          payload.email ?? null,
          payload.phone ?? null,
          payload.street ?? null,
          payload.city ?? null,
          payload.region ?? null,
          payload.website ?? null,
          payload.description ?? null,
          payload.state ?? null,
          payload.ownership_group ?? null,
          payload.development_team ?? null,
          payload.asset_types ?? [],
          payload.headquarters ?? null,
          payload.coverage_areas ?? [],
          payload.service_categories ?? [],
          payload.capabilities ?? [],
          payload.focus_areas ?? [],
          payload.geographies ?? [],
        ],
      )
    ).rows[0];

    await client.query(
      `insert into company_members (company_id, user_id, role, seat) values ($1,$2,'owner',1)`,
      [company.id, userId],
    );

    if (payload.kind === "vendor") {
      await client.query(
        `insert into vendor_profiles (company_id, trust, verify_status, services)
         values ($1, 70, 'pending', $2)`,
        [company.id, payload.services ?? []],
      );
    }
    await client.query("commit");
    return company;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

/** Profile update - only your own company (companies_write policy).
 *  Each field is coalesced, so undefined leaves the existing value untouched.
 *  Handles both the original contact fields and the richer developer profile. */
export async function updateCompany(
  userId: string,
  companyId: string,
  patch: {
    name?: string;
    contact_name?: string;
    contact_title?: string;
    phone?: string;
    street?: string;
    city?: string;
    region?: string;
    website?: string;
    description?: string;
    state?: string;
    ownership_group?: string;
    development_team?: string;
    asset_types?: string[];
    headquarters?: string;
    coverage_areas?: string[];
    service_categories?: string[];
    capabilities?: string[];
    focus_areas?: string[];
    geographies?: string[];
  },
) {
  await assertMemberOfCompany(userId, companyId);
  await q(
    `update companies set
       name = coalesce($2,name),
       contact_name = coalesce($3,contact_name),
       contact_title = coalesce($4,contact_title),
       phone = coalesce($5,phone),
       street = coalesce($6,street),
       city = coalesce($7,city),
       region = coalesce($8,region),
       website = coalesce($9,website),
       description = coalesce($10,description),
       state = coalesce($11,state),
       ownership_group = coalesce($12,ownership_group),
       development_team = coalesce($13,development_team),
       asset_types = coalesce($14,asset_types),
       headquarters = coalesce($15,headquarters),
       coverage_areas = coalesce($16,coverage_areas),
       service_categories = coalesce($17,service_categories),
       capabilities = coalesce($18,capabilities),
       focus_areas = coalesce($19,focus_areas),
       geographies = coalesce($20,geographies)
     where id = $1`,
    [
      companyId,
      patch.name ?? null,
      patch.contact_name ?? null,
      patch.contact_title ?? null,
      patch.phone ?? null,
      patch.street ?? null,
      patch.city ?? null,
      patch.region ?? null,
      patch.website ?? null,
      patch.description ?? null,
      patch.state ?? null,
      patch.ownership_group ?? null,
      patch.development_team ?? null,
      patch.asset_types ?? null,
      patch.headquarters ?? null,
      patch.coverage_areas ?? null,
      patch.service_categories ?? null,
      patch.capabilities ?? null,
      patch.focus_areas ?? null,
      patch.geographies ?? null,
    ],
  );
  return q1(`select * from companies where id = $1`, [companyId]);
}

/**
 * delete_my_account RPC equivalent: removes the user's membership(s); if a
 * company is left with no members, the company (and its cascaded data) is
 * deleted. Then the user row is removed.
 */
export async function deleteMyAccount(userId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const companies = (
      await client.query(`select company_id from company_members where user_id = $1`, [userId])
    ).rows.map((r) => r.company_id);
    await client.query(`delete from company_members where user_id = $1`, [userId]);
    for (const cid of companies) {
      const left = (
        await client.query(`select 1 from company_members where company_id = $1 limit 1`, [cid])
      ).rows[0];
      if (!left) await client.query(`delete from companies where id = $1`, [cid]);
    }
    await client.query(`delete from users where id = $1`, [userId]);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

// ===========================================================================
// DATA RIGHTS (GDPR/CPRA portability) - export everything tied to this user
// ===========================================================================

const SECRET_COL = /(password|secret|token|hash|otp|mfa|private_key)/i;

/** Drop obviously-sensitive columns (password hashes, tokens) from exported rows. */
function redactRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(r)) if (!SECRET_COL.test(k)) out[k] = r[k];
    return out;
  });
}

/** Public tables that have a given column, validated against an identifier allowlist. */
async function publicTablesWithColumn(col: string): Promise<string[]> {
  const rows = await q<{ table_name: string }>(
    `select table_name from information_schema.columns
      where table_schema = 'public' and column_name = $1`,
    [col],
  );
  return rows
    .map((r) => r.table_name)
    .filter((t) => /^[a-z_][a-z0-9_]*$/.test(t));
}

/**
 * Assemble a full JSON export of the caller's data: their user row, the
 * companies they belong to, and every public-table row scoped to their user id
 * or to one of their companies. Sensitive columns are redacted.
 */
export async function exportMyData(userId: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {
    exported_at: new Date().toISOString(),
    user_id: userId,
  };

  const userRows = await q(
    `select id, email, email_verified, created_at from users where id = $1`,
    [userId],
  );
  out.user = userRows[0] ?? null;

  const companyIds = await userCompanyIds(userId);
  out.companies =
    companyIds.length > 0
      ? await q(`select * from companies where id = any($1)`, [companyIds])
      : [];

  // Rows keyed to the user directly.
  const byUser: Record<string, unknown> = {};
  for (const t of await publicTablesWithColumn('user_id')) {
    try {
      const r = await q<Record<string, unknown>>(
        `select * from ${t} where user_id = $1 limit 5000`,
        [userId],
      );
      if (r.length) byUser[t] = redactRows(r);
    } catch { /* skip tables that fail (view/perm/type) */ }
  }
  out.records_by_user = byUser;

  // Rows keyed to a company the user belongs to.
  const byCompany: Record<string, unknown> = {};
  if (companyIds.length > 0) {
    for (const t of await publicTablesWithColumn('company_id')) {
      try {
        const r = await q<Record<string, unknown>>(
          `select * from ${t} where company_id = any($1) limit 5000`,
          [companyIds],
        );
        if (r.length) byCompany[t] = redactRows(r);
      } catch { /* skip */ }
    }
  }
  out.records_by_company = byCompany;

  return out;
}

// ===========================================================================
// BUILDINGS / PROJECTS
// ===========================================================================

export async function getBuildings(userId: string, companyId: string) {
  // db.ts getBuildings filters by company_id; buildings read is public but the
  // SPA only ever reads its OWN company's buildings here.
  return q(`select * from buildings where company_id = $1 order by created_at`, [companyId]);
}

export async function getBuilding(_userId: string, id: string) {
  // buildings_read: public to any authed user.
  return q1(`select * from buildings where id = $1`, [id]);
}

export async function createBuilding(
  userId: string,
  payload: { company_id: string; name: string; location?: string; developer?: string },
) {
  // buildings_write: must be a member of the owning company.
  await assertMemberOfCompany(userId, payload.company_id);
  // Plan limit: block when the company is at its active-project cap.
  await guardLimit(payload.company_id, "active_project_limit");
  return q1(
    `insert into buildings (company_id, name, location, developer, progress)
     values ($1,$2,$3,$4,0) returning *`,
    [payload.company_id, payload.name, payload.location ?? null, payload.developer ?? null],
  );
}

// ===========================================================================
// PACKAGES
// ===========================================================================

export async function getPackages(_userId: string, buildingId: string) {
  return q(`select * from packages where building_id = $1 order by created_at`, [buildingId]);
}

export async function getOpenPackages(_userId: string, categories?: string[]) {
  const params: any[] = [];
  let sql = `select p.*, to_jsonb(b) - 'id' as _b, b.name as _bname, b.location as _bloc, b.developer as _bdev
             from packages p join buildings b on b.id = p.building_id
             where p.status in ('open','shortlisting')`;
  if (categories && categories.length) {
    params.push(categories);
    sql += ` and p.category = any($1)`;
  }
  sql += ` order by p.deadline`;
  const rows = await q<any>(sql, params);
  return rows.map((r) => {
    const { _b, _bname, _bloc, _bdev, ...pkg } = r;
    return { ...pkg, building: { name: _bname, location: _bloc, developer: _bdev } };
  });
}

export async function getPackage(_userId: string, id: string) {
  const r = await q1<any>(
    `select p.*, b.id as _bid, b.name as _bname, b.location as _bloc, b.developer as _bdev, b.company_id as _bcompany
       from packages p join buildings b on b.id = p.building_id
      where p.id = $1`,
    [id],
  );
  if (!r) return null;
  const { _bid, _bname, _bloc, _bdev, _bcompany, ...pkg } = r;
  return {
    ...pkg,
    building: { id: _bid, name: _bname, location: _bloc, developer: _bdev, company_id: _bcompany },
  };
}

export async function createPackage(
  userId: string,
  buildingId: string,
  p: { category: string; status?: string; deadline?: string; budget_min?: number; budget_max?: number },
) {
  // packages_write: the building must be owned by one of the user's companies.
  // Resolve the owning company_id in the same check so we can enforce the
  // company's bid-package plan limit before inserting.
  const owned = await q1<{ company_id: string }>(
    `select b.company_id from buildings b join company_members cm on cm.company_id = b.company_id
      where b.id = $1 and cm.user_id = $2`,
    [buildingId, userId],
  );
  if (!owned) throw new ForbiddenError("not the owner of this building");
  // Plan limit: block when the owning company is at its bid-package cap.
  await guardLimit(owned.company_id, "bid_package_limit");
  return q1(
    `insert into packages (building_id, category, status, deadline, budget_min, budget_max)
     values ($1,$2,coalesce($3,'open'),$4,$5,$6) returning *`,
    [buildingId, p.category, p.status ?? null, p.deadline ?? null, p.budget_min ?? null, p.budget_max ?? null],
  );
}

export async function setPackageStatus(userId: string, id: string, status: string) {
  if (!(await userOwnsPackage(userId, id))) throw new ForbiddenError();
  await q(`update packages set status = $2 where id = $1`, [id, status]);
}

// ===========================================================================
// PACKAGE LINE ITEMS (BOQ)
// ===========================================================================

export async function getLineItems(_userId: string, packageId: string) {
  return q(`select * from package_line_items where package_id = $1 order by sort`, [packageId]);
}

export async function addLineItem(
  userId: string,
  packageId: string,
  li: { description: string; qty?: number; unit?: string; cost_code?: string; item_no?: string },
) {
  // pli_write: package's building must be owned by the user's company.
  if (!(await userOwnsPackage(userId, packageId))) throw new ForbiddenError();
  await q(
    `insert into package_line_items (package_id, description, qty, unit, cost_code, item_no)
     values ($1,$2,coalesce($3,1),$4,$5,$6)`,
    [packageId, li.description, li.qty ?? null, li.unit ?? null, li.cost_code ?? null, li.item_no ?? null],
  );
}

export async function deleteLineItem(userId: string, id: string) {
  const owned = await q1(
    `select 1 from package_line_items li
       join packages p on p.id = li.package_id
       join buildings b on b.id = p.building_id
       join company_members cm on cm.company_id = b.company_id
      where li.id = $1 and cm.user_id = $2`,
    [id, userId],
  );
  if (!owned) throw new ForbiddenError();
  await q(`delete from package_line_items where id = $1`, [id]);
}

// ===========================================================================
// BIDS
// ===========================================================================

export async function getMyBids(userId: string, companyId: string) {
  await assertMemberOfCompany(userId, companyId);
  const rows = await q<any>(
    `select bd.*, p.category as _pcat, b.name as _bname
       from bids bd
       join packages p on p.id = bd.package_id
       join buildings b on b.id = p.building_id
      where bd.vendor_company_id = $1
      order by bd.created_at desc`,
    [companyId],
  );
  return rows.map((r) => {
    const { _pcat, _bname, ...bid } = r;
    return { ...bid, package: { category: _pcat, building: { name: _bname } } };
  });
}

export async function getBidsForPackage(userId: string, packageId: string) {
  // bids_read: visible to the bidding vendor OR the buyer that owns the package.
  // The owner sees all bids; a vendor sees only their own.
  const owner = await userOwnsPackage(userId, packageId);
  const myCompanies = await userCompanyIds(userId);
  if (!owner && myCompanies.length === 0) return [];
  let sql = `select bd.*, c.name as _vname from bids bd join companies c on c.id = bd.vendor_company_id
             where bd.package_id = $1`;
  const params: any[] = [packageId];
  if (!owner) {
    params.push(myCompanies);
    sql += ` and bd.vendor_company_id = any($2)`;
  }
  sql += ` order by bd.price`;
  const rows = await q<any>(sql, params);
  return rows.map((r) => {
    const { _vname, ...bid } = r;
    return { ...bid, vendor: { name: _vname } };
  });
}

export async function submitPricedBid(
  userId: string,
  packageId: string,
  vendorCompanyId: string,
  payload: {
    price: number;
    days: number;
    note?: string;
    items?: { line_item_id: string; unit_price: number; qty: number; amount: number }[];
  },
) {
  // bids_vendor_write: must place the bid as one of YOUR companies.
  await assertMemberOfCompany(userId, vendorCompanyId);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const bid = (
      await client.query(
        `insert into bids (package_id, vendor_company_id, price, days, note, status, docs_ok)
         values ($1,$2,$3,$4,$5,'submitted',true) returning *`,
        [packageId, vendorCompanyId, payload.price, payload.days, payload.note ?? null],
      )
    ).rows[0];
    if (payload.items && payload.items.length) {
      for (const i of payload.items) {
        await client.query(
          `insert into bid_items (bid_id, line_item_id, unit_price, qty, amount)
           values ($1,$2,$3,$4,$5)`,
          [bid.id, i.line_item_id, i.unit_price, i.qty, i.amount],
        );
      }
    }
    await client.query("commit");
    return bid;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

// ===========================================================================
// VENDOR PROFILE
// ===========================================================================

export async function getVendorProfile(_userId: string, companyId: string) {
  // vprofiles_read: public to any authed user.
  return q1(`select * from vendor_profiles where company_id = $1`, [companyId]);
}

// ===========================================================================
// RFQ Q&A
// ===========================================================================

export async function getQuestions(_userId: string, packageId: string) {
  const rows = await q<any>(
    `select r.*, c.name as _vname from rfq_questions r
       left join companies c on c.id = r.vendor_company_id
      where r.package_id = $1 order by r.created_at`,
    [packageId],
  );
  return rows.map((r) => {
    const { _vname, ...row } = r;
    return { ...row, vendor: { name: _vname } };
  });
}

export async function askQuestion(
  userId: string,
  packageId: string,
  vendorCompanyId: string,
  question: string,
) {
  // rfq_insert: vendor_company_id must be one of your companies.
  await assertMemberOfCompany(userId, vendorCompanyId);
  await q(
    `insert into rfq_questions (package_id, vendor_company_id, question) values ($1,$2,$3)`,
    [packageId, vendorCompanyId, question],
  );
}

export async function answerQuestion(userId: string, id: string, answer: string) {
  // rfq_answer: only the package's building owner may answer.
  const owned = await q1(
    `select 1 from rfq_questions r
       join packages p on p.id = r.package_id
       join buildings b on b.id = p.building_id
       join company_members cm on cm.company_id = b.company_id
      where r.id = $1 and cm.user_id = $2`,
    [id, userId],
  );
  if (!owned) throw new ForbiddenError();
  await q(`update rfq_questions set answer = $2, answered_at = now() where id = $1`, [id, answer]);
}

// ===========================================================================
// FEATURE FLAGS
// ===========================================================================

export async function getFeatureFlags() {
  return q(`select * from feature_flags order by sort`);
}

export async function setFeatureFlagEnabled(key: string, enabled: boolean) {
  await q(`update feature_flags set enabled = $2 where key = $1`, [key, enabled]);
}

export async function setFeatureFlagAudience(key: string, audience: string) {
  await q(`update feature_flags set audience = $2 where key = $1`, [key, audience]);
}

// ===========================================================================
// DOCUMENTS (metadata; file bytes handled by storage.ts)
// ===========================================================================

export async function getDocuments(userId: string, opts: { packageId?: string; buildingId?: string }) {
  if (opts.packageId) {
    // IDOR fix: verify the user is a member of the company that owns the package.
    const pkg = await q1<{ company_id: string }>(
      `select b.company_id
         from packages p
         join buildings b on b.id = p.building_id
        where p.id = $1`,
      [opts.packageId],
    );
    if (!pkg) return [];
    const member = await q1(
      `select 1 from company_members where user_id = $1 and company_id = $2`,
      [userId, pkg.company_id],
    );
    if (!member) throw new ForbiddenError("not a member of the company that owns this package");
    return q(`select * from documents where package_id = $1 order by created_at desc`, [opts.packageId]);
  }
  if (opts.buildingId) {
    // IDOR fix: verify the user is a member of the company that owns the building.
    const bld = await q1<{ company_id: string }>(
      `select company_id from buildings where id = $1`,
      [opts.buildingId],
    );
    if (!bld) return [];
    const member = await q1(
      `select 1 from company_members where user_id = $1 and company_id = $2`,
      [userId, bld.company_id],
    );
    if (!member) throw new ForbiddenError("not a member of the company that owns this building");
    return q(`select * from documents where building_id = $1 order by created_at desc`, [opts.buildingId]);
  }
  // No filter: return only documents belonging to the user's own company.
  const myCompanies = await q<{ company_id: string }>(
    `select company_id from company_members where user_id = $1`,
    [userId],
  );
  if (myCompanies.length === 0) return [];
  const ids = myCompanies.map((r) => r.company_id);
  return q(
    `select * from documents where company_id = ANY($1::text[]) order by created_at desc`,
    [ids],
  );
}

export async function insertDocument(
  userId: string,
  d: {
    company_id: string;
    building_id?: string | null;
    package_id?: string | null;
    name: string;
    kind?: string | null;
    storage_path: string;
    size?: number | null;
  },
) {
  // docs_write: must be a member of the owning company.
  await assertMemberOfCompany(userId, d.company_id);
  return q1(
    `insert into documents (company_id, building_id, package_id, name, kind, storage_path, size, uploaded_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
    [
      d.company_id,
      d.building_id ?? null,
      d.package_id ?? null,
      d.name,
      d.kind ?? null,
      d.storage_path,
      d.size ?? null,
      userId,
    ],
  );
}

/**
 * Authorize a download of a document by storage_path. Per docs_read the SPA
 * treats documents as readable by any authed user, so we only require that the
 * path corresponds to a real document row. Returns the document or null.
 */
export async function getDocumentByPath(storagePath: string) {
  return q1(`select * from documents where storage_path = $1`, [storagePath]);
}

// ===========================================================================
// ADMIN CONSOLE (admin-only; gated by requireAdmin in routes)
// ===========================================================================

/** Platform-wide overview for the admin console - counts + recent records. */
export async function adminOverview() {
  const counts = await q1<any>(
    `select
       (select count(*) from companies) as companies,
       (select count(*) from companies where kind='buyer') as buyers,
       (select count(*) from companies where kind='vendor') as vendors,
       (select count(*) from buildings) as buildings,
       (select count(*) from packages) as packages,
       (select count(*) from packages where status in ('open','shortlisting')) as open_packages,
       (select count(*) from packages where status='awarded') as awards,
       (select count(*) from bids) as bids`,
  );
  const companies = await q<any>(
    `select id, kind, name, city, region, created_at from companies order by created_at desc limit 200`,
  );
  const packages = await q<any>(
    `select p.id, p.category, p.status, p.deadline, p.created_at, b.name as building,
       (select count(*) from bids bd where bd.package_id = p.id) as bid_count
       from packages p join buildings b on b.id = p.building_id
      order by p.created_at desc limit 100`,
  );
  const bids = await q<any>(
    `select bd.id, bd.price, bd.days, bd.status, bd.created_at,
            c.name as vendor, p.category, b.name as building
       from bids bd
       join companies c on c.id = bd.vendor_company_id
       join packages p on p.id = bd.package_id
       join buildings b on b.id = p.building_id
      order by bd.created_at desc limit 100`,
  );
  return { counts, companies, packages, bids };
}

// ===========================================================================
// SESSION MANAGEMENT (server-side revocation)
// ===========================================================================

/** Record a newly issued session so it can be revoked on logout. */
export async function createSession(
  jti: string,
  userId: string,
  email: string | null,
  ttlSeconds: number,
): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  await q(
    `insert into user_sessions (jti, user_id, email, expires_at)
     values ($1, $2, $3, $4)
     on conflict (jti) do nothing`,
    [jti, userId, email, expiresAt],
  );
}

/** Returns true when the session jti is still active (not revoked, not expired). */
export async function isSessionActive(jti: string): Promise<boolean> {
  const row = await q1(
    `select 1 from user_sessions where jti = $1 and expires_at > now()`,
    [jti],
  );
  return !!row;
}

/** Revoke a session (called on logout). */
export async function revokeSession(jti: string): Promise<void> {
  await q(`delete from user_sessions where jti = $1`, [jti]);
}

/** Revoke all sessions for a user (password change, account compromise). */
export async function revokeAllSessions(userId: string): Promise<void> {
  await q(`delete from user_sessions where user_id = $1`, [userId]);
}

/** Purge expired session rows (run periodically or at startup). */
export async function purgeExpiredSessions(): Promise<void> {
  await q(`delete from user_sessions where expires_at <= now()`);
}
