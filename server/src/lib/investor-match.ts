/**
 * DETERMINISTIC investor <-> program matching. No external LLM, no
 * randomness. Given a program and an investor (profile + preferences +
 * qualification), produce a 0-100 score, a human label, and a list of
 * eligibility reasons.
 *
 * Compliance: this module SCORES and SURFACES matches only. It never verifies
 * accreditation, approves investors, or publishes offerings. Gating reasons
 * that are hard blockers (accreditation, NDA, KYC, admin approval) override the
 * numeric label so the UI cannot present an ineligible investor as a match.
 *
 * Weights sum to 100:
 *   accreditation / eligibility   20
 *   amount fit                    15
 *   asset class                   15
 *   market                        10
 *   structure                     10
 *   risk                          10
 *   hold                           5
 *   return                         5
 *   NDA / KYC readiness            5
 *   investor type                  5
 *
 * Zero em dashes by convention.
 */

// Loose shapes so callers can pass raw DB rows. Only the read fields matter.
export interface ProgramLike {
  id?: string;
  asset_class?: string | null;
  location?: string | null;
  min_investment_cents?: number | string | null;
  max_investment_cents?: number | string | null;
  accredited_only?: boolean | null;
  non_accredited_accepted?: boolean | null;
  investor_type_accepted?: string | null;
  offering_type?: string | null;
  investment_vehicle?: string | null;
  risk_level?: string | null;
  hold_period?: string | null;
  preferred_return?: string | null;
  projected_return?: string | null;
  irr_target?: string | null;
  program_type?: string | null;
  nda_required?: boolean | null;
  kyc_required?: boolean | null;
  visibility?: string | null;
  status?: string | null;
}

export interface InvestorLike {
  id?: string;
  investor_type?: string | null;
  accreditation_status?: string | null;
  access_level?: string | null;
  admin_review_status?: string | null;
}

export interface PrefsLike {
  asset_classes?: string[] | null;
  markets?: string[] | null;
  min_investment_cents?: number | string | null;
  max_investment_cents?: number | string | null;
  preferred_deal_size_cents?: number | string | null;
  preferred_hold_period?: string | null;
  target_return?: string | null;
  risk_tolerance?: string | null;
  preferred_structure?: string | null;
  deal_types?: string[] | null;
}

export interface QualLike {
  accredited?: string | null;
  non_accredited?: boolean | null;
  qualified_purchaser?: string | null;
  family_office?: boolean | null;
  proof_of_funds?: boolean | null;
  kyc_completed?: boolean | null;
  nda_willing?: boolean | null;
  can_review_private?: boolean | null;
  education_interest?: boolean | null;
}

export interface MatchResult {
  score: number;
  label: string;
  eligibility: string[];
}

// ---- helpers ---------------------------------------------------------------

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function norm(s: string | null | undefined): string {
  return (s ?? "").toString().trim().toLowerCase();
}

function normArr(a: string[] | null | undefined): string[] {
  return (a ?? []).map((x) => norm(x)).filter(Boolean);
}

function isAccredited(investor: InvestorLike, qual: QualLike | null): boolean {
  const a = norm(investor.accreditation_status);
  if (["accredited", "verified", "verified_accredited", "qualified_purchaser"].includes(a)) return true;
  const qa = norm(qual?.accredited);
  if (["yes", "true", "accredited", "verified"].includes(qa)) return true;
  if (norm(qual?.qualified_purchaser) === "yes" || qual?.qualified_purchaser === "true") return true;
  return false;
}

// Coarse risk ordering for adjacency comparison.
const RISK_ORDER = ["low", "conservative", "moderate", "balanced", "growth", "high", "aggressive", "speculative"];
function riskRank(s: string | null | undefined): number {
  const v = norm(s);
  const i = RISK_ORDER.indexOf(v);
  return i === -1 ? -1 : i;
}

// ---- visibility / access enforcement --------------------------------------

/**
 * canViewProgram enforces the visibility rules for the INVESTOR side. It does
 * NOT consult NDA records itself (callers pass hasSignedNda for the nda_required
 * case). Only programs in status approved|active are publicly listable.
 */
