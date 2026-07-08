/**
 * Divini Procure - DEVELOPER INVESTMENT + INVESTOR MATCHING routes.
 *
 * Mounted under /api in routes.ts. Additive; does not touch procurement.
 *
 * Two actor classes:
 *   - DEVELOPER ORG members (company_members of a kind='buyer' company): manage
 *     the org investment profile, seats, programs, documents, pipeline, and act
 *     on introduction requests.
 *   - INVESTORS (keyed by user_id, no company required): onboard a profile,
 *     browse open programs (filtered by visibility), see scored matches, sign
 *     NDAs, and request introductions.
 *   - ADMINS: review programs, review/approve investors, see queues.
 *
 * COMPLIANCE INVARIANTS enforced here:
 *   - Deterministic matching never verifies accreditation, approves investors,
 *     or publishes offerings. Those are admin/human actions.
 *   - Restricted program docs are never returned to ineligible investors.
 *   - Developer-internal fields (admin notes, compliance notes, created_by) are
 *     never returned to investors; investors only ever get a teaser shape.
 *   - Investor PII (email, phone, full legal name) is masked to developers
 *     until an introduction request is approved.
 *
 * Router convention: const h=(fn)=>(req,res,next)=>fn(req,res).catch(next).
 * Errors map via the shared errorHandler (ForbiddenError->403, NotFoundError->404).
 * Money is integer cents. Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser, requireAdmin } from "../auth.js";
import { ForbiddenError, NotFoundError } from "../db.js";
import { q, q1 } from "../pool.js";
import { sendEmail } from "../lib/email.js";
import { scoreMatch, canViewProgram } from "../lib/investor-match.js";
import { spend, earn, EARN } from "../lib/introCredits.js";
import { getTrustScore } from "../lib/trustScore.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function assertMember(userId: string, companyId: string): Promise<void> {
  const row = await q1(`select 1 from company_members where user_id = $1 and company_id = $2`, [
    userId,
    companyId,
  ]);
  if (!row) throw new ForbiddenError("not a member of this company");
}

/** True when the user is an owner/admin role member of the company. */
async function isOrgAdmin(userId: string, companyId: string): Promise<boolean> {
  const row = await q1<{ role: string }>(
    `select role from company_members where user_id = $1 and company_id = $2`,
    [userId, companyId],
  );
  if (!row) return false;
  return ["owner", "admin"].includes(String(row.role || "").toLowerCase());
}

async function audit(input: {
  userId: string | null;
  email: string | null;
  action: string;
  subjectType: string;
  subjectId: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  await q(
    `insert into investment_audit_log (actor_user_id, actor_email, action, subject_type, subject_id, detail)
     values ($1,$2,$3,$4,$5,$6)`,
    [
      input.userId,
      input.email,
      input.action,
      input.subjectType,
      input.subjectId,
      JSON.stringify(input.detail ?? {}),
    ],
  );
}

async function ensureEntitlement(companyId: string): Promise<void> {
  await q(
    `insert into subscription_entitlements (company_id, investment_profile)
     values ($1, true)
     on conflict (company_id) do update set investment_profile = true, updated_at = now()`,
    [companyId],
  );
}

async function getEntitlement(companyId: string) {
  return q1(`select * from subscription_entitlements where company_id = $1`, [companyId]);
}

/** Load the caller's investor profile (or null). */
async function myInvestor(userId: string) {
  return q1<any>(`select * from investor_profiles where user_id = $1`, [userId]);
}

async function investorPrefs(investorId: string) {
  return q1<any>(`select * from investor_preferences where investor_id = $1`, [investorId]);
}

async function investorQual(investorId: string) {
  return q1<any>(`select * from investor_qualification_records where investor_id = $1`, [investorId]);
}

async function hasSignedNda(programId: string, investorId: string): Promise<boolean> {
  const row = await q1(`select 1 from nda_records where program_id = $1 and investor_id = $2 limit 1`, [
    programId,
    investorId,
  ]);
  return !!row;
}

/** Strip a program row down to the investor-facing teaser (no internal fields). */
function programTeaser(p: any) {
  return {
    id: p.id,
    name: p.name,
    program_type: p.program_type,
    asset_class: p.asset_class,
    location: p.location,
    project_stage: p.project_stage,
    target_raise_cents: p.target_raise_cents,
    min_investment_cents: p.min_investment_cents,
    max_investment_cents: p.max_investment_cents,
    investor_type_accepted: p.investor_type_accepted,
    accredited_only: p.accredited_only,
    non_accredited_accepted: p.non_accredited_accepted,
    offering_type: p.offering_type,
    investment_vehicle: p.investment_vehicle,
    projected_return: p.projected_return,
    preferred_return: p.preferred_return,
    equity_multiple: p.equity_multiple,
    irr_target: p.irr_target,
    hold_period: p.hold_period,
    distribution_schedule: p.distribution_schedule,
    risk_level: p.risk_level,
    visibility: p.visibility,
    status: p.status,
    nda_required: p.nda_required,
    kyc_required: p.kyc_required,
    proof_of_funds_required: p.proof_of_funds_required,
  };
}

/** Safe investor view for developers BEFORE intro approval (PII masked). */
function investorSafe(profile: any, qual: any, opts: { reveal: boolean }) {
  const base = {
    id: profile.id,
    investor_type: profile.investor_type,
    entity_type: profile.entity_type,
    location: profile.location,
    accreditation_status: profile.accreditation_status,
    access_level: profile.access_level,
    admin_review_status: profile.admin_review_status,
    ndaStatus: qual?.nda_willing ? "willing" : "unknown",
    kycStatus: qual?.kyc_status ?? "not_started",
    accreditation: qual?.accreditation_verification_status ?? "not_verified",
  };
  if (!opts.reveal) {
    // Mask PII: show only a redacted display name, no email/phone.
    return {
      ...base,
      display_name: profile.entity_name || "Investor",
      email: null,
      phone: null,
      pii_masked: true,
    };
  }
  return {
    ...base,
    display_name: profile.entity_name || profile.full_name || "Investor",
    full_name: profile.full_name,
    entity_name: profile.entity_name,
    email: profile.email,
    phone: profile.phone,
    website: profile.website,
    pii_masked: false,
  };
}

/** Confirm the caller may act on a program (member of owning company OR admin). */
async function loadProgramForMember(userId: string, isAdmin: boolean, programId: string) {
  const program = await q1<any>(`select * from investment_programs where id = $1`, [programId]);
  if (!program) throw new NotFoundError("program not found");
  if (!isAdmin) await assertMember(userId, program.company_id);
  return program;
}

// ===========================================================================
// DEV ORG / SEATS / PROFILE
// ===========================================================================

router.get(
  "/dev-org",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = String(req.query.companyId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    await assertMember(auth.userId!, companyId);
    const org = await q1<any>(`select id, name from companies where id = $1`, [companyId]);
    if (!org) throw new NotFoundError("organization not found");
    const investmentProfile = await q1(
      `select * from developer_investment_profiles where company_id = $1`,
      [companyId],
    );
    const seats = await q(
      `select * from developer_seats where organization_company_id = $1 order by created_at`,
      [companyId],
    );
    const entitlement = await getEntitlement(companyId);
    res.json({ org, investmentProfile: investmentProfile ?? null, seats, entitlement: entitlement ?? null });
  }),
);

