/**
 * Divini Procure - FEE MATRIX resolution (read-only).
 *
 * The SINGLE resolution path for every platform fee percentage, cap, and fee
 * type. Nothing in the app hard-codes a fee amount outside this module (and
 * the config.ts fallbacks it reads when the database has no matching row).
 *
 * Precedence (for the standard_platform rule type only):
 *   1) Grandfathered pair ALWAYS wins. If the developer-vendor pair has a
 *      developer_vendor_relationships row that resolveFee() reports as
 *      grandfathered, we return that 2% rate capped at $10,000 and stop.
 *      Nothing in the matrix can override it. (Reuses getByPair + resolveFee,
 *      never duplicates them.) Every OTHER rule type (including
 *      platform_infrastructure_fee) skips this step entirely.
 *   2) Otherwise the most specific active fee_rules row for the requested
 *      rule_type, by scope precedence pair > program > developer > vendor >
 *      global. A developer- or vendor-scoped row here IS an enterprise custom
 *      fee schedule.
 *   3) Otherwise a config-driven fallback (5% capped $25,000 for
 *      standard_platform; 0.1% capped $1,500 for platform_infrastructure_fee;
 *      zero for anything else with no seeded row).
 *
 * Pure/read-only: this module never writes. Zero em dashes by convention.
 */
import { q1 } from "../pool.js";
import { resolveFee } from "./fee-rules.js";
import { getByPair } from "./relationships.js";
import {
  PROCURE_SUCCESS_FEE_PCT,
  PROCURE_SUCCESS_FEE_CAP_CENTS,
  PROCURE_GRANDFATHERED_PCT,
  PROCURE_GRANDFATHERED_CAP_CENTS,
  PROCURE_SERVICE_BUFFER_PCT,
  PROCURE_SERVICE_BUFFER_CAP_CENTS,
} from "../config.js";

export const FEE_RULE_TYPES = [
  "grandfathered_2pct",
  "standard_platform",
  "platform_infrastructure_fee",
  "preferred_vendor_placement",
  "white_glove",
  "referral_partner",
] as const;
export type FeeRuleType = (typeof FEE_RULE_TYPES)[number];

export const FEE_SCOPES = ["global", "developer", "vendor", "pair", "program"] as const;
export type FeeScope = (typeof FEE_SCOPES)[number];

export const PAYER_TYPES = [
  "developer_pays",
  "vendor_pays",
  "split_fee",
  "deducted_from_vendor_payment",
  "added_to_developer_invoice",
  "admin_configured",
] as const;
export type PayerType = (typeof PAYER_TYPES)[number];