export function canViewProgram(
  program: ProgramLike,
  investor: InvestorLike | null,
  opts: { hasSignedNda?: boolean } = {},
): boolean {
  const status = norm(program.status);
  // Only approved/active programs are listed publicly. (Owners/admins bypass
  // this function entirely in the route layer.)
  if (!["approved", "active"].includes(status)) return false;

  const visibility = norm(program.visibility) || "public_teaser";
  if (visibility === "closed") return false;
  if (visibility === "public_teaser") return true;

  // Everything below requires an investor identity.
  if (!investor) return false;

  const accredited = isAccredited(investor, null);
  const adminApproved = norm(investor.admin_review_status) === "approved";

  switch (visibility) {
    case "accredited_only":
      return accredited;
    case "non_accredited_program":
      // non-accredited cannot see accredited-only; this one is open to all
      // investors (accredited or not).
      return true;
    case "approved_investor_preview":
      return adminApproved;
    case "admin_approved_only":
      return adminApproved;
    case "nda_required":
      return !!opts.hasSignedNda;
    case "family_office_only":
      return norm(investor.investor_type) === "family_office";
    case "private_invite_only":
      // Invite-only deals are never auto-listed; an explicit intro/invite path
      // surfaces them. Default deny here.
      return false;
    default:
      return false;
  }
}

// ---- scoring ---------------------------------------------------------------

