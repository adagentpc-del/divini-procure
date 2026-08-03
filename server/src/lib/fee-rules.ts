/**
 * Divini Procure - FEE RULE RESOLUTION (pure, no IO).
 *
 * Single source of truth for "what fee applies to THIS developer-vendor pair".
 * The grandfathered 2% rule is relationship-specific and protected: once a pair
 * is in relationship_status = 'grandfathered_2_percent', the rate is 2% forever
 * and ordinary platform automations must NOT overwrite it. Only an explicit
 * admin override (fee_rule_source = 'admin_override') or deactivation may change
 * it, and that path is handled in the route layer, not here.
 *
 * The pure arithmetic (rate resolution) lives in the dependency-free module
 * ./feeMath.js and is delegated to from here, so the public API and behavior
 * of this module are unchanged. Actual fee AMOUNTS (with caps applied) are
 * resolved from the database via fee-matrix.ts / monetization.ts, which is the
 * single source of truth for percentages, caps, and fee types - nothing here
 * hard-codes a money amount. This module only decides the boolean
 * "is this pair grandfathered" and the label shown for it.
 *
 * Zero em dashes by convention.
 */
import {
  GRANDFATHERED_FEE_PERCENTAGE as GRANDFATHERED_FEE_PERCENTAGE_PURE,
  resolveFeeRule,
} from "./feeMath.js";
import { PROCURE_SUCCESS_FEE_PCT } from "../config.js";

/**
 * Platform standard fee percentage shown when a pair is NOT grandfathered.
 * Sourced from config (which itself defaults to 5%, overridable via
 * PROCURE_SUCCESS_FEE_PCT); the legacy separate PROCURE_STANDARD_FEE_PCT /
 * 10% default is retired so there is exactly one standard-rate knob.
 */
export const STANDARD_FEE_PERCENTAGE = PROCURE_SUCCESS_FEE_PCT;

export const GRANDFATHERED_FEE_PERCENTAGE = GRANDFATHERED_FEE_PERCENTAGE_PURE;

export const RELATIONSHIP_STATUSES = [
  "no_prior_relationship",
  "existing_relationship_claimed",
  "existing_relationship_under_review",
  "grandfathered_2_percent",
  "standard_fee",
  "disputed",
  "inactive",
] as const;
export type RelationshipStatus = (typeof RELATIONSHIP_STATUSES)[number];

export const EXISTING_RELATIONSHIP_TYPES = [
  "active_contract",
  "active_negotiation",
  "already_working_together",
  "already_selected_or_shortlisted",
  "prior_vendor_relationship",
  "other",
] as const;
export type ExistingRelationshipType = (typeof EXISTING_RELATIONSHIP_TYPES)[number];

export const ADMIN_REVIEW_STATUSES = [
  "not_required",
  "pending_review",
  "approved",
  "rejected",
  "needs_more_info",
] as const;
export type AdminReviewStatus = (typeof ADMIN_REVIEW_STATUSES)[number];

export const FEE_RULE_SOURCES = [
  "developer_checkbox",
  "admin_override",
  "contract_upload",
  "negotiation_proof",
  "legacy_relationship",
  "manual_adjustment",
] as const;
export type FeeRuleSource = (typeof FEE_RULE_SOURCES)[number];

/** Shape we need from a developer_vendor_relationships row to resolve the fee. */
export interface RelationshipFeeInput {
  relationship_status?: string | null;
  grandfathered_fee_eligible?: boolean | null;
  grandfathered_fee_percentage?: number | string | null;
  grandfathered_fee_applies_forever?: boolean | null;
  standard_fee_percentage?: number | string | null;
}

export interface ResolvedFee {
  feePercentage: number;
  grandfathered: boolean;
  source: "grandfathered_2_percent" | "standard";
  appliesForever: boolean;
  label: string;
}

/**
 * Resolve the effective fee for a developer-vendor relationship.
 *
 * Protected logic: a pair is grandfathered ONLY when its relationship_status is
 * exactly 'grandfathered_2_percent' AND grandfathered_fee_eligible is true. In
 * that case the rate is the stored grandfathered_fee_percentage (defaults to 2),
 * and nothing here can promote a non-grandfathered pair or demote a
 * grandfathered one. A null/absent relationship means standard fee.
 *
 * Delegates the pure resolution to feeMath.resolveFeeRule, passing the
 * env-configured platform standard rate so the math stays config-free.
 */
export function resolveFee(rel: RelationshipFeeInput | null | undefined): ResolvedFee {
  return resolveFeeRule(rel, STANDARD_FEE_PERCENTAGE);
}