export interface FeeRuleRow {
  id: string;
  rule_type: string;
  scope: string;
  developer_company_id: string | null;
  vendor_company_id: string | null;
  program_id: string | null;
  percentage: number | string | null;
  flat_cents: number | string | null;
  cap_cents: number | string | null;
  payer_type: string;
  billing_cycle: string | null;
  active: boolean;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResolveContextInput {
  developerCompanyId?: string | null;
  vendorCompanyId?: string | null;
  ruleType?: string | null;
  programId?: string | null;
}

export interface ResolvedContextFee {
  source: "grandfathered_2_percent" | "fee_rule" | "standard";
  ruleType: string;
  percentage: number | null;
  flatCents: number | null;
  /** Cap on the percentage fee, in cents. Null/0 = uncapped. */
  capCents: number | null;
  payer_type: PayerType;
  scope: FeeScope | null;
  ruleId: string | null;
  label: string;
}

function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

function asRuleType(v: string | null | undefined): FeeRuleType {
  return (FEE_RULE_TYPES as readonly string[]).includes(v ?? "")
    ? (v as FeeRuleType)
    : "standard_platform";
}

/**
 * Resolve the effective fee for a context. Read-only. This is the SINGLE
 * resolution path for every platform fee: nothing computes a fee percentage
 * or cap outside this function (or the config.ts fallbacks it reads when the
 * database has no matching row yet).
 *
 * For the standard_platform rule type ONLY, a grandfathered pair is resolved
 * FIRST and unconditionally wins, exactly as in the relationship data layer
 * (getByPair + resolveFee) - this is the existing-relationship discount and it
 * must never apply to any other fee type (e.g. the platform infrastructure
 * fee is flat regardless of relationship status). Otherwise: the most
 * specific active fee_rules row for the requested rule_type (an
 * enterprise/custom fee schedule is just a developer- or vendor-scoped row
 * here), else a config-driven fallback for the fee types that have one.
 */
export async function resolveContextFee(
  input: ResolveContextInput,
): Promise<ResolvedContextFee> {
  const developerCompanyId = input.developerCompanyId ?? null;
  const vendorCompanyId = input.vendorCompanyId ?? null;
  const programId = input.programId ?? null;
  const ruleType = asRuleType(input.ruleType);

  // 1) Grandfathered pair always wins, but ONLY for the standard platform fee.
  if (ruleType === "standard_platform" && developerCompanyId && vendorCompanyId) {
    const rel = await getByPair(developerCompanyId, vendorCompanyId);
    const resolved = resolveFee(rel);
    if (resolved.grandfathered) {
      return {
        source: "grandfathered_2_percent",
        ruleType: "grandfathered_2pct",
        percentage: resolved.feePercentage,
        flatCents: null,
        capCents: PROCURE_GRANDFATHERED_CAP_CENTS,
        payer_type: "admin_configured",
        scope: "pair",
        ruleId: null,
        label: resolved.label,
      };
    }
  }

  // 2) Most specific active matrix rule for this rule_type. An enterprise
  //    custom fee schedule is a developer- or vendor-scoped row here, which
  //    outranks the global default.
  //    scope precedence: pair > program > developer > vendor > global.
  const row = await q1<FeeRuleRow>(
    `select * from fee_rules
      where active = true
        and rule_type = $1
        and (
          (scope = 'pair'      and developer_company_id = $2 and vendor_company_id = $3)
          or (scope = 'program'   and program_id = $4)
          or (scope = 'developer' and developer_company_id = $2)
          or (scope = 'vendor'    and vendor_company_id = $3)
          or (scope = 'global')
        )
      order by case scope
                 when 'pair'      then 1
                 when 'program'   then 2
                 when 'developer' then 3
                 when 'vendor'    then 4
                 when 'global'    then 5
                 else 6
               end,
               updated_at desc
      limit 1`,
    [ruleType, developerCompanyId, vendorCompanyId, programId],
  );

  if (row) {
    return {
      source: "fee_rule",
      ruleType: row.rule_type,
      percentage: num(row.percentage),
      flatCents: num(row.flat_cents),
      capCents: num(row.cap_cents),
      payer_type: (PAYER_TYPES as readonly string[]).includes(row.payer_type)
        ? (row.payer_type as PayerType)
        : "admin_configured",
      scope: (FEE_SCOPES as readonly string[]).includes(row.scope)
        ? (row.scope as FeeScope)
        : null,
      ruleId: row.id,
      label: row.notes ?? `Fee rule: ${row.rule_type} (${row.scope}).`,
    };
  }

  // 3) Config-driven fallback, only for the fee types that have one (defends
  //    against a fresh database that has not run the fee_rules seed yet). The
  //    legacy uncapped 10% "everything defaults to standard" fallback is
  //    retired: a rule type with no seed row and no config default resolves
  //    to zero rather than silently charging an arbitrary percentage.
  if (ruleType === "standard_platform") {
    return {
      source: "standard",
      ruleType,
      percentage: PROCURE_SUCCESS_FEE_PCT,
      flatCents: null,
      capCents: PROCURE_SUCCESS_FEE_CAP_CENTS,
      payer_type: "developer_pays",
      scope: "global",
      ruleId: null,
      label: "Standard Divini Procure platform fee applies.",
    };
  }
  if (ruleType === "platform_infrastructure_fee") {
    return {
      source: "standard",
      ruleType,
      percentage: PROCURE_SERVICE_BUFFER_PCT,
      flatCents: null,
      capCents: PROCURE_SERVICE_BUFFER_CAP_CENTS,
      payer_type: "deducted_from_vendor_payment",
      scope: "global",
      ruleId: null,
      label: "Platform infrastructure fee applies.",
    };
  }
  return {
    source: "standard",
    ruleType,
    percentage: 0,
    flatCents: null,
    capCents: null,
    payer_type: "admin_configured",
    scope: null,
    ruleId: null,
    label: `No ${ruleType} fee rule configured.`,
  };
}
