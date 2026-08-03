# 52 Compliance

## Legal pages (in the SPA, `src/pages/`)

- `Terms.tsx` - Terms of Service.
- `PaymentPolicy.tsx` - payment / fee policy (the success-fee + grandfathered fee
  framing; "we do not hold funds").
- `NonCircumvention.tsx` - non-circumvention (protects platform-sourced
  introductions from being taken off-platform; ties to the success-fee model).
- `Privacy.tsx` - Privacy Policy.
- `MessagingPolicy.tsx` - messaging policy (`lib/messaging-policy.ts` backs the
  in-app messaging rules; messaging is gated on verification).

> TODO(owner): counsel review of Terms + the policies is still open per the
> go-live runbook (governing law indicated as Florida, liability cap,
> arbitration/class waiver, consumer-protection nuance). Confirm before launch.

## Verification = documentation, not a guarantee

The core compliance posture of the product. The Verified badge means **"documents
collected, checked, and tracked as of [date], expiring [date]"** - it is NOT a
warranty of the vendor's work, license validity, or coverage adequacy.

- Developers retain due-diligence responsibility.
- The platform does not guarantee work quality or coverage.
- This framing is surfaced in-app via `src/components/ComplianceDisclaimer.tsx`
  and must stay consistent with the Terms.

## Credential / insurance handling

- Required credentials: contractor/business license, general liability insurance
  (COI with carrier/limits/expiry), workers comp (where required), trade certs,
  W-9/entity, bonding above a deal-size threshold.
- Expiry is tracked per credential (`vendor_credentials.expires_at`); the system
  flags "expiring soon" and **auto-revokes** Verified on lapse, re-gating the
  vendor until re-upload. This is a developer-protection feature, not just hygiene.
- Required types gated in code: license, gl_insurance, trade_cert
  (`REQUIRED_CREDENTIAL_TYPES` in `lib/verificationGate.ts`).

## Payments / money-transmitter posture

- The platform does **not** custody the construction payments ("we do not hold
  funds"). It records and bills its fee only.
- Intended live setup: **Stripe Connect** so funds settle directly to the vendor
  and the platform takes only the application fee. Until `STRIPE_SECRET_KEY` is
  set, fees accrue/queue and records stay correct.
- This "not a party to the transaction" posture must match the Payment Policy and
  Terms language. See `14_DECISIONS.md` D9.

## Non-circumvention

Because the success fee depends on platform-sourced introductions, the
non-circumvention policy is load-bearing: it discourages parties introduced
through Divini from moving the relationship off-platform to avoid the fee. The
grandfathered path is the honest carve-out for relationships that pre-date Divini.

## iOS / App Store compliance (for the mobile track)

- In-app **account deletion** must be reachable (Apple guideline 5.1.1(v)).
- Privacy manifest `mobile/PrivacyInfo.xcprivacy` declares collected data types
  (all tracking=false) + required-reason API declarations.
- Decide **IAP vs external purchase** for paid placements/subscriptions (Featured,
  Vendor Pro) to avoid rejection. See `IOS-APP-STORE-RUNBOOK.md`.

## Data handling

- Vendor documents are sensitive (licenses, COIs, W-9s). See `51_SECURITY.md` for
  encryption-at-rest and signed-download handling.

> TODO(owner): no formal data-retention / data-subject-request (GDPR/CCPA) process
> is documented. Define retention for vendor docs and a deletion path tied to the
> in-app account deletion requirement.

## SOC 2 readiness checklist (gap analysis, not a certification)

**A SOC 2 report can only be issued by a licensed CPA firm after they audit
the company's actual operation of these controls over a period of time
(Type II) or at a point in time (Type I).** Nothing in this repo, and no
amount of code changes, produces that report. This section is a gap
analysis against the AICPA Trust Services Criteria (2017, as revised
2022) so the business owner knows what's already in place versus what
still needs an organizational decision, a written policy, or a vendor
contract - none of which is something an engineering pass can create on
its own. Scoped to **Security** (the mandatory Common Criteria, CC1-CC9)
plus **Confidentiality**, the two categories relevant to a B2B SaaS
handling vendor credential documents and payment data; Availability,
Processing Integrity, and Privacy are additional categories a company can
choose to add later if a customer contract requires them.

Status key: **[x] built** (real, in the codebase, cite the evidence) -
**[~] partial** (some technical control exists, but the criterion also
needs a written policy/process this repo cannot supply) - **[ ] owner
action** (organizational/HR/legal work with no code component at all).

**CC1 - Control environment.** Nearly entirely organizational.
- [ ] Written code of conduct / ethics policy, board or management
  oversight structure, org chart, HR policies (hiring, termination,
  background checks). None of this exists in a codebase by nature - it's
  a company-formation and HR task.

**CC2 - Communication and information.**
- [~] Internal: this `AI_PROJECT_OS/` doc set (architecture, security
  posture, decisions log) is real, current system-description evidence,
  which is more than most startups have - but SOC 2 wants it reviewed and
  formally versioned/approved, not just kept current by an engineering
  agent.
- [x] External: `Terms.tsx`, `Privacy.tsx`, `PaymentPolicy.tsx`,
  `NonCircumvention.tsx`, `MessagingPolicy.tsx` communicate commitments to
  users and are live in the product.
- [ ] A whistleblower/incident-reporting channel for employees is not
  something a codebase provides.

**CC3 - Risk assessment.**
- [~] This session's dependency scan + two-agent security/legal audit
  (see the "(14)" changelog entry) is a real, evidenced one-time risk
  assessment - but SOC 2 wants a *recurring, scheduled* risk assessment
  process with a documented risk register and management sign-off, not a
  single pass.
- [ ] Formal fraud-risk consideration (a specific SOC 2 requirement) is
  unaddressed.

**CC4 - Monitoring activities.**
- [x] `.github/workflows/ci.yml` runs typecheck + the full test suite
  (163 tests) on every push/PR - real, automated, continuous evidence.
- [x] `npm audit --omit=dev` now runs on every CI push/PR (`ci.yml`),
  report-only (does not fail the build, since one currently-unfixable
  advisory - see the changelog - would otherwise block every merge).
- [x] `.github/dependabot.yml` now opens weekly update PRs for both npm
  manifests (root SPA/desktop/mobile, `server/`) and GitHub Actions
  versions - the actual recurring, automatic remediation loop CC4/CC7
  are asking for, not just a report someone has to remember to read.
- [ ] No centralized log aggregation, alerting, or error monitoring
  (Sentry-style) exists - already flagged as a TODO in `51_SECURITY.md`.
  Without it there is no way to *detect* a control failure in near-real
  time, which is what CC4 is actually asking for.

**CC5 - Control activities.**
- [x] Rate limiting (`lib/rateLimit.ts`), input validation, and
  parameterized queries throughout are real technical control activities.
- [ ] SOC 2 also wants these written down as formal policies (an access
  control policy, a change management policy, an incident response
  policy) that employees are trained on and attest to - documents, not
  code.

**CC6 - Logical and physical access controls.** The strongest category by
far, per this session's security audit:
- [x] Passwords hashed with scrypt + `timingSafeEqual` comparison
  (`lib/passwordHash.ts`, `lib/native-auth.ts`).
- [x] Sessions are httpOnly/Secure(prod)/SameSite=Lax cookies, server-side
  revocable, with all sessions revoked on password reset.
- [x] Admin authority is server-side only (`ADMIN_ALLOWED_EMAILS`), never
  baked into the shipped SPA bundle.
- [x] CORS allowlist that fails closed (denies cross-origin) in
  production when unset; no wildcard-plus-credentials misconfiguration.
- [x] Every spot-checked resource route enforces company-level ownership
  before returning or modifying data (IDOR checks confirmed, e.g. the
  signed-download-URL endpoint).
- [x] TLS/HTTPS enforced (`ssl` on the DB pool in prod; HSTS via helmet).
- [x] Server-side fetches of user-supplied URLs go through an SSRF guard
  (`lib/safe-fetch.ts`) rather than fetching arbitrary user input directly.
- [~] Encryption at rest for uploaded files is real (AES-256-GCM,
  `lib/storageCrypto.ts`) but **opt-in**, off unless
  `STORAGE_ENCRYPTION_KEY` is set. An auditor will ask why it isn't the
  default; that's an operational decision for the environment owner, not
  something this pass will silently flip on (see `51_SECURITY.md`).
- [ ] **Physical access controls** are entirely the cloud/database host's
  responsibility, not this app's. SOC 2 handles this via a "complementary
  user entity controls" reference to the host's own SOC 2 report (e.g.
  AWS/GCP/Azure, or the managed Postgres provider) - get that report on
  file, don't try to reproduce it.

