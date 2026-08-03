/**
 * Divini Scope Builder - SCOPE COMPLETENESS SCORE (pure, no IO).
 *
 * Deterministic and fully explainable, same design as pipeline-score.ts: a
 * checklist of specific stored fields, never a generated judgment about
 * whether the scope is "good." Required template fields count for 40 of the
 * 100 points (proportional to how many are answered); the six standard
 * narrative sections split the remaining 60 evenly.
 *
 * Zero em dashes by convention.
 */

export interface ScopeCompletenessInput {
  requiredFieldsTotal: number;
  requiredFieldsAnswered: number;
  siteConditions?: string | null;
  accessRestrictions?: string | null;
  deliveryRequirements?: string | null;
  installRequirements?: string | null;
  exclusions?: string[] | null;
  acceptanceCriteria?: string[] | null;
  changeOrderRules?: string | null;
}

export interface CompletenessFactor {
  code: string;
  label: string;
  missingLabel: string;
  points: number;
  earnedPoints: number;
  met: boolean;
}

export interface CompletenessResult {
  score: number;
  positives: string[];
  missing: string[];
  factors: CompletenessFactor[];
}

const REQUIRED_FIELDS_POINTS = 40;
const SECTION_POINTS = 10; // x6 standard sections = 60

function hasText(v: string | null | undefined): boolean {
  return !!v && v.trim().length > 0;
}
function hasItems(v: string[] | null | undefined): boolean {
  return Array.isArray(v) && v.length > 0;
}

export function scoreScopeCompleteness(input: ScopeCompletenessInput): CompletenessResult {
  const total = Math.max(0, Math.round(input.requiredFieldsTotal || 0));
  const answered = Math.max(0, Math.min(total, Math.round(input.requiredFieldsAnswered || 0)));
  const requiredMet = total === 0 || answered === total;
  const requiredEarned = total === 0 ? REQUIRED_FIELDS_POINTS : Math.round((answered / total) * REQUIRED_FIELDS_POINTS);

  const factors: CompletenessFactor[] = [
    {
      code: "required_fields",
      label: total === 0 ? "No required fields on this template" : `All required fields answered (${answered}/${total})`,
      missingLabel: `Required fields incomplete (${answered}/${total})`,
      points: REQUIRED_FIELDS_POINTS,
      earnedPoints: requiredEarned,
      met: requiredMet,
    },
    {
      code: "site_conditions",
      label: "Site conditions described",
      missingLabel: "Site conditions not described",
      points: SECTION_POINTS,
      earnedPoints: hasText(input.siteConditions) ? SECTION_POINTS : 0,
      met: hasText(input.siteConditions),
    },
    {
      code: "access_restrictions",
      label: "Access restrictions described",
      missingLabel: "Access restrictions not described",
      points: SECTION_POINTS,
      earnedPoints: hasText(input.accessRestrictions) ? SECTION_POINTS : 0,
      met: hasText(input.accessRestrictions),
    },
    {
      code: "delivery_install",
      label: "Delivery/install requirements described",
      missingLabel: "Delivery/install requirements not described",
      points: SECTION_POINTS,
      earnedPoints: hasText(input.deliveryRequirements) || hasText(input.installRequirements) ? SECTION_POINTS : 0,
      met: hasText(input.deliveryRequirements) || hasText(input.installRequirements),
    },
    {
      code: "exclusions",
      label: "Exclusions listed",
      missingLabel: "No exclusions listed",
      points: SECTION_POINTS,
      earnedPoints: hasItems(input.exclusions) ? SECTION_POINTS : 0,
      met: hasItems(input.exclusions),
    },
    {
      code: "acceptance_criteria",
      label: "Acceptance criteria listed",
      missingLabel: "No acceptance criteria listed",
      points: SECTION_POINTS,
      earnedPoints: hasItems(input.acceptanceCriteria) ? SECTION_POINTS : 0,
      met: hasItems(input.acceptanceCriteria),
    },
    {
      code: "change_order_rules",
      label: "Change-order rules described",
      missingLabel: "Change-order rules not described",
      points: SECTION_POINTS,
      earnedPoints: hasText(input.changeOrderRules) ? SECTION_POINTS : 0,
      met: hasText(input.changeOrderRules),
    },
  ];

  let score = 0;
  const positives: string[] = [];
  const missing: string[] = [];
  for (const f of factors) {
    score += f.earnedPoints;
    if (f.met) positives.push(f.label);
    else missing.push(f.missingLabel);
  }

  return { score: Math.max(0, Math.min(100, score)), positives, missing, factors };
}
