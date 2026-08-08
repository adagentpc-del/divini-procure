/**
 * Pure, deterministic validation for company creation. No DB, no IO.
 *
 * The Vendor Agreement checkbox in Onboarding.tsx already disables the
 * client's submit button until checked, but per the platform-standard rule
 * "server is authority" a direct API call must not be able to skip it - the
 * agreement establishes the platform's fee terms (5% capped $25,000, 0.1%
 * infrastructure fee capped $1,500).
 */

export type CompanyCreationInput = {
  kind: string;
  vendorAgreementAccepted?: boolean;
};

export type CompanyCreationValidation = { ok: true } | { ok: false; error: string };

export function validateCompanyCreation(input: CompanyCreationInput): CompanyCreationValidation {
  if (input.kind === "vendor" && input.vendorAgreementAccepted !== true) {
    return { ok: false, error: "Vendor Agreement must be accepted to create a vendor account." };
  }
  return { ok: true };
}
