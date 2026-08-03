/**
 * Pure, deterministic validation for the "Submit to Bidding Marketplace"
 * gate (Divini Procure master build spec section 24). No DB, no IO.
 *
 * Blocking `errors` must all clear before a package can be published.
 * Non-blocking `warnings` are shown to the user but never prevent
 * publication - per the spec's own "do not prevent all bidding if
 * documents are incomplete" rule (section 19), missing scope/documents are
 * warnings, not errors.
 *
 * Zero em dashes by convention.
 */

export type PublishReadinessInput = {
  visibility: string | null;
  bidDueDate: string | null;
  questionDeadline: string | null;
  termsAcknowledged: boolean;
  hasScope: boolean;
  hasDocuments: boolean;
};

export type PublishReadiness = { ready: boolean; errors: string[]; warnings: string[] };

const PUBLISHABLE_VISIBILITIES = new Set([
  "organization_only",
  "selected_team",
  "invite_only",
  "preferred_vendors",
  "qualified_vendors",
  "divini_verified",
  "public_marketplace",
  "private_group",
]);

export function validatePackageForPublish(input: PublishReadinessInput): PublishReadiness {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input.visibility || !PUBLISHABLE_VISIBILITIES.has(input.visibility)) {
    errors.push("Choose a marketplace visibility before publishing (private draft is not a publishable state).");
  }
  if (!input.bidDueDate) {
    errors.push("A bid due date is required.");
  }
  if (input.questionDeadline && input.bidDueDate) {
    const q = new Date(input.questionDeadline).getTime();
    const d = new Date(input.bidDueDate).getTime();
    if (!Number.isNaN(q) && !Number.isNaN(d) && q > d) {
      errors.push("The question deadline must be on or before the bid due date.");
    }
  }
  if (!input.termsAcknowledged) {
    errors.push("You must acknowledge the review and responsibility statement before publishing.");
  }
  if (!input.hasScope) {
    warnings.push("No scope of work or line items have been attached yet - vendors will only see a category and dates.");
  }
  if (!input.hasDocuments) {
    warnings.push("No documents have been attached yet - consider uploading plans, specs, or photos before publishing.");
  }

  return { ready: errors.length === 0, errors, warnings };
}