router.post(
  "/dev-org/investment-profile",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const companyId = String(b.companyId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    await assertMember(auth.userId!, companyId);
    await ensureEntitlement(companyId);

    // Whitelist updatable fields (never status/admin_review from here).
    const cols = [
      "investment_contact_name",
      "investment_contact_email",
      "investment_contact_phone",
      "capital_raising_status",
      "open_to_investors",
      "accredited_accepted",
      "non_accredited_accepted",
      "min_investment_cents",
      "max_investment_cents",
      "preferred_investor_type",
      "target_raise_cents",
      "capital_stack",
      "offering_type",
      "investment_structure",
      "target_returns",
      "hold_period",
      "distribution_schedule",
      "risk_level",
      "markets",
      "asset_classes",
      "track_record",
      "nda_required",
      "accreditation_required",
      "kyc_required",
      "qualification_requirements",
      "compliance_notes",
    ];
    const camel = (c: string) => c.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase());
    const setVals: Record<string, unknown> = {};
    for (const c of cols) {
      const key = camel(c);
      if (b[key] !== undefined) setVals[c] = b[key];
      else if (b[c] !== undefined) setVals[c] = b[c];
    }

    const existing = await q1<any>(
      `select id from developer_investment_profiles where company_id = $1`,
      [companyId],
    );

    if (!existing) {
      const insertCols = ["company_id", "created_by", ...Object.keys(setVals)];
      const params: unknown[] = [companyId, auth.userId, ...Object.values(setVals)];
      const placeholders = insertCols.map((_c, i) => `$${i + 1}`);
      const row = await q1<any>(
        `insert into developer_investment_profiles (${insertCols.join(",")})
         values (${placeholders.join(",")}) returning *`,
        params,
      );
      await audit({
        userId: auth.userId,
        email: auth.email,
        action: "investment_profile_created",
        subjectType: "developer_investment_profile",
        subjectId: row!.id,
        detail: { companyId },
      });
      return res.status(201).json({ investmentProfile: row });
    }

    const keys = Object.keys(setVals);
    if (keys.length === 0) {
      const row = await q1(`select * from developer_investment_profiles where company_id = $1`, [companyId]);
      return res.json({ investmentProfile: row });
    }
    const assignments = keys.map((c, i) => `${c} = $${i + 2}`);
    const row = await q1<any>(
      `update developer_investment_profiles set ${assignments.join(",")}, updated_at = now()
       where company_id = $1 returning *`,
      [companyId, ...keys.map((k) => setVals[k])],
    );
    await audit({
      userId: auth.userId,
      email: auth.email,
      action: "investment_profile_updated",
      subjectType: "developer_investment_profile",
      subjectId: row!.id,
      detail: { companyId, fields: keys },
    });
    res.json({ investmentProfile: row });
  }),
);

router.post(
  "/dev-org/investment-profile/submit",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = String((req.body ?? {}).companyId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    await assertMember(auth.userId!, companyId);
    const row = await q1<any>(
      `update developer_investment_profiles
         set status = 'submitted_for_review', admin_review_status = 'pending_review', updated_at = now()
       where company_id = $1 returning *`,
      [companyId],
    );
    if (!row) throw new NotFoundError("investment profile not found; create it first");
    await audit({
      userId: auth.userId,
      email: auth.email,
      action: "investment_profile_submitted",
      subjectType: "developer_investment_profile",
      subjectId: row.id,
      detail: { companyId },
    });
    res.json({ investmentProfile: row });
  }),
);

router.get(
  "/dev-org/seats",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = String(req.query.companyId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    await assertMember(auth.userId!, companyId);
    const seats = await q(
      `select * from developer_seats where organization_company_id = $1 order by created_at`,
      [companyId],
    );
    res.json({ seats });
  }),
);

router.post(
  "/dev-org/seats",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const companyId = String(b.companyId || "");
    const email = String(b.email || "").trim().toLowerCase();
    const seatType = String(b.seatType || "");
    if (!companyId || !email || !seatType) {
      return res.status(400).json({ error: "companyId, email, seatType required" });
    }
    const valid = [
      "developer_procurement_seat",
      "developer_investment_seat",
      "developer_admin_seat",
    ];
    if (!valid.includes(seatType)) {
      return res.status(400).json({ error: "invalid seatType" });
    }
    await assertMember(auth.userId!, companyId);
    if (!(await isOrgAdmin(auth.userId!, companyId)) && !auth.isAdmin) {
      throw new ForbiddenError("only an org owner/admin may add seats");
    }
    const row = await q1<any>(
      `insert into developer_seats (organization_company_id, email, seat_type, permissions, invited_by)
       values ($1,$2,$3,$4,$5)
       on conflict (organization_company_id, email, seat_type)
         do update set status = 'active', updated_at = now()
       returning *`,
      [companyId, email, seatType, JSON.stringify(b.permissions ?? {}), auth.userId],
    );
    await audit({
      userId: auth.userId,
      email: auth.email,
      action: "seat_added",
      subjectType: "developer_seat",
      subjectId: row!.id,
      detail: { companyId, email, seatType },
    });
    res.status(201).json({ seat: row });
  }),
);

// ===========================================================================
// PROGRAMS (developer side)
// ===========================================================================

router.get(
  "/investment/programs",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyId = String(req.query.companyId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    await assertMember(auth.userId!, companyId);
    const programs = await q(
      `select * from investment_programs where company_id = $1 order by created_at desc`,
      [companyId],
    );
    res.json({ programs });
  }),
);

