/**
 * Built-in agreement templates for Divini Procure.
 *
 * Each template has a stable `key`, a display `name`, a `kind` (a grouping
 * hint), and a `body` containing {{placeholders}} that are filled in at
 * creation time via renderTemplate(key, vars). Admins can also author custom
 * templates which are stored in the agreement_templates table and take
 * precedence when keys collide (the route layer merges db + built-in).
 *
 * Placeholders commonly used:
 *   {{party_name}}      issuing company (developer/buyer or vendor)
 *   {{developer_name}}  the developer / buyer company
 *   {{vendor_name}}     the vendor company
 *   {{project_name}}    the building / project, when attached
 *   {{counterparty}}    counterparty email or name
 *   {{date}}            the date the agreement is generated
 *
 * Zero em dashes by convention.
 */

export interface BuiltinTemplate {
  key: string;
  name: string;
  kind: string;
  body: string;
}

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    key: "developer_platform",
    name: "Developer Platform Agreement",
    kind: "platform",
    body: [
      "DEVELOPER PLATFORM AGREEMENT",
      "",
      "This Developer Platform Agreement is entered into on {{date}} between Divini Procure and {{developer_name}} (the Developer).",
      "",
      "1. Access. The Developer is granted access to the Divini Procure platform to publish procurement packages, invite vendors, and manage awards for its projects, including {{project_name}}.",
      "2. Platform Fee. A platform processing fee applies to transactions facilitated through Divini Procure as set out in the Developer's then-current fee schedule, unless a specific written exception applies.",
      "3. Conduct. The Developer agrees to use the platform in good faith, to provide accurate project and award information, and not to circumvent vendors introduced through Divini Procure.",
      "4. Term. This agreement remains in effect until terminated by either party in writing.",
      "",
      "Agreed and accepted by {{party_name}} on {{date}}.",
    ].join("\n"),
  },
  {
    key: "vendor_participation",
    name: "Vendor Participation Agreement",
    kind: "vendor",
    body: [
      "VENDOR PARTICIPATION AGREEMENT",
      "",
      "This Vendor Participation Agreement is entered into on {{date}} between Divini Procure and {{vendor_name}} (the Vendor).",
      "",
      "1. Participation. The Vendor may receive and respond to procurement packages, submit quotes, and be awarded work through Divini Procure.",
      "2. Accuracy. The Vendor agrees that all credentials, pricing, and submissions are accurate and current.",
      "3. Fees. A platform processing fee applies to awards facilitated through Divini Procure as set out in the Vendor's then-current fee schedule.",
      "4. Non-Circumvention. The Vendor agrees not to circumvent developers introduced through Divini Procure for the duration of, and a reasonable period after, any engagement.",
      "",
      "Agreed and accepted by {{party_name}} on {{date}}.",
    ].join("\n"),
  },
  {
    key: "preferred_vendor",
    name: "Preferred Vendor Agreement",
    kind: "vendor",
    body: [
      "PREFERRED VENDOR AGREEMENT",
      "",
      "This Preferred Vendor Agreement is entered into on {{date}} between {{developer_name}} (the Developer) and {{vendor_name}} (the Vendor) through Divini Procure.",
      "",
      "1. Status. The Vendor is designated a preferred vendor for the Developer, including for the project {{project_name}}, and may receive priority invitations to relevant procurement packages.",
      "2. Standards. The Vendor agrees to maintain the quality, responsiveness, and pricing standards expected of a preferred vendor.",
      "3. Non-Exclusivity. This designation is non-exclusive unless otherwise agreed in writing.",
      "",
      "Agreed and accepted by {{party_name}} on {{date}}.",
    ].join("\n"),
  },
  {
    key: "referral_fee",
    name: "Referral Fee Agreement",
    kind: "commercial",
    body: [
      "REFERRAL FEE AGREEMENT",
      "",
      "This Referral Fee Agreement is entered into on {{date}} between Divini Procure and {{party_name}}.",
      "",
      "1. Referral. The parties agree that a referral fee is payable in respect of qualifying introductions made through Divini Procure.",
      "2. Calculation. The referral fee, its rate, and the qualifying events are as set out in the accompanying fee schedule or written correspondence.",
      "3. Payment. Referral fees are payable upon the occurrence of the qualifying event and reconciliation by Divini Procure.",
      "",
      "Agreed and accepted by {{party_name}} on {{date}}.",
    ].join("\n"),
  },
  {
    key: "non_circumvention",
    name: "Non-Circumvention Agreement",
    kind: "protective",
    body: [
      "NON-CIRCUMVENTION AGREEMENT",
      "",
      "This Non-Circumvention Agreement is entered into on {{date}} between Divini Procure and {{party_name}}.",
      "",
      "1. Non-Circumvention. {{party_name}} agrees not to circumvent, avoid, bypass, or obviate Divini Procure, directly or indirectly, to avoid payment of fees or to deal directly with any developer, vendor, or counterparty introduced through the platform, including {{counterparty}}.",
      "2. Duration. This obligation applies during any engagement and for a reasonable period afterward.",
      "3. Remedies. A breach entitles Divini Procure to recover the fees that would have been payable plus reasonable costs.",
      "",
      "Agreed and accepted by {{party_name}} on {{date}}.",
    ].join("\n"),
  },
  {
    key: "nda",
    name: "Non-Disclosure Agreement",
    kind: "protective",
    body: [
      "MUTUAL NON-DISCLOSURE AGREEMENT",
      "",
      "This Mutual Non-Disclosure Agreement is entered into on {{date}} between {{party_name}} and {{counterparty}}.",
      "",
      "1. Confidential Information. Each party may disclose confidential information to the other in connection with procurement activity on Divini Procure, including in respect of {{project_name}}.",
      "2. Use. Each party agrees to use the other's confidential information solely to evaluate and perform the contemplated engagement and to protect it with reasonable care.",
      "3. Exclusions. Information that is public, independently developed, or rightfully received from a third party is not confidential.",
      "4. Term. Confidentiality obligations survive for a period customary for the industry.",
      "",
      "Agreed and accepted by {{party_name}} on {{date}}.",
    ].join("\n"),
  },
  {
    key: "payment_authorization",
    name: "Payment Authorization",
    kind: "commercial",
    body: [
      "PAYMENT AUTHORIZATION",
      "",
      "This Payment Authorization is provided on {{date}} by {{party_name}} in connection with procurement on Divini Procure.",
      "",
      "1. Authorization. {{party_name}} authorizes Divini Procure to facilitate and process payments for awarded work, including for the project {{project_name}}, and to apply the applicable platform processing fee.",
      "2. Fee. The platform processing fee is as set out in the applicable fee schedule, subject to any grandfathered or written exception that applies to a specific developer-vendor relationship.",
      "3. Records. {{party_name}} agrees the payment records maintained by Divini Procure are an accurate account of authorized transactions.",
      "",
      "Agreed and accepted by {{party_name}} on {{date}}.",
    ].join("\n"),
  },
  {
    key: "grandfathered_2pct_acknowledgment",
    name: "Grandfathered 2% Fee Acknowledgment",
    kind: "commercial",
    body: [
      "GRANDFATHERED 2% FEE ACKNOWLEDGMENT",
      "",
      "Between {{developer_name}} (Developer) and {{vendor_name}} (Vendor), acknowledged on {{date}} through Divini Procure.",
      "",
      "This developer-vendor relationship has been identified as a pre-existing relationship prior to onboarding through Divini Procure. For this specific developer-vendor relationship only, the payment authorization/platform processing fee is grandfathered at 2% unless modified by written agreement or administrative correction due to error, fraud, or misrepresentation.",
      "",
      "Acknowledged and accepted by {{party_name}} on {{date}}.",
    ].join("\n"),
  },
];

/** A lookup of built-in templates by key. */
const BY_KEY: Record<string, BuiltinTemplate> = Object.fromEntries(
  BUILTIN_TEMPLATES.map((t) => [t.key, t]),
);

export function getBuiltinTemplate(key: string): BuiltinTemplate | null {
  return BY_KEY[key] ?? null;
}

/** Replace {{placeholder}} tokens in a body with provided values. Unknown
 *  tokens are left blank rather than printed literally. */
export function fillPlaceholders(body: string, vars: Record<string, string | null | undefined>): string {
  return body.replace(/\{\{\s*([\w]+)\s*\}\}/g, (_m, name: string) => {
    const v = vars[name];
    return v == null ? "" : String(v);
  });
}

/**
 * Render a built-in template by key into a finished body string. Returns null
 * if the key is not a known built-in (the caller may have a db template, or an
 * explicit body). vars supply the placeholder values.
 */
export function renderTemplate(
  key: string,
  vars: Record<string, string | null | undefined>,
): string | null {
  const t = getBuiltinTemplate(key);
  if (!t) return null;
  return fillPlaceholders(t.body, vars);
}