**CC7 - System operations.**
- [x] CI runs the test suite on every change (see CC4).
- [~] Scan cadence now exists (weekly, via Dependabot + CI's `npm audit`
  step) - but severity SLAs and a written patch-or-accept-risk decision
  log still don't. This session's own triage (upgrade react-router,
  accept the Capacitor/Electron dev-tooling risk, document why) is a
  worked example of what that decision log should look like going
  forward; it needs to become a habit, not a one-time pass.
- [ ] No written incident response plan (who's notified, escalation
  path, customer notification timeline - note Florida's 30-day breach
  notification law is already honored in `Privacy.tsx`, but that's a
  disclosure commitment, not an internal IR runbook).
- [ ] No capacity/availability monitoring or on-call process documented.

**CC8 - Change management.**
- [x] All changes go through git with a real commit history; CI
  typechecks and tests every push/PR (`ci.yml`).
- [ ] No branch-protection rule requiring review before merge is visible
  from the repo (no `CODEOWNERS`, and branch protection is a GitHub
  *repository setting*, not a file - the owner should enable "require PR
  review before merge" on the default and release branches).
- [ ] No documented deployment-approval or rollback procedure.

**CC9 - Risk mitigation (vendor/subprocessor management).**
- [~] Real subprocessors are named in `Privacy.tsx` (Stripe for payments;
  infrastructure providers for hosting/storage; an optional LLM provider
  for AI-assisted drafting) - a good start.
- [ ] No formal subprocessor register with each vendor's own compliance
  attestation on file (e.g. Stripe's SOC 2/PCI reports), and no business
  continuity / disaster recovery plan documented.

**Confidentiality (additional category, relevant given vendor credential
docs and payment data).**
- [x] Data-in-transit encryption, access-control gating on documents, and
  the opt-in at-rest encryption path described above.
- [~] A data classification scheme (what's "confidential" vs "internal"
  vs "public," and handling rules for each) is implied by the code but
  not written down anywhere as policy.
- [ ] No documented secure-disposal or data-retention schedule for
  vendor credential documents once a relationship ends (flagged already
  above as an open TODO).

**Bottom line for the owner:** the technical foundation (CC6, and most of
CC4/CC7's automatable parts) is genuinely stronger than most companies
at this stage have, and this session closed some real gaps in it. What's
left is almost entirely written policy, HR process, vendor paperwork, and
picking an actual CPA firm to audit against these criteria - none of
which a coding pass can manufacture. A Type I report (design of controls
at a point in time) is realistic to pursue once the `[ ]` items above are
addressed; Type II (operating effectiveness over 3-12 months) requires
those controls to have actually been running for that observation window
first.