export function scoreMatch(
  program: ProgramLike,
  investor: InvestorLike,
  prefs: PrefsLike | null,
  qual: QualLike | null,
): MatchResult {
  const eligibility: string[] = [];
  let score = 0;

  const accredited = isAccredited(investor, qual);
  const nonAccreditedOk = program.non_accredited_accepted === true;
  const accreditedOnly = program.accredited_only === true;

  // ---- HARD GATES (these override the numeric label) ----------------------
  let hardBlock: string | null = null;

  // 1. Accreditation / eligibility (weight 20)
  if (accreditedOnly && !accredited) {
    hardBlock = hardBlock ?? "Accreditation Required";
    eligibility.push("Program is accredited-only; investor is not accredited");
  } else if (accreditedOnly && accredited) {
    score += 20;
    eligibility.push("Accreditation requirement met");
  } else if (!accreditedOnly) {
    // Open or non-accredited friendly program.
    if (accredited || nonAccreditedOk) {
      score += 20;
      eligibility.push(accredited ? "Investor is accredited" : "Program accepts non-accredited investors");
    } else {
      // Program not explicitly accredited-only but does not list non-accredited
      // acceptance and investor is not accredited: partial, flag for review.
      score += 8;
      eligibility.push("Eligibility unclear; needs review");
    }
  }

  // 2. Amount fit (weight 15)
  const pMin = num(program.min_investment_cents);
  const pMax = num(program.max_investment_cents);
  const iMax = num(prefs?.max_investment_cents);
  const iMin = num(prefs?.min_investment_cents);
  let amountTooHigh = false;
  {
    let amountScore = 0;
    if (pMin !== null && iMax !== null && iMax < pMin) {
      // Investor's ceiling is below the program minimum: hard mismatch.
      amountTooHigh = true;
      hardBlock = hardBlock ?? "Minimum Investment Too High";
      eligibility.push("Program minimum exceeds investor's maximum capacity");
    } else {
      // Range overlap heuristic.
      if (pMin === null && iMax === null) {
        amountScore = 9; // no data either way
      } else {
        amountScore = 15;
        if (iMin !== null && pMax !== null && iMin > pMax) {
          // Investor wants larger checks than program allows: still workable,
          // mild penalty.
          amountScore = 8;
          eligibility.push("Investor preferred size above program maximum");
        } else {
          eligibility.push("Investment amount is within range");
        }
      }
    }
    score += amountScore;
  }

  // 3. Asset class (weight 15)
  {
    const pAsset = norm(program.asset_class);
    const iAssets = normArr(prefs?.asset_classes);
    let assetMismatch = false;
    if (!pAsset && iAssets.length === 0) {
      score += 8;
    } else if (pAsset && iAssets.length === 0) {
      score += 8; // investor has no stated preference, neutral
    } else if (pAsset && iAssets.includes(pAsset)) {
      score += 15;
      eligibility.push("Asset class matches investor focus");
    } else {
      assetMismatch = true;
      eligibility.push("Asset class is outside investor's stated focus");
    }
    if (assetMismatch && score < 40) hardBlock = hardBlock ?? "Asset Class Mismatch";
  }

  // 4. Market (weight 10)
  let marketMismatch = false;
  {
    const pMarket = norm(program.location);
    const iMarkets = normArr(prefs?.markets);
    if (!pMarket || iMarkets.length === 0) {
      score += 5; // neutral when unstated
    } else if (iMarkets.some((m) => pMarket.includes(m) || m.includes(pMarket))) {
      score += 10;
      eligibility.push("Market matches investor preference");
    } else {
      marketMismatch = true;
      eligibility.push("Market is outside investor preference");
    }
  }

  // 5. Structure (weight 10)
  let structureMismatch = false;
  {
    const pStruct = norm(program.offering_type) || norm(program.investment_vehicle);
    const iStruct = norm(prefs?.preferred_structure);
    const iDealTypes = normArr(prefs?.deal_types);
    if (!pStruct || (!iStruct && iDealTypes.length === 0)) {
      score += 5;
    } else if (
      (iStruct && (pStruct.includes(iStruct) || iStruct.includes(pStruct))) ||
      iDealTypes.some((d) => pStruct.includes(d) || d.includes(pStruct))
    ) {
      score += 10;
      eligibility.push("Structure matches investor preference");
    } else {
      structureMismatch = true;
      eligibility.push("Investment structure differs from investor preference");
    }
  }

  // 6. Risk (weight 10)
  let riskMismatch = false;
  {
    const pr = riskRank(program.risk_level);
    const ir = riskRank(prefs?.risk_tolerance);
    if (pr === -1 || ir === -1) {
      score += 5;
    } else {
      const diff = Math.abs(pr - ir);
      if (diff <= 1) {
        score += 10;
        eligibility.push("Risk profile aligns");
      } else if (diff <= 3) {
        score += 5;
        eligibility.push("Risk profile partially aligns");
      } else {
        riskMismatch = true;
        eligibility.push("Risk profile differs from investor tolerance");
      }
    }
  }

  // 7. Hold (weight 5)
  {
    const pHold = norm(program.hold_period);
    const iHold = norm(prefs?.preferred_hold_period);
    if (!pHold || !iHold) score += 3;
    else if (pHold.includes(iHold) || iHold.includes(pHold)) {
      score += 5;
      eligibility.push("Hold period matches");
    }
  }

  // 8. Return (weight 5)
  {
    const pRet = norm(program.preferred_return) || norm(program.projected_return) || norm(program.irr_target);
    const iRet = norm(prefs?.target_return);
    if (!pRet || !iRet) score += 3;
    else if (pRet.includes(iRet) || iRet.includes(pRet)) {
      score += 5;
      eligibility.push("Target return aligns");
    } else {
      score += 2;
    }
  }

  // 9. NDA / KYC readiness (weight 5)
  let needsNda = false;
  let needsKyc = false;
  {
    let readiness = 5;
    if (program.nda_required === true) {
      if (qual?.nda_willing === true) {
        eligibility.push("Investor willing to sign NDA");
      } else {
        readiness -= 3;
        needsNda = true;
        eligibility.push("Program requires an NDA");
      }
    }
    if (program.kyc_required === true) {
      if (qual?.kyc_completed === true) {
        eligibility.push("KYC completed");
      } else {
        readiness -= 2;
        needsKyc = true;
        eligibility.push("Program requires KYC");
      }
    }
    score += Math.max(0, readiness);
  }

  // 10. Investor type (weight 5)
  {
    const accepted = norm(program.investor_type_accepted);
    const itype = norm(investor.investor_type);
    if (!accepted || accepted === "any" || accepted === "all" || !itype) {
      score += 3;
    } else if (accepted.includes(itype) || itype.includes(accepted)) {
      score += 5;
      eligibility.push("Investor type accepted");
    }
  }

  // Admin approval gate for restricted visibilities.
  const visibility = norm(program.visibility);
  let needsAdmin = false;
  if (
    (visibility === "admin_approved_only" || visibility === "approved_investor_preview") &&
    norm(investor.admin_review_status) !== "approved"
  ) {
    needsAdmin = true;
    eligibility.push("Requires admin approval of investor");
  }

  // Clamp.
  if (score < 0) score = 0;
  if (score > 100) score = 100;

  // ---- LABEL ---------------------------------------------------------------
  // Specific gating reasons override the numeric label.
  let label: string;
  const isEducationProgram =
    norm(program.program_type).includes("education") || norm(program.offering_type).includes("education");

  if (hardBlock === "Accreditation Required") {
    label = "Accreditation Required";
  } else if (amountTooHigh) {
    label = "Minimum Investment Too High";
  } else if (needsAdmin) {
    label = "Needs Admin Approval";
  } else if (needsNda) {
    label = "Needs NDA";
  } else if (needsKyc) {
    label = "Needs KYC";
  } else if (!accredited && (nonAccreditedOk || isEducationProgram) && isEducationProgram) {
    label = "Education Track Match";
  } else if (riskMismatch && score < 60) {
    label = "Risk Mismatch";
  } else if (marketMismatch && score < 60) {
    label = "Market Mismatch";
  } else if (structureMismatch && score < 60) {
    label = "Structure Mismatch";
  } else if (hardBlock === "Asset Class Mismatch" && score < 40) {
    label = "Not Eligible";
  } else if (score >= 80) {
    label = "Strong Match";
  } else if (score >= 60) {
    label = "Qualified Match";
  } else if (score >= 40) {
    label = "Needs Review";
  } else {
    label = "Not Eligible";
  }

  return { score, label, eligibility };
}
