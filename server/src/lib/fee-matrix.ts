/**
 * Divini Procure - FEE MATRIX resolution (read-only).
 *
 * Resolves "which fee applies to THIS context" by layering the configurable
 * fee_rules matrix UNDER the protected grandfathered existing-relationship fee.
 *
 * Precedence:
 *   1) Grandfathered pair ALWAYS wins. If the developer-vendor pair has a
 *      developer_vendor_relationships row that resolveFee() reports as
 *      grandfathered, we return that 2% rate and stop. Nothing in the matrix can
 *      override it. (Reuses getByPair + resolveFee, never duplicates them.)
 *   2) Otherwise the most specific active fee_rules row for the requested
 *      rule_type, by scope precedence pair > program > developer > vendor >
 *      global.
 *   3) Otherwise the standard platform default (STANDARD_FEE_PERCENTAGE).
 *
 * Pure/read-only: this module never writes. Zero em dashes by convention.
 */
import { q1 } from "../pool.js";
import { resolveFee, STANDARD_FEE_PERCENTAGE } from "./fee-rules.js";
import { getByPair } from "./relationships.js";

export const FEE_RULE_TYPES = [
  "grandfathered_2pct",
  "standard_platform",
  "preferred_vendor_placement",
  "white_glove",
  "referral_partner",
  "capital_introduction",
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
 * Resolve the effective fee for a context. Read-only.
 *
 * The grandfathered 2% pair is resolved FIRST and unconditionally wins, exactly
 * as in the relationship data layer (getByPair + resolveFee). Only if no pair is
 * grandfathered do we consult the configurable matrix, then fall back to the
 * platform standard.
 */
export async function resolveContextFee(
  input: ResolveContextInput,
): Promise<ResolvedContextFee> {
  const developerCompanyId = input.developerCompanyId ?? null;
  const vendorCompanyId = input.vendorCompanyId ?? null;
  const programId = input.programId ?? null;
  const ruleType = asRuleType(input.ruleType);

  // 1) Grandfathered pair always wins.
  if (developerCompanyId && vendorCompanyId) {
    const rel = await getByPair(developerCompanyId, vendorCompanyId);
    const resolved = resolveFee(rel);
    if (resolved.grandfathered) {
      return {
        source: "grandfathered_2_percent",
        ruleType: "grandfathered_2pct",
        percentage: resolved.feePercentage,
        flatCents: null,
        payer_type: "admin_configured",
        scope: "pair",
        ruleId: null,
        label: resolved.label,
      };
    }
  }

  // 2) Most specific active matrix rule for this rule_type.
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

  // 3) Standard platform fallback.
  return {
    source: "standard",
    ruleType: "standard_platform",
    percentage: STANDARD_FEE_PERCENTAGE,
    flatCents: null,
    payer_type: "developer_pays",
    scope: "global",
    ruleId: null,
    label: "Standard Divini Procure platform/referral fee applies.",
  };
}