router.post(
  "/investment/programs",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const companyId = String(b.companyId || "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    await assertMember(auth.userId!, companyId);
    await ensureEntitlement(companyId);

    const cols = [
      "project_id",
      "name",
      "program_type",
      "asset_class",
      "location",
      "project_stage",
      "target_raise_cents",
      "min_investment_cents",
      "max_investment_cents",
      "investor_type_accepted",
      "accredited_only",
      "non_accredited_accepted",
      "offering_type",
      "investment_vehicle",
      "projected_return",
      "preferred_return",
      "equity_multiple",
      "irr_target",
      "hold_period",
      "distribution_schedule",
      "use_of_funds",
      "capital_stack",
      "risk_level",
      "exit_strategy",
      "qualification_requirements",
      "nda_required",
      "kyc_required",
      "proof_of_funds_required",
      "visibility",
    ];
    const camel = (c: string) => c.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase());
    const setVals: Record<string, unknown> = {};
    for (const c of cols) {
      const key = camel(c);
      if (b[key] !== undefined) setVals[c] = b[key];
      else if (b[c] !== undefined) setVals[c] = b[c];
    }
    const insertCols = ["company_id", "created_by", ...Object.keys(setVals)];
    const params: unknown[] = [companyId, auth.userId, ...Object.values(setVals)];
    const placeholders = insertCols.map((_c, i) => `$${i + 1}`);
    const row = await q1<any>(
      `insert into investment_programs (${insertCols.join(",")})
       values (${placeholders.join(",")}) returning *`,
      params,
    );
    await audit({
      userId: auth.userId,
      email: auth.email,
      action: "program_created",
      subjectType: "investment_program",
      subjectId: row!.id,
      detail: { companyId },
    });
    res.status(201).json({ program: row });
  }),
);

router.get(
  "/investment/programs/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const program = await q1<any>(`select * from investment_programs where id = $1`, [req.params.id]);
    if (!program) throw new NotFoundError("program not found");

    // Member of owning company OR admin gets the full row.
    const member = await q1(`select 1 from company_members where user_id = $1 and company_id = $2`, [
      auth.userId,
      program.company_id,
    ]);
    if (member || auth.isAdmin) {
      return res.json({ program, full: true });
    }

    // Record a prospective-investor view (non-member). Powers the Developer Pro
    // "who viewed my raise" analytic. Fire-and-forget; never blocks the response.
    await q(`insert into program_views (program_id, viewer_user_id) values ($1,$2)`, [program.id, auth.userId]).catch(() => null);

    // Otherwise treat the caller as an investor: teaser only, gated by canView.
    const investor = await myInvestor(auth.userId!);
    const signed = investor ? await hasSignedNda(program.id, investor.id) : false;
    const canView = canViewProgram(program, investor, { hasSignedNda: signed });
    if (!canView) {
      // Still allow the public teaser if the program is public_teaser+listed.
      if (
        ["approved", "active"].includes(String(program.status)) &&
        String(program.visibility) === "public_teaser"
      ) {
        return res.json({ program: programTeaser(program), full: false, canView: true });
      }
      throw new ForbiddenError("not eligible to view this program");
    }
    res.json({ program: programTeaser(program), full: false, canView: true });
  }),
);

// "Who viewed my raise" - Developer Pro analytic. Aggregate only (never reveals
// investor identities; investors are private by default). Free tier sees the
// headline counts as an upsell; the recent-activity timeline is gated on the
// company's reporting_access entitlement (Developer Pro+).
router.get(
  "/investment/programs/:id/views",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const program = await q1<any>(`select id, company_id from investment_programs where id = $1`, [req.params.id]);
    if (!program) throw new NotFoundError("program not found");
    if (!auth.isAdmin) await assertMember(auth.userId!, program.company_id);
    const totals = await q1<{ views: string | number; unique_viewers: string | number }>(
      `select count(*) as views, count(distinct viewer_user_id) as unique_viewers from program_views where program_id = $1`,
      [program.id],
    );
    const ent = (await getEntitlement(program.company_id)) as { reporting_access?: boolean } | null;
    const unlocked = auth.isAdmin || ent?.reporting_access === true;
    const base = {
      views: Number(totals?.views ?? 0),
      uniqueViewers: Number(totals?.unique_viewers ?? 0),
      unlocked,
    };
    if (!unlocked) return res.json(base);
    const recent = await q<{ viewed_at: string }>(
      `select viewed_at from program_views where program_id = $1 order by viewed_at desc limit 25`,
      [program.id],
    );
    res.json({ ...base, recent });
  }),
);

router.patch(
  "/investment/programs/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const program = await loadProgramForMember(auth.userId!, auth.isAdmin, req.params.id);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const cols = [
      "project_id",
      "name",
      "program_type",
      "asset_class",
      "location",
      "project_stage",
      "target_raise_cents",
      "min_investment_cents",
      "max_investment_cents",
      "investor_type_accepted",
      "accredited_only",
      "non_accredited_accepted",
      "offering_type",
      "investment_vehicle",
      "projected_return",
      "preferred_return",
      "equity_multiple",
      "irr_target",
      "hold_period",
      "distribution_schedule",
      "use_of_funds",
      "capital_stack",
      "risk_level",
      "exit_strategy",
      "qualification_requirements",
      "nda_required",
      "kyc_required",
      "proof_of_funds_required",
      "visibility",
    ];
    const camel = (c: string) => c.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase());
    const setVals: Record<string, unknown> = {};
    for (const c of cols) {
      const key = camel(c);
      if (b[key] !== undefined) setVals[c] = b[key];
      else if (b[c] !== undefined) setVals[c] = b[c];
    }
    const keys = Object.keys(setVals);
    if (keys.length === 0) return res.json({ program });
    const assignments = keys.map((c, i) => `${c} = $${i + 2}`);
    const row = await q1<any>(
      `update investment_programs set ${assignments.join(",")}, updated_at = now()
       where id = $1 returning *`,
      [program.id, ...keys.map((k) => setVals[k])],
    );
    await audit({
      userId: auth.userId,
      email: auth.email,
      action: "program_updated",
      subjectType: "investment_program",
      subjectId: program.id,
      detail: { fields: keys },
    });
    res.json({ program: row });
  }),
);

router.post(
  "/investment/programs/:id/submit",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const program = await loadProgramForMember(auth.userId!, auth.isAdmin, req.params.id);
    const row = await q1<any>(
      `update investment_programs
         set status = 'submitted_for_review', admin_review_status = 'pending_review', updated_at = now()
       where id = $1 returning *`,
      [program.id],
    );
    await audit({
      userId: auth.userId,
      email: auth.email,
      action: "program_submitted",
      subjectType: "investment_program",
      subjectId: program.id,
    });
    res.json({ program: row });
  }),
);

