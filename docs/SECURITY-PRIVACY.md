# Divini Procure - Security & Privacy Controls

This document describes how Divini Procure separates data, controls document
visibility, protects private pricing, logs access, and restricts sensitive
investment materials. It reflects the controls implemented in the codebase.

## Organization-level data separation

- Every company (developer/buyer, vendor, investor entity) is a separate
  `companies` row. Users are linked to companies through `company_members`.
- All authenticated reads and writes are scoped to the caller's company
  membership. The backend re-derives ownership server-side (for example, a
  developer "owns" a project when they are a member of `buildings.company_id`)
  and never trusts a client-supplied company or owner id.
- Cross-company access is denied by default. A user who is not a member of a
  company cannot read that company's projects, bids, documents, pricing,
  agreements, relationships, programs, or investor data.

## Role-based access

- Roles: developer (buyer), vendor, investor, admin, plus per-project
  stakeholder roles (designer, GC, owner, asset manager, procurement manager,
  read-only) and broker/capital-introducer roles.
- Admin is determined by an allow-list of emails (`ADMIN_ALLOWED_EMAILS`),
  checked on every protected endpoint. Admin status is never client-asserted.
- Project-scoped access (designer/GC dashboards) is granted only to the
  developer company members or to an explicitly assigned stakeholder whose email
  matches the signed-in user.

## Document & material visibility

- Project, bid, and award documents are returned only to parties on the
  relevant project or package (developer, assigned vendor) or to an admin.
- Product/SKU price visibility is enforced per record: `public` (any signed-in
  user), `trade` (any signed-in company), `developer` (buyers only),
  `admin_only` (admins only). Hidden prices are stripped server-side and the
  response carries a `priceHidden` flag.
- Vendor pricing tiers (retail, trade, developer-specific, project-specific,
  contract, volume, preferred, grandfathered, private-admin) enforce visibility
  so a developer never sees another developer's developer-specific pricing, and
  `private_admin` pricing is admin-only.

## Private pricing & internal terms protection

- Internal fee logic, platform margins, referral/rev-share terms, and admin
  notes are never returned to non-permissioned roles.
- Investor-facing views never include internal program financials beyond the
  ranges published on a teaser; teaser endpoints return public-safe fields only.
- Public developer profiles expose only bio, markets, asset classes, completed
  projects, and public opportunities. Subscription, internal notes, fee terms,
  private documents, capital pipeline, and compliance status stay in
  private/internal views.

## Investment material restrictions

- Investment programs are visible to investors only when their status is
  approved/active and the investor passes the program's visibility rule
  (`accredited_only`, `nda_required`, `admin_approved_only`, etc.).
- NDA-gated documents are withheld until a signed `nda_records` row exists for
  that investor and program. Accredited-only materials are withheld from
  non-accredited investors.
- Investor PII (email/phone) is masked from developers until an introduction
  request reaches an approved state; admins always see full records.

## Access logging & audit

- A dedicated `document_access_log` records investment document views.
- Append-only audit logs cover grandfathered-relationship confirmations and
  fee changes (`dvr_audit_log`), change orders (`change_order_audit`), fee-rule
  changes (`fee_rule_audit`), and investment actions including introductions,
  NDA signatures, and program/investor reviews (`investment_audit_log`).
- The admin Audit view unifies these logs into a single feed.

## Compliance posture

- Accreditation, KYC, AML, investor approval, and offering publication are all
  human-gated through admin review. No automated process advances these states.
- Payment authorizations are recorded only; the platform never moves funds.

> This document describes implemented technical controls. It is not legal advice.
> Securities, privacy (GDPR/CCPA), and data-handling obligations should be
> reviewed with qualified legal and compliance counsel before go-live.
