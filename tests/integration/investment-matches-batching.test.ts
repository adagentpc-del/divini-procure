/**
 * Platform hardening: GET /investment/programs/:id/matches and
 * GET /investor/matches each used to run 2 extra DB queries PER ROW in a
 * loop (investor preferences + qualification records; NDA-signed check +
 * developer trust score) over an UNBOUNDED, platform-wide result set - the
 * two most severe N+1s found in a hardening pass. Both are now batched to
 * a small fixed number of queries via Map lookups keyed by investor_id /
 * program_id / company_id.
 *
 * These tests exist specifically to catch the classic batching-refactor
 * bug: rows getting swapped/mixed when grouped into a Map. Data is seeded
 * directly (admin DB context) rather than via the full multi-step
 * program-submission/investor-onboarding HTTP workflow, since only the
 * read/scoring routes changed - the write-side workflow is untouched and
 * out of scope. scoreMatch()/computeTrust() themselves are pure and
 * untouched; only how their inputs are fetched changed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, type TestServer } from "./helpers/server.ts";
import { registerVerifiedUser, createCompany, type TestClient } from "./helpers/client.ts";

let server: TestServer;
let developer: { client: TestClient; email: string; userId: string };
let developerCompanyId: string;
let q: any;
let runWithRequestContext: any;

test.before(async () => {
  server = await startTestServer();
  developer = await registerVerifiedUser(server.baseUrl, "invbatch-dev");
  developerCompanyId = (await createCompany(developer.client, "buyer", "Invest Batching Dev Co")).id;

  const pool = await import("../../server/dist/pool.js");
  const ctx = await import("../../server/dist/lib/requestContext.js");
  q = pool.q;
  runWithRequestContext = ctx.runWithRequestContext;
});

test.after(async () => {
  await server.close();
});

async function asAdmin<T>(fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ userId: null, isAdmin: true, email: null }, fn);
}

test("GET /investment/programs/:id/matches: batched prefs/qualification data is never swapped between investors", async () => {
  const [program] = await asAdmin(() =>
    q(
      `insert into investment_programs (company_id, name, status, accredited_only, non_accredited_accepted)
       values ($1, 'Batching Test Program', 'active', false, true) returning *`,
      [developerCompanyId],
    ),
  );

  const [investorVerified] = await asAdmin(() =>
    q(`insert into investor_profiles (status, full_name) values ('approved', 'Verified Investor') returning *`, []),
  );
  const [investorPending] = await asAdmin(() =>
    q(`insert into investor_profiles (status, full_name) values ('approved', 'Pending Investor') returning *`, []),
  );
  await asAdmin(() =>
    q(
      `insert into investor_qualification_records (investor_id, kyc_status, accreditation_verification_status, nda_willing)
       values ($1, 'verified', 'verified', true)`,
      [investorVerified.id],
    ),
  );
  await asAdmin(() =>
    q(
      `insert into investor_qualification_records (investor_id, kyc_status, accreditation_verification_status, nda_willing)
       values ($1, 'pending', 'not_verified', false)`,
      [investorPending.id],
    ),
  );

  const res = await developer.client.get(`/api/investment/programs/${program.id}/matches`);
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const rowVerified = res.body.matches.find((m: any) => m.investor.id === investorVerified.id);
  const rowPending = res.body.matches.find((m: any) => m.investor.id === investorPending.id);
  assert.ok(rowVerified, "the verified investor must be present");
  assert.ok(rowPending, "the pending investor must be present");

  assert.equal(rowVerified.kycStatus, "verified");
  assert.equal(rowVerified.accreditation, "verified");
  assert.equal(rowVerified.ndaStatus, "willing");

  assert.equal(rowPending.kycStatus, "pending");
  assert.equal(rowPending.accreditation, "not_verified");
  assert.equal(rowPending.ndaStatus, "unknown");
});

test("GET /investor/matches: batched NDA-signed and trust-score data is never swapped between programs", async () => {
  const investorUser = await registerVerifiedUser(server.baseUrl, "invbatch-investor");
  const [investorProfile] = await asAdmin(() =>
    q(
      `insert into investor_profiles (user_id, status, full_name) values ($1, 'approved', 'Matches Test Investor') returning *`,
      [investorUser.userId],
    ),
  );

  const companyA = (await createCompany(developer.client, "buyer", "Invest Batching Company A")).id;
  const companyB = (await createCompany(developer.client, "buyer", "Invest Batching Company B")).id;

  const [programSigned] = await asAdmin(() =>
    q(
      `insert into investment_programs (company_id, name, status, accredited_only, non_accredited_accepted)
       values ($1, 'Signed NDA Program', 'active', false, true) returning *`,
      [companyA],
    ),
  );
  const [programUnsigned] = await asAdmin(() =>
    q(
      `insert into investment_programs (company_id, name, status, accredited_only, non_accredited_accepted)
       values ($1, 'Unsigned NDA Program', 'active', false, true) returning *`,
      [companyB],
    ),
  );

  await asAdmin(() =>
    q(`insert into nda_records (program_id, investor_id) values ($1, $2)`, [programSigned.id, investorProfile.id]),
  );

  await asAdmin(() =>
    q(
      `insert into developer_trust_profiles (company_id, years_operating, projects_completed)
       values ($1, 20, 50)`,
      [companyA],
    ),
  );
  await asAdmin(() =>
    q(
      `insert into developer_trust_profiles (company_id, years_operating, projects_completed)
       values ($1, 1, 0)`,
      [companyB],
    ),
  );

  const res = await investorUser.client.get(`/api/investor/matches`);
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const rowSigned = res.body.matches.find((m: any) => m.program.id === programSigned.id);
  const rowUnsigned = res.body.matches.find((m: any) => m.program.id === programUnsigned.id);
  assert.ok(rowSigned, "the NDA-signed program must be present");
  assert.ok(rowUnsigned, "the unsigned program must be present");

  assert.equal(rowSigned.canView, true, "a signed NDA must allow viewing this program");
  // The higher-trust company (20yrs/50 projects) must score strictly above
  // the near-empty one (1yr/0 projects) - proves trust data was not swapped.
  assert.ok(
    rowSigned.trustScore > rowUnsigned.trustScore,
    `expected companyA's richer trust profile to outscore companyB's (got signed=${rowSigned.trustScore}, unsigned=${rowUnsigned.trustScore})`,
  );
});