router.post(
  "/investment/programs/:id/documents",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const program = await loadProgramForMember(auth.userId!, auth.isAdmin, req.params.id);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const docType = String(b.docType || "other");
    if (!["deck", "offering_memo", "track_record", "other"].includes(docType)) {
      return res.status(400).json({ error: "invalid docType" });
    }
    const url = b.url ? String(b.url) : null;
    if (!url) return res.status(400).json({ error: "url required" });
    const row = await q1<any>(
      `insert into offering_documents
         (program_id, company_id, doc_type, title, url, nda_gated, accredited_only, uploaded_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [
        program.id,
        program.company_id,
        docType,
        b.title ? String(b.title) : null,
        url,
        b.ndaGated === true || b.nda_gated === true,
        b.accreditedOnly === true || b.accredited_only === true,
        auth.userId,
      ],
    );
    await audit({
      userId: auth.userId,
      email: auth.email,
      action: "offering_document_added",
      subjectType: "offering_document",
      subjectId: row!.id,
      detail: { programId: program.id, docType },
    });
    res.status(201).json({ document: row });
  }),
);

router.get(
  "/investment/programs/:id/documents",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const program = await q1<any>(`select * from investment_programs where id = $1`, [req.params.id]);
    if (!program) throw new NotFoundError("program not found");
    const member = await q1(`select 1 from company_members where user_id = $1 and company_id = $2`, [
      auth.userId,
      program.company_id,
    ]);
    const allDocs = await q<any>(
      `select * from offering_documents where program_id = $1 order by created_at`,
      [program.id],
    );
    if (member || auth.isAdmin) {
      return res.json({ documents: allDocs });
    }
    // Investor: only docs they are eligible for.
    const investor = await myInvestor(auth.userId!);
    const signed = investor ? await hasSignedNda(program.id, investor.id) : false;
    if (!investor || !canViewProgram(program, investor, { hasSignedNda: signed })) {
      throw new ForbiddenError("not eligible to view program documents");
    }
    const qual = investor ? await investorQual(investor.id) : null;
    const accredited =
      ["accredited", "verified", "qualified_purchaser"].includes(
        String(investor.accreditation_status || "").toLowerCase(),
      ) || String(qual?.accredited || "").toLowerCase() === "yes";
    const visible = allDocs.filter((d) => {
      if (d.nda_gated && !signed) return false;
      if (d.accredited_only && !accredited) return false;
      return true;
    });
    res.json({ documents: visible });
  }),
);

router.post(
  "/admin/investment/programs/:id/review",
  requireAdmin,
  h(async (req, res) => {
    const auth = getAuth(req);
    const { decision, notes } = (req.body ?? {}) as Record<string, unknown>;
    if (!["approve", "reject", "needs_edits"].includes(String(decision))) {
      return res.status(400).json({ error: "decision must be approve | reject | needs_edits" });
    }
    const program = await q1<any>(`select * from investment_programs where id = $1`, [req.params.id]);
    if (!program) throw new NotFoundError("program not found");
    const nextStatus =
      decision === "approve" ? "active" : decision === "reject" ? "rejected" : "needs_edits";
    const reviewStatus =
      decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "needs_edits";
    const row = await q1<any>(
      `update investment_programs
         set status = $2, admin_review_status = $3, admin_notes = $4, updated_at = now()
       where id = $1 returning *`,
      [program.id, nextStatus, reviewStatus, notes ? String(notes) : program.admin_notes],
    );
    await audit({
      userId: auth.userId,
      email: auth.email,
      action: "program_reviewed",
      subjectType: "investment_program",
      subjectId: program.id,
      detail: { decision, nextStatus },
    });
    // Best-effort notify the developer's investment contact when the program goes live.
    if (String(decision) === "approve") {
      try {
        const devProfile = await q1<{ investment_contact_email: string }>(
          `select investment_contact_email from developer_investment_profiles where company_id = $1`,
          [program.company_id],
        );
        if (devProfile?.investment_contact_email) {
          await sendEmail({
            to: devProfile.investment_contact_email,
            subject: "Your investment program is live",
            text: `Your program "${program.name || program.id}" has been reviewed and approved. It is now visible to qualified investors on Divini Procure. Log in to your dashboard to manage matches and introduction requests.`,
          });
        }
      } catch {
        // ignore email errors
      }
    }
    res.json({ program: row });
  }),
);

// Public unauthenticated browse endpoint - no auth required.
router.get(
  "/investment/public-opportunities",
  h(async (req, res) => {
    const { assetClass, location, minInvestment, investorType } = req.query as Record<string, string | undefined>;

    // Build dynamic WHERE clauses
    const conditions: string[] = [
      `p.status IN ('approved','active')`,
      `p.visibility IN ('public_teaser','approved_investor_preview','non_accredited_program')`,
    ];
    const params: unknown[] = [];

    if (assetClass) {
      params.push(assetClass);
      conditions.push(`p.asset_class = $${params.length}`);
    }
    if (location) {
      params.push(`%${location}%`);
      conditions.push(`p.location ilike $${params.length}`);
    }
    if (minInvestment) {
      const cents = Math.round(parseFloat(minInvestment) * 100);
      if (!isNaN(cents)) {
        params.push(cents);
        conditions.push(`p.min_investment_cents <= $${params.length}`);
      }
    }
    if (investorType) {
      params.push(investorType);
      conditions.push(`p.investor_type_accepted = $${params.length}`);
    }

    const where = conditions.join(" AND ");
    const rows = await q<any>(
      `select p.*,
              c.name as developer_name,
              dpp.bio, dpp.markets, dpp.asset_classes as developer_asset_classes,
              dpp.completed_projects
         from investment_programs p
         join companies c on c.id = p.company_id
         left join developer_public_profiles dpp on dpp.company_id = p.company_id
        where ${where}
        order by p.created_at desc`,
      params,
    );

    const programs = rows.map((p: any) => ({
      ...programTeaser(p),
      developer_name: p.developer_name ?? null,
      developer_bio: p.bio ?? null,
      developer_markets: p.markets ?? null,
      developer_asset_classes: p.developer_asset_classes ?? null,
      developer_completed_projects: p.completed_projects ?? null,
    }));

    res.json({ programs, total: programs.length });
  }),
);

// Investor-facing list of open programs (filtered by canViewProgram).
router.get(
  "/investment/open",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const investor = await myInvestor(auth.userId!);
    const programs = await q<any>(
      `select * from investment_programs
        where status in ('approved','active')
        order by created_at desc`,
    );
    const out: any[] = [];
    for (const p of programs) {
      const signed = investor ? await hasSignedNda(p.id, investor.id) : false;
      if (canViewProgram(p, investor, { hasSignedNda: signed })) {
        out.push(programTeaser(p));
      }
    }
    res.json({ programs: out });
  }),
);

// ===========================================================================
// INVESTOR
// ===========================================================================

router.get(
  "/investor/me",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const profile = await myInvestor(auth.userId!);
    if (!profile) return res.json(null);
    const preferences = await investorPrefs(profile.id);
    const qualification = await investorQual(profile.id);
    res.json({
      profile,
      preferences: preferences ?? null,
      qualification: qualification ?? null,
      accessLevel: profile.access_level,
    });
  }),
);

router.post(
  "/investor/onboard",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const b = (req.body ?? {}) as Record<string, unknown>;

    // --- upsert profile (keyed by user_id) ---
    const profileCols = [
      "full_name",
      "entity_name",
      "email",
      "phone",
      "location",
      "investor_type",
      "accreditation_status",
      "entity_type",
      "website",
      "preferred_contact",
      "visibility",
      "quiet_mode",
    ];
    const camel = (c: string) => c.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase());
    const pVals: Record<string, unknown> = {};
    for (const c of profileCols) {
      const key = camel(c);
      if (b[key] !== undefined) pVals[c] = b[key];
      else if (b[c] !== undefined) pVals[c] = b[c];
    }
    // Default email to the authed email if not supplied.
    if (pVals.email === undefined && auth.email) pVals.email = auth.email;

    let profile = await myInvestor(auth.userId!);
    if (!profile) {
      const insertCols = ["user_id", ...Object.keys(pVals)];
      const params: unknown[] = [auth.userId, ...Object.values(pVals)];
      const placeholders = insertCols.map((_c, i) => `$${i + 1}`);
      profile = await q1<any>(
        `insert into investor_profiles (${insertCols.join(",")})
         values (${placeholders.join(",")}) returning *`,
        params,
      );
    } else {
      const keys = Object.keys(pVals);
      if (keys.length > 0) {
        const assignments = keys.map((c, i) => `${c} = $${i + 2}`);
        profile = await q1<any>(
          `update investor_profiles set ${assignments.join(",")}, updated_at = now()
           where user_id = $1 returning *`,
          [auth.userId, ...keys.map((k) => pVals[k])],
        );
      }
    }

    // Completing an investor profile is a marketplace-healthy behavior -> earn intro credits once.
    await earn("investor", auth.userId!, EARN.profile_complete, "profile_complete", { oncePerReason: true });

    // --- upsert preferences ---
    const prefIn = (b.preferences ?? b.prefs ?? {}) as Record<string, unknown>;
    const prefCols = [
      "asset_classes",
      "markets",
      "min_investment_cents",
      "max_investment_cents",
      "total_allocation_cents",
      "preferred_deal_size_cents",
      "preferred_hold_period",
      "target_return",
      "risk_tolerance",
      "income_vs_growth",
      "liquidity_preference",
      "preferred_structure",
      "deal_types",
    ];
    const prefVals: Record<string, unknown> = {};
    for (const c of prefCols) {
      const key = camel(c);
      if (prefIn[key] !== undefined) prefVals[c] = prefIn[key];
      else if (prefIn[c] !== undefined) prefVals[c] = prefIn[c];
    }
    if (Object.keys(prefVals).length > 0) {
      const existingPref = await investorPrefs(profile!.id);
      if (!existingPref) {
        const insertCols = ["investor_id", ...Object.keys(prefVals)];
        const params: unknown[] = [profile!.id, ...Object.values(prefVals)];
        const placeholders = insertCols.map((_c, i) => `$${i + 1}`);
        await q(
          `insert into investor_preferences (${insertCols.join(",")})
           values (${placeholders.join(",")})`,
          params,
        );
      } else {
        const keys = Object.keys(prefVals);
        const assignments = keys.map((c, i) => `${c} = $${i + 2}`);
        await q(
          `update investor_preferences set ${assignments.join(",")}, updated_at = now()
           where investor_id = $1`,
          [profile!.id, ...keys.map((k) => prefVals[k])],
        );
      }
    } else {
      // Ensure a prefs row exists.
      await q(
        `insert into investor_preferences (investor_id) values ($1)
         on conflict (investor_id) do nothing`,
        [profile!.id],
      );
    }

    // --- upsert qualification (self-reported only; AI/route never verifies) ---
    const qualIn = (b.qualification ?? b.qual ?? {}) as Record<string, unknown>;
    const qualCols = [
      "accredited",
      "non_accredited",
      "qualified_purchaser",
      "family_office",
      "proof_of_funds",
      "kyc_completed",
      "nda_willing",
      "can_review_private",
      "education_interest",
      "investment_experience",
      "jurisdiction",
      "suitability_notes",
    ];
    const qualVals: Record<string, unknown> = {};
    for (const c of qualCols) {
      const key = camel(c);
      if (qualIn[key] !== undefined) qualVals[c] = qualIn[key];
      else if (qualIn[c] !== undefined) qualVals[c] = qualIn[c];
    }
    const existingQual = await investorQual(profile!.id);
    if (!existingQual) {
      const insertCols = ["investor_id", ...Object.keys(qualVals)];
      const params: unknown[] = [profile!.id, ...Object.values(qualVals)];
      const placeholders = insertCols.map((_c, i) => `$${i + 1}`);
      await q(
        `insert into investor_qualification_records (${insertCols.join(",")})
         values (${placeholders.join(",")})`,
        params,
      );
    } else if (Object.keys(qualVals).length > 0) {
      const keys = Object.keys(qualVals);
      const assignments = keys.map((c, i) => `${c} = $${i + 2}`);
      await q(
        `update investor_qualification_records set ${assignments.join(",")}, updated_at = now()
         where investor_id = $1`,
        [profile!.id, ...keys.map((k) => qualVals[k])],
      );
    }

    // --- progress status (self-reported completeness only; not approval) ---
    const hasPrefs = Object.keys(prefVals).length > 0;
    const hasQual = Object.keys(qualVals).length > 0;
    const nextStatus = hasPrefs && hasQual ? "profile_complete" : "in_progress";
    profile = await q1<any>(
      `update investor_profiles set status = $2, updated_at = now()
       where id = $1 returning *`,
      [profile!.id, nextStatus],
    );

    await audit({
      userId: auth.userId,
      email: auth.email,
      action: "investor_onboarded",
      subjectType: "investor_profile",
      subjectId: profile!.id,
      detail: { status: nextStatus },
    });

    const preferences = await investorPrefs(profile!.id);
    const qualification = await investorQual(profile!.id);
    res.json({ profile, preferences, qualification, accessLevel: profile!.access_level });
  }),
);

router.post(
  "/investor/documents",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const profile = await myInvestor(auth.userId!);
    if (!profile) throw new NotFoundError("create an investor profile first");
    const b = (req.body ?? {}) as Record<string, unknown>;
    const url = b.url ? String(b.url) : null;
    if (!url) return res.status(400).json({ error: "url required" });
    const row = await q1<any>(
      `insert into investor_documents (investor_id, doc_type, url) values ($1,$2,$3) returning *`,
      [profile.id, b.docType ? String(b.docType) : "other", url],
    );
    await audit({
      userId: auth.userId,
      email: auth.email,
      action: "investor_document_added",
      subjectType: "investor_document",
      subjectId: row!.id,
      detail: { docType: b.docType ?? "other" },
    });
    res.status(201).json({ document: row });
  }),
);

router.post(
  "/investor/nda/:programId/sign",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const profile = await myInvestor(auth.userId!);
    if (!profile) throw new NotFoundError("create an investor profile first");
    const program = await q1<any>(`select id from investment_programs where id = $1`, [
      req.params.programId,
    ]);
    if (!program) throw new NotFoundError("program not found");
    const signerName = String((req.body ?? {}).signerName || "").trim();
    if (!signerName) return res.status(400).json({ error: "signerName required" });
    const ip =
      (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || null;
    const row = await q1<any>(
      `insert into nda_records (program_id, investor_id, signer_name, ip, audit)
       values ($1,$2,$3,$4,$5) returning *`,
      [
        program.id,
        profile.id,
        signerName,
        ip,
        JSON.stringify({ user_id: auth.userId, email: auth.email, at: new Date().toISOString() }),
      ],
    );
    await audit({
      userId: auth.userId,
      email: auth.email,
      action: "nda_signed",
      subjectType: "nda_record",
      subjectId: row!.id,
      detail: { programId: program.id, investorId: profile.id },
    });
    res.status(201).json({ nda: row });
  }),
);

// ===========================================================================
// MATCH / INTRO / PIPELINE
// ===========================================================================

router.get(
  "/investor/matches",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const investor = await myInvestor(auth.userId!);
    if (!investor) return res.json({ matches: [] });
    if (investor.quiet_mode) {
      // Family-office quiet mode: return a digest count, not a browsable list.
      const prefsQ = await investorPrefs(investor.id);
      const qualQ = await investorQual(investor.id);
      const progsQ = await q<any>(
        `select * from investment_programs where status in ('approved','active')`,
      );
      let fit = 0;
      for (const p of progsQ) {
        const { score } = scoreMatch(p, investor, prefsQ, qualQ);
        if (score >= 55) fit += 1;
      }
      return res.json({ quiet: true, digestCount: fit, matches: [] });
    }
    const prefs = await investorPrefs(investor.id);
    const qual = await investorQual(investor.id);
    const programs = await q<any>(
      `select * from investment_programs where status in ('approved','active') order by created_at desc`,
    );
    const matches = [];
    for (const p of programs) {
      const signed = await hasSignedNda(p.id, investor.id);
      const canView = canViewProgram(p, investor, { hasSignedNda: signed });
      const { score, label, eligibility } = scoreMatch(p, investor, prefs, qual);
      const reasons = Array.isArray(eligibility) ? eligibility.slice(0, 4) : undefined;
      const t = await getTrustScore(p.company_id);
      matches.push({
        program: programTeaser(p), score, label, eligibility, reasons, canView,
        trustScore: t.score, trustBand: t.band,
      });
    }
    matches.sort((a, b) => b.score - a.score);
    res.json({ matches });
  }),
);

router.get(
  "/investment/programs/:id/matches",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const program = await loadProgramForMember(auth.userId!, auth.isAdmin, req.params.id);

    // Approved intros for this program (controls PII reveal per investor).
    const approvedRows = await q<{ investor_id: string }>(
      `select investor_id from investor_introduction_requests
        where program_id = $1 and status in ('approved','intro_made')`,
      [program.id],
    );
    const approvedSet = new Set(approvedRows.map((r) => r.investor_id));

    const investors = await q<any>(
      `select * from investor_profiles
        where status in ('profile_complete','in_progress','approved','starter_profile')`,
    );
    const out = [];
    for (const inv of investors) {
      const prefs = await investorPrefs(inv.id);
      const qual = await investorQual(inv.id);
      const { score, label, eligibility } = scoreMatch(program, inv, prefs, qual);
      if (score < 40) continue; // surface plausible matches only
      const reveal = approvedSet.has(inv.id) || auth.isAdmin;
      out.push({
        investor: investorSafe(inv, qual, { reveal }),
        score,
        label,
        eligibility,
        ndaStatus: qual?.nda_willing ? "willing" : "unknown",
        kycStatus: qual?.kyc_status ?? "not_started",
        accreditation: qual?.accreditation_verification_status ?? "not_verified",
      });
    }
    out.sort((a, b) => b.score - a.score);
    res.json({ matches: out });
  }),
);

// Investor privacy / family-office quiet mode.
router.patch(
  "/investor/privacy",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const profile = await myInvestor(auth.userId!);
    if (!profile) throw new NotFoundError("create an investor profile first");
    const b = (req.body ?? {}) as Record<string, unknown>;
    const quiet = b.quiet_mode === true || b.quietMode === true;
    // Quiet mode implies private visibility; otherwise honor an explicit choice.
    const visibility =
      typeof b.visibility === "string" ? String(b.visibility) : quiet ? "private" : "discoverable";
    const row = await q1<any>(
      `update investor_profiles set quiet_mode = $2, visibility = $3, updated_at = now()
       where user_id = $1 returning quiet_mode, visibility`,
      [auth.userId, quiet, visibility],
    );
    res.json({ privacy: row });
  }),
);

router.post(
  "/investor/introductions",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const profile = await myInvestor(auth.userId!);
    if (!profile) throw new NotFoundError("create an investor profile first");
    const programId = String((req.body ?? {}).programId || "");
    if (!programId) return res.status(400).json({ error: "programId required" });
    const program = await q1<any>(`select * from investment_programs where id = $1`, [programId]);
    if (!program) throw new NotFoundError("program not found");
    // Investor must be able to view the program to request an intro.
    const signed = await hasSignedNda(program.id, profile.id);
    if (!canViewProgram(program, profile, { hasSignedNda: signed })) {
      throw new ForbiddenError("not eligible to request an introduction to this program");
    }
    // An introduction is the scarce, valued action: spend one Intro Credit.
    // No-op / always-allowed until PROCURE_INTRO_CREDITS metering is enabled, and
    // never charges twice for the same program (already-requested is idempotent).
    const alreadyRequested = await q1<{ id: string }>(
      `select id from investor_introduction_requests where program_id = $1 and investor_id = $2`,
      [program.id, profile.id],
    );
    if (!alreadyRequested) {
      const paid = await spend("investor", auth.userId!, 1, "intro_request", program.id);
      if (!paid.ok) {
        return res.status(402).json({
          error: "You are out of intro credits for now. Complete your profile or refer a peer to earn more, or they refresh next month.",
          reason: paid.reason,
          balance: paid.balance,
        });
      }
    }
    const row = await q1<any>(
      `insert into investor_introduction_requests (program_id, investor_id, status, pipeline_status)
       values ($1,$2,'requested','matched')
       on conflict (program_id, investor_id) do update set updated_at = now()
       returning *`,
      [program.id, profile.id],
    );
    await audit({
      userId: auth.userId,
      email: auth.email,
      action: "introduction_requested",
      subjectType: "introduction_request",
      subjectId: row!.id,
      detail: { programId: program.id, investorId: profile.id },
    });
    // Best-effort notify the developer org contact (email optional).
    const devProfile = await q1<any>(
      `select investment_contact_email from developer_investment_profiles where company_id = $1`,
      [program.company_id],
    );
    if (devProfile?.investment_contact_email) {
      await sendEmail({
        to: devProfile.investment_contact_email,
        subject: "New investor introduction request",
        text: `An investor has requested an introduction to your program "${program.name || program.id}". Review it in your Divini Procure investment dashboard.`,
      });
    }
    res.status(201).json({ introductionRequest: row });
  }),
);

router.get(
  "/investor/introductions",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const investor = await myInvestor(auth.userId!);
    if (!investor) return res.json({ introductions: [] });

    const rows = await q<any>(
      `select r.*,
              p.name as program_name, p.asset_class, p.location, p.program_type,
              p.projected_return, p.hold_period, p.target_raise_cents, p.min_investment_cents,
              c.name as developer_name,
              dip.investment_contact_name, dip.investment_contact_email, dip.investment_contact_phone
         from investor_introduction_requests r
         join investment_programs p on p.id = r.program_id
         join companies c on c.id = p.company_id
         left join developer_investment_profiles dip on dip.company_id = p.company_id
        where r.investor_id = $1
        order by r.updated_at desc`,
      [investor.id]
    );
    // Only reveal developer contact info when status is approved or intro_made
    const out = rows.map((r: any) => {
      const approved = ['approved', 'intro_made'].includes(r.status);
      return {
        id: r.id,
        status: r.status,
        pipeline_status: r.pipeline_status,
        created_at: r.created_at,
        updated_at: r.updated_at,
        developer_notes: r.developer_notes,
        program: {
          id: r.program_id,
          name: r.program_name,
          asset_class: r.asset_class,
          location: r.location,
          program_type: r.program_type,
          projected_return: r.projected_return,
          hold_period: r.hold_period,
          target_raise_cents: r.target_raise_cents,
          min_investment_cents: r.min_investment_cents,
        },
        developer: {
          name: r.developer_name,
          contact_name: approved ? r.investment_contact_name : null,
          contact_email: approved ? r.investment_contact_email : null,
          contact_phone: approved ? r.investment_contact_phone : null,
          contact_revealed: approved,
        },
      };
    });
    res.json({ introductions: out });
  }),
);

router.patch(
  "/investment/introductions/:id",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const intro = await q1<any>(`select * from investor_introduction_requests where id = $1`, [
      req.params.id,
    ]);
    if (!intro) throw new NotFoundError("introduction request not found");
    const program = await q1<any>(`select * from investment_programs where id = $1`, [intro.program_id]);
    if (!program) throw new NotFoundError("program not found");
    if (!auth.isAdmin) await assertMember(auth.userId!, program.company_id);

    const { decision, notes } = (req.body ?? {}) as Record<string, unknown>;
    const map: Record<string, { status: string; pipeline: string }> = {
      approve: { status: "approved", pipeline: "intro_approved" },
      decline: { status: "declined", pipeline: "declined" },
      request_info: { status: "info_requested", pipeline: "info_requested" },
      require_nda: { status: "nda_required", pipeline: "nda_required" },
    };
    const m = map[String(decision)];
    if (!m) {
      return res
        .status(400)
        .json({ error: "decision must be approve | decline | request_info | require_nda" });
    }
    const notesCol = auth.isAdmin ? "admin_notes" : "developer_notes";
    const row = await q1<any>(
      `update investor_introduction_requests
         set status = $2, pipeline_status = $3, ${notesCol} = $4, updated_at = now()
       where id = $1 returning *`,
      [intro.id, m.status, m.pipeline, notes ? String(notes) : intro[notesCol]],
    );
    // Double opt-in: the investor opted in by requesting; when the developer
    // approves, both sides have consented -> mark the mutual confirmation and the
    // moment contacts are exchanged. Divini's role ends here (introducer only).
    if (m.status === "approved") {
      await q(
        `update investor_introduction_requests
           set developer_confirmed = true, contacts_exchanged_at = coalesce(contacts_exchanged_at, now())
         where id = $1`,
        [intro.id],
      );
      // Responding to an intro is a marketplace-healthy behavior -> developer earns.
      await earn("company", program.company_id, EARN.responsiveness, "responsiveness", { refId: intro.id });
    }
    await audit({
      userId: auth.userId,
      email: auth.email,
      action: "introduction_decided",
      subjectType: "introduction_request",
      subjectId: intro.id,
      detail: { decision, status: m.status },
    });
    // Best-effort notify the investor of the decision.
    try {
      const investorProfile = await q1<{ email: string }>(
        `select email from investor_profiles where id = $1`,
        [intro.investor_id],
      );
      const investorEmail = investorProfile?.email;
      const programName = program.name || program.id;
      const baseUrl = process.env.APP_URL ?? "https://app.diviniprocure.com";
      if (investorEmail) {
        if (String(decision) === "approve") {
          await sendEmail({
            to: investorEmail,
            subject: "Your introduction request was approved",
            text: `Good news -- ${programName} has approved your introduction request for ${programName}. You can now connect directly. Log in to your Divini Procure investor dashboard to see their contact information.`,
          });
        } else if (String(decision) === "decline") {
          await sendEmail({
            to: investorEmail,
            subject: "Update on your introduction request",
            text: `Thank you for your interest in ${programName}. The sponsor has reviewed your request and is not moving forward at this time. You can browse other opportunities at ${baseUrl}/opportunities.`,
          });
        } else if (String(decision) === "request_info") {
          await sendEmail({
            to: investorEmail,
            subject: "More information requested",
            text: `The sponsor for ${programName} has requested additional information before proceeding. Please log in to your Divini Procure dashboard to respond.`,
          });
        } else if (String(decision) === "require_nda") {
          await sendEmail({
            to: investorEmail,
            subject: "NDA required to proceed",
            text: `The sponsor for ${programName} requires an NDA before sharing further details. Please log in to your Divini Procure investor dashboard to sign the NDA.`,
          });
        }
      }
    } catch {
      // ignore email errors
    }
    res.json({ introductionRequest: row });
  }),
);

router.get(
  "/investment/programs/:id/pipeline",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const program = await loadProgramForMember(auth.userId!, auth.isAdmin, req.params.id);
    const intros = await q<any>(
      `select ir.*, ip.entity_name, ip.full_name, ip.investor_type, ip.accreditation_status
         from investor_introduction_requests ir
         join investor_profiles ip on ip.id = ir.investor_id
        where ir.program_id = $1
        order by ir.created_at desc`,
      [program.id],
    );
    const counts: Record<string, number> = {};
    for (const i of intros) {
      const k = i.pipeline_status || "matched";
      counts[k] = (counts[k] || 0) + 1;
    }
    // committedCents: sum of program min for intros in committed-style stages.
    const committedStages = new Set(["committed", "closed", "funded", "intro_made"]);
    let committedCents = 0;
    const investors = intros.map((i) => {
      const committed = committedStages.has(String(i.pipeline_status));
      if (committed) committedCents += Number(program.min_investment_cents || 0);
      const reveal = ["approved", "intro_made"].includes(String(i.status)) || auth.isAdmin;
      return {
        introId: i.id,
        investorId: i.investor_id,
        status: i.status,
        pipeline_status: i.pipeline_status,
        display_name: reveal ? i.entity_name || i.full_name || "Investor" : i.entity_name || "Investor",
        investor_type: i.investor_type,
        accreditation_status: i.accreditation_status,
        pii_masked: !reveal,
      };
    });
    res.json({
      targetRaiseCents: Number(program.target_raise_cents || 0),
      committedCents,
      counts,
      investors,
    });
  }),
);

// ===========================================================================
// ADMIN
// ===========================================================================

router.get(
  "/admin/investment/overview",
  requireAdmin,
  h(async (_req, res) => {
    const programsForReview = await q<any>(
      `select id, company_id, name, status, admin_review_status, created_at
         from investment_programs where status = 'submitted_for_review' order by created_at`,
    );
    const profilesForReview = await q<any>(
      `select id, company_id, status, admin_review_status, created_at
         from developer_investment_profiles where status = 'submitted_for_review' order by created_at`,
    );
    const investorsForReview = await q<any>(
      `select id, user_id, entity_name, investor_type, admin_review_status, created_at
         from investor_profiles where admin_review_status = 'pending_review' order by created_at`,
    );
    const flags = await q<any>(
      `select * from compliance_flags where resolved = false order by created_at desc limit 100`,
    );
    const counts = {
      programsForReview: programsForReview.length,
      profilesForReview: profilesForReview.length,
      investorsForReview: investorsForReview.length,
      openFlags: flags.length,
      activePrograms: Number(
        (await q1<{ c: string }>(`select count(*)::int as c from investment_programs where status = 'active'`))
          ?.c ?? 0,
      ),
      investors: Number(
        (await q1<{ c: string }>(`select count(*)::int as c from investor_profiles`))?.c ?? 0,
      ),
    };
    res.json({ counts, programsForReview, profilesForReview, investorsForReview, flags });
  }),
);

router.get(
  "/admin/investor/profiles",
  requireAdmin,
  h(async (req, res) => {
    const status = req.query.status ? String(req.query.status) : null;
    const rows = status
      ? await q<any>(
          `select * from investor_profiles where admin_review_status = $1 order by created_at desc`,
          [status],
        )
      : await q<any>(`select * from investor_profiles order by created_at desc`);
    res.json({ profiles: rows });
  }),
);

router.patch(
  "/admin/investor/:id",
  requireAdmin,
  h(async (req, res) => {
    const auth = getAuth(req);
    const { decision, notes } = (req.body ?? {}) as Record<string, unknown>;
    const profile = await q1<any>(`select * from investor_profiles where id = $1`, [req.params.id]);
    if (!profile) throw new NotFoundError("investor profile not found");

    // Decisions map to admin_review_status + access_level. Accreditation / KYC /
    // AML verification is recorded on the qualification record by admin action.
    let reviewStatus = profile.admin_review_status;
    let accessLevel = profile.access_level;
    switch (String(decision)) {
      case "approve":
        reviewStatus = "approved";
        accessLevel = "approved_investor";
        break;
      case "restrict":
        reviewStatus = "restricted";
        accessLevel = "public_teaser_only";
        break;
      case "require_nda":
        reviewStatus = "nda_required";
        break;
      case "require_kyc":
        reviewStatus = "kyc_required";
        break;
      default:
        return res
          .status(400)
          .json({ error: "decision must be approve | restrict | require_nda | require_kyc" });
    }
    const row = await q1<any>(
      `update investor_profiles
         set admin_review_status = $2, access_level = $3, admin_notes = $4, updated_at = now()
       where id = $1 returning *`,
      [profile.id, reviewStatus, accessLevel, notes ? String(notes) : profile.admin_notes],
    );
    // Reflect KYC requirement on the qualification record where relevant.
    if (decision === "require_kyc") {
      await q(
        `update investor_qualification_records set kyc_status = 'required', updated_at = now()
         where investor_id = $1`,
        [profile.id],
      );
    }
    await audit({
      userId: auth.userId,
      email: auth.email,
      action: "investor_reviewed",
      subjectType: "investor_profile",
      subjectId: profile.id,
      detail: { decision, reviewStatus },
    });
    // Best-effort notify investor when their profile is approved.
    if (String(decision) === "approve") {
      try {
        const investorEmail = profile.email as string | null | undefined;
        const baseUrl = process.env.APP_URL ?? "https://app.diviniprocure.com";
        if (investorEmail) {
          await sendEmail({
            to: investorEmail,
            subject: "Your investor profile has been approved",
            text: `Your Divini Procure investor profile has been reviewed and approved. You can now browse and request introductions to investment opportunities. Log in at ${baseUrl}/investor.`,
          });
        }
      } catch {
        // ignore email errors
      }
    }
    res.json({ profile: row });
  }),
);

export default router;
