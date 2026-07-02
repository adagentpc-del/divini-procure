/**
 * Divini Procure - INCENTIVE ENGINE routes.
 *
 *   GET  /incentives/credits            -> caller's Intro Credit state (investor or company scope)
 *   GET  /incentives/trust/:companyId   -> a developer's trust score (any authed user; investors vet with this)
 *   GET  /incentives/trust              -> the caller's own company trust profile + score (for editing)
 *   POST /incentives/trust              -> upsert the caller's own company trust profile
 *   GET  /incentives/founding           -> caller's Founding Member status (auto-enrolls early members)
 *
 * Everything is additive and safe: intro-credit metering is gated on
 * PROCURE_INTRO_CREDITS (off by default), so these endpoints report state and
 * accrue a ledger without blocking anything until the flag is flipped.
 *
 * Router convention: h(fn) = (req,res,next) => fn(req,res).catch(next).
 * Zero em dashes by convention.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, requireUser } from "../auth.js";
import { q, q1 } from "../pool.js";
import { userCompanyIds } from "../db.js";
import { getCreditState, earn, EARN, FOUNDING_BONUS, type ActorKind } from "../lib/introCredits.js";
import { getTrustScore, upsertTrustProfile } from "../lib/trustScore.js";

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const router = Router();

const FOUNDING_CAP = Number(process.env.PROCURE_FOUNDING_CAP || 500);

/** Enroll an actor as a Founding Member if the cohort still has room; award the bonus once. */
export async function ensureFoundingMember(kind: ActorKind, actorId: string, cohort: string): Promise<boolean> {
  const already = await q1<{ actor_id: string }>(
    `select actor_id from founding_members where actor_kind = $1 and actor_id = $2`,
    [kind, actorId],
  );
  if (already) return true;
  const countRow = await q1<{ n: string | number }>(
    `select count(*) as n from founding_members where cohort = $1`,
    [cohort],
  );
  if (Number(countRow?.n ?? 0) >= FOUNDING_CAP) return false;
  await q(
    `insert into founding_members (actor_kind, actor_id, cohort) values ($1,$2,$3)
     on conflict (actor_kind, actor_id) do nothing`,
    [kind, actorId, cohort],
  );
  await earn(kind, actorId, FOUNDING_BONUS, "founding_bonus", { oncePerReason: true });
  return true;
}

// ---- Credits ---------------------------------------------------------------
router.get(
  "/credits",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const scope = String(req.query.scope || "");
    const companyIds = await userCompanyIds(auth.userId!);
    // Default: developer/company scope if the user belongs to a company, else investor.
    const asCompany = scope === "company" || (scope !== "investor" && companyIds.length > 0);
    if (asCompany && companyIds.length > 0) {
      const companyId = companyIds[0];
      const credits = await getCreditState("company", companyId);
      return res.json({ scope: "company", actorId: companyId, credits });
    }
    const credits = await getCreditState("investor", auth.userId!);
    res.json({ scope: "investor", actorId: auth.userId, credits });
  }),
);

// ---- Trust score (view any developer) --------------------------------------
router.get(
  "/trust/:companyId",
  requireUser,
  h(async (req, res) => {
    const trust = await getTrustScore(req.params.companyId);
    res.json({ trust });
  }),
);

// ---- Trust profile (own company: read + upsert) ----------------------------
router.get(
  "/trust",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyIds = await userCompanyIds(auth.userId!);
    if (companyIds.length === 0) return res.json({ trust: null });
    const trust = await getTrustScore(companyIds[0]);
    res.json({ companyId: companyIds[0], trust });
  }),
);

router.post(
  "/trust",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyIds = await userCompanyIds(auth.userId!);
    if (companyIds.length === 0) return res.status(400).json({ error: "no company to attach a trust profile to" });
    const profile = await upsertTrustProfile(companyIds[0], (req.body ?? {}) as Record<string, unknown>);
    // Completing a trust profile is a marketplace-healthy behavior -> earn once.
    await earn("company", companyIds[0], 5, "profile_complete", { oncePerReason: true });
    const trust = await getTrustScore(companyIds[0]);
    res.json({ profile, trust });
  }),
);

// ---- Founding status -------------------------------------------------------
router.get(
  "/founding",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const companyIds = await userCompanyIds(auth.userId!);
    // Auto-enroll: investors as investor cohort, developers as developer cohort.
    const cohortYear = new Date().getUTCFullYear();
    const investorFounder = await ensureFoundingMember("investor", auth.userId!, `investor-${cohortYear}`);
    let companyFounder = false;
    if (companyIds.length > 0) {
      companyFounder = await ensureFoundingMember("company", companyIds[0], `developer-${cohortYear}`);
    }
    res.json({ investorFounder, companyFounder });
  }),
);

// ---- Peer referrals (refer someone -> earn credits) ------------------------
router.get(
  "/referral",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const code = auth.userId!; // a user's referral code is their own id
    const countRow = await q1<{ n: string | number }>(
      `select count(*) as n from user_referrals where referrer_user_id = $1 and referred_user_id is not null`,
      [code],
    );
    const earnedRow = await q1<{ s: string | number | null }>(
      `select coalesce(sum(delta),0) as s from intro_credit_ledger
        where actor_kind = 'investor' and actor_id = $1 and reason = 'referral'`,
      [code],
    );
    // A company member also accrues referral credits on the company ledger.
    res.json({ code, count: Number(countRow?.n ?? 0), creditsEarned: Number(earnedRow?.s ?? 0) });
  }),
);

router.post(
  "/referral/attribute",
  requireUser,
  h(async (req, res) => {
    const auth = getAuth(req);
    const me = auth.userId!;
    const code = String((req.body ?? {}).code || "").trim();
    if (!code) return res.status(400).json({ error: "referral code required" });
    if (code === me) return res.json({ attributed: false, reason: "self" });

    // One attribution per referred user, ever (unique on referred_user_id).
    const existing = await q1<{ id: string }>(
      `select id from user_referrals where referred_user_id = $1`,
      [me],
    );
    if (existing) return res.json({ attributed: false, reason: "already_attributed" });

    // The referrer must be a real user.
    const referrer = await q1<{ id: string }>(`select id from users where id = $1`, [code]);
    if (!referrer) return res.json({ attributed: false, reason: "unknown_referrer" });

    await q(
      `insert into user_referrals (referrer_user_id, referred_user_id, referral_code, rewarded)
       values ($1,$2,$1,true)
       on conflict (referred_user_id) do nothing`,
      [code, me],
    );
    // Reward the referrer on their investor ledger; also credit their company if they have one.
    await earn("investor", code, EARN.referral, "referral", { refId: me });
    const refCompanies = await userCompanyIds(code);
    if (refCompanies.length > 0) {
      await earn("company", refCompanies[0], EARN.referral, "referral", { refId: me });
    }
    res.json({ attributed: true });
  }),
);

export default router;
