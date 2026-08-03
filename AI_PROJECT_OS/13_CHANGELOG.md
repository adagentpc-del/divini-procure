# 13 Changelog

Append new entries at the top. Each entry: what, why, files, risks, next.
(The repo also has a separate `CHANGES.md`, but it is stale: it still describes
the Authentik/Supabase era and does not reflect Monetization V2.)

---

## 2026-08-03 (16) - Full launch-readiness audit: found by actually running the app

**What.** A "full audit — copy, functionality, everything" request, done by
actually exercising the app rather than re-reading code: dropped and
recreated a local Postgres database from `db/apply-all.sql`, built and
started the real compiled server against it, and drove real browser
sessions (Playwright) through registration, email verification, the full
3-step onboarding, and the dashboard for both buyer and vendor company
kinds. This is the first time this session (and evidence suggests possibly
ever) that path was exercised end to end rather than validated only by
typecheck and the unit test suite.

**Findings, in the order they were hit, all fixed and re-verified:**

1. **`npm run build` failed outright.** It's `tsc && vite build`; ten
   pre-existing `PartnerOnboarding.tsx` typecheck errors (noted every prior
   entry this session as "unrelated") in fact blocked the production
   bundle from ever being produced. Real bugs, not noise: `useToast()`
   returns an object, not a callable function, and two `apiSend()` calls
   omitted the required HTTP-method argument.
2. **`db/apply-all.sql` could not bootstrap a fresh database at all** - 23
   errors. Splice-ordering bugs (a table referenced before the file that
   creates it) plus, more seriously, **13 entire schema-*.sql files that
   were never included in the combined file in the first place**,
   including the Florida E-SIGN Act consent columns on `users` (breaking
   registration itself), `user_sessions` (breaking email verification),
   and the tables backing Stripe billing, CAN-SPAM unsubscribe, COI
   tracking, Dispute Center, Lender Portal, and Retainage - each a fully
   routed, completely broken feature. Two type-mismatch bugs found and
   fixed along the way (`uuid` vs `text` FK columns in two directions).
   Verified: 0 errors, 159 tables (was 146), on a from-scratch reapply.
3. **The server crashed on every real startup** (not caught by
   `tsc --noEmit`, which never actually runs the module graph): a circular
   import between `db.ts` and `lib/entitlement-guard.ts` hit a JS
   temporal-dead-zone error the instant a class tried to extend another
   class before it had finished being defined. Fixed by extracting the
   shared error classes into a new dependency-free `lib/errors.ts`.
4. **The registration form silently failed to submit, three different
   ways, stacked on top of each other**: the cookie-consent banner
   overlapped and blocked the submit button (confirmed via Playwright's
   actionability check, not just a visual read); an anti-bot timing gate
   silently rejected any submission within 1.5 seconds of page render with
   zero user feedback (breaks browser-autofill users, a completely
   ordinary flow); and the CSP didn't allowlist the Google Fonts domains,
   so the branded typography used on every page had been silently falling
   back to system fonts in every real browser, all session.
5. **Vendor signups via a direct `/register?role=vendor` link silently
   became buyer accounts** - Register.tsx never read or forwarded the
   `?role=` hint (only Pricing.tsx's own buttons stash it to localStorage
   first). Fixed by stashing the hint on mount in Register.tsx too.
6. **The vendor dashboard never showed real bid-credit or verification
   status** - both reads omitted the `companyId` the backend requires,
   silently swallowed by design ("fail open, don't block the UI"). Not a
   security hole (the real bid-submission endpoint enforces both
   independently, confirmed server-side) but a real, invisible UX gap.
7. **Investigated and deliberately left unfixed, documented instead**:
   `db/schema-rls.sql` defines real Postgres Row-Level Security policies,
   but the app never calls the `set_config('app.user_id', ...)` they
   require, and the file never enables RLS either - including it would
   create false confidence in protection that doesn't exist. Left out of
   the bootstrap file for a deliberate follow-up pass instead.

**Copy.** No new full pass - the two earlier passes this session (entries
13 and 14) already covered the site broadly. This pass added: a scan for
leftover placeholder/TODO text (none found) and a static-link check (no
orphaned routes found), plus live confirmation that onboarding, dashboard,
and vendor-agreement copy all render correctly against the now-fixed real
app.

**Conversion rate benchmark.** No live traffic exists yet, so this is a
structural assessment against public SaaS/marketplace CRO benchmarks, not
a measurement - delivered as a published report (see Deliverable) rather
than a fabricated number. Overall structural read: 3 of 5 - solid
fundamentals (clear value prop, transparent pricing, lean signup form) and
several real conversion-killing bugs just removed, with the remaining
gap being real analytics this site doesn't have yet, not additional
guesswork.

**Deliverable.** A published report artifact (Divini Procure - Launch
Readiness Audit) covering all of the above with severity-coded findings,
a before/after scorecard, and the conversion-funnel benchmark table.

**Files.** `src/pages/PartnerOnboarding.tsx`, `db/apply-all.sql`,
`db/schema-scope-builder.sql`, `db/schema-follow-up-desk.sql`,
`db/schema-quick-hits.sql`, `db/schema-sessions.sql`,
`db/schema-stripe-billing.sql`, `server/src/db.ts`,
`server/src/lib/errors.ts` (new), `server/src/lib/entitlement-guard.ts`,
`server/src/app.ts`, `src/components/CookieBanner.tsx`,
`src/pages/Register.tsx`, `src/lib/monetization.ts`,
`src/pages/Dashboard.tsx`, `src/pages/PackageDetail.tsx`.

**Tests completed.** Every fix in this entry was verified against the real
running stack, not just typecheck/unit tests: a from-scratch database
reapply after each schema change, a rebuilt-and-restarted server after
each server-side change, and a fresh Playwright browser session re-run
after each frontend change - including two full registration-through-
dashboard runs (buyer and vendor) with zero API errors at the end. `npx
tsc --noEmit` clean on both SPA and server (first time all session with
zero errors, including the previously-ignored PartnerOnboarding.tsx
ones), `npm test` 163/163 throughout.

---

## 2026-08-03 (15) - Automated WCAG scan + SOC 2 readiness checklist

**What.** Two follow-ups to entry (14): a proper automated accessibility
scan (axe-core, the tool auditors and plaintiffs' experts actually use -
not just the manual keyboard-nav check from entry 14), and a SOC 2
readiness gap analysis.

**WCAG scan.** Ran axe-core (WCAG 2.0/2.1 A+AA ruleset) via Playwright
against the Vite dev server across all 14 public, unauthenticated pages
(the highest-exposure surface for ADA claims). First pass found real
issues on 8 of 14 pages; after fixes, 13 of 14 pages are fully clean and
the 4 remaining flags on the last one are confirmed false positives (see
below) - not left unresolved.

- **A genuine bug, not just an accessibility nit**: `Landing.tsx`'s
  "Vendors" animated demo list had an actually-invisible list item. Its
  highlight keyframe (`hl4`) paired white text with a background at only
  18% opacity, so the highlighted item's text was white-on-cream with a
  contrast ratio of 1.16:1 - unreadable by anyone, not just screen-reader
  or low-vision users. Confirmed with a before/after screenshot. Root
  cause: the sibling keyframe for the other demo list (`hl5`) does this
  correctly (opaque background, dark text); `hl4` just had the wrong
  values. Fixed to match the working pattern.
- Six legal pages (Privacy, Terms, PaymentPolicy, NonCircumvention,
  Cookies, Accessibility) shared two issues: an "Effective [date]" line
  at 3.93:1 contrast (needs 4.5:1) and inline links distinguished from
  surrounding text by color alone. Fixed the gray to 4.9:1 and added
  underline to every inline link across all six pages uniformly (not
  just the ones flagged this pass, since the same pattern will keep
  recurring as these pages are edited).
- A near-miss pill component on Landing.tsx (4.39:1, needs 4.5:1) and
  two unlabeled `<select>` filters plus their sibling `<input>`s on the
  public `/opportunities` page (critical: screen-reader users had no way
  to know what the controls did) were fixed with a slightly darker color
  and `aria-label`s respectively.
- **Investigated and deliberately left unchanged**: 4 remaining flags on
  Landing.tsx's hero (heading, eyebrow badge, CTA button, trust line).
  These render as white text over an autoplaying video with a dark
  gradient scrim - confirmed via screenshot to have excellent real
  contrast. axe-core's contrast check walks the DOM ancestor chain for
  background color and can't see CSS backgrounds painted by
  absolutely-positioned sibling elements (the video/scrim are siblings of
  the text's container, not ancestors) - a documented false-positive
  pattern for this common "background layer" CSS technique. "Fixing" the
  text color based on the tool's number would have made it unreadable
  against the actual rendered background.

**SOC 2 readiness checklist.** Added a gap analysis to
`AI_PROJECT_OS/52_COMPLIANCE.md` against the AICPA Trust Services
Criteria (Security's CC1-CC9, plus Confidentiality), framed explicitly as
prep work, not a certification - only a licensed CPA firm can issue a
SOC 2 report. Maps what's already built (with file-level evidence: scrypt
password hashing, IDOR checks, CORS allowlist, parameterized SQL, the SSRF
guard, etc.) against what's still a written-policy/HR/vendor-contract gap
no code change can supply (code of conduct, incident response plan,
background checks, a subprocessor register). Closed two of its own
findings with real automation instead of just noting them:
- `ci.yml` now runs `npm audit --omit=dev` on every push/PR, report-only
  (a hard-fail gate would block every merge on one currently-unfixable,
  inapplicable react-router advisory - see entry 14).
- `.github/dependabot.yml` now opens weekly update PRs for both npm
  manifests and GitHub Actions versions - a real, recurring, automatic
  remediation loop, not a one-time manual scan someone has to remember to
  repeat.

**Files.** `.github/workflows/ci.yml`, `.github/dependabot.yml` (new),
`AI_PROJECT_OS/52_COMPLIANCE.md`, `src/pages/Landing.tsx`,
`src/pages/Privacy.tsx`, `src/pages/Terms.tsx`,
`src/pages/PaymentPolicy.tsx`, `src/pages/NonCircumvention.tsx`,
`src/pages/Cookies.tsx`, `src/pages/Accessibility.tsx`,
`src/pages/PublicOpportunities.tsx`.

**Tests completed.** `npx tsc -p tsconfig.json --noEmit` and
`npx tsc -p server/tsconfig.json --noEmit` (clean, same pre-existing
unrelated `PartnerOnboarding.tsx` errors as every prior entry), `npm test`
(163/163), and a full before/after axe-core re-scan of all 14 pages
confirming the fixes actually resolved the flagged violations (not just
inspected by eye) - the re-scan is the artifact that turns "I made
changes I believe are correct" into "I verified the specific automated
findings that motivated this pass are gone."

---

## 2026-08-03 (14) - Security and legal-compliance scan: dependency fix, ADA keyboard accessibility, false-claim fixes

**What.** A dependency vulnerability scan plus two background OWASP-style
security and legal-compliance audits, followed by fixing everything real
that turned up. Framed honestly at the outset and worth repeating here:
SOC 2 and ISO 27001 are third-party audit certifications, not something a
code pass grants, and nothing here is a guarantee against complaints or
lawsuits - it materially reduces concrete, checkable risk.

**Dependency scan.**
- Upgraded `react-router-dom` 6.30.4 -> 7.18.2, fixing three real
  advisories that apply to this app's actual usage (classic `<Link>` /
  `useNavigate`, not the newer data-router APIs): an open redirect via
  backslash in `<Link>`/`useNavigate` (GHSA-wrjc-x8rr-h8h6), an open
  redirect leading to XSS (GHSA-jjmj-jmhj-qwj2), and arbitrary
  constructor injection via SSR hydration error deserialization
  (GHSA-337j-9hxr-rhxg). Verified with a clean typecheck, the full test
  suite, and a Playwright smoke test confirming client-side `<Link>`
  navigation still works with no full page reload.
  - A newly-surfaced advisory in the same package family
    (GHSA-qwww-vcr4-c8h2, an RSC-mode CSRF bypass) does NOT apply and was
    left unfixed on purpose: this app has zero React Router
    framework-mode/Server Actions usage (confirmed: no loaders, actions,
    or fetchers anywhere in `src/`), and no fix is available regardless -
    `react-router-dom` has not published a v8 to pick up the underlying
    `react-router@8.3.0` fix. Documented here to revisit when it does.
- Left ~15 vulnerabilities (including one critical, in `tar`) in the
  Capacitor mobile-build and Electron desktop-build devDependency trees
  as accepted risk: these are build-time tooling, never shipped to or
  reachable by an end user of the live product, and a blind
  `npm audit fix --force` on them pulled in a 3,700+ line unrelated
  lockfile resync that was reverted rather than committed blindly.
- `exceljs`'s transitive `uuid` moderate vulnerability (server) remains
  the previously-documented accepted risk from an earlier session - no
  fix exists without a breaking downgrade of exceljs itself.

**Security audit (background agent, OWASP Top 10 style).** The codebase
was already largely solid: parameterized SQL everywhere (no string-built
queries), scrypt + `timingSafeEqual` password hashing, httpOnly/Secure/
SameSite session cookies, `helmet` with a real CSP and CORS allowlist (no
wildcard-plus-credentials), IDOR checks on every spot-checked resource
route, no `dangerouslySetInnerHTML` anywhere, and no mass-assignment
(every dynamic `UPDATE ... SET` builder uses an explicit field allowlist).
Two real, low-severity gaps found and fixed:
- `POST /auth/reset` had no dedicated rate limiter (only the blanket
  20/min `/api/auth` limiter). Added `resetPasswordRateLimit` (10 per IP
  per 15 min) - defense in depth, since reset tokens are 32-byte random
  hex and brute force was already impractical.
- `GET /public/subscription-tiers` (added last session for the public
  Pricing page) had zero rate limiting, unlike the comparable public
  lookup endpoints. Added the existing `inviteLookupRateLimit`.
- Documented, not changed: CSRF protection relies on `SameSite=Lax` alone
  with no double-submit token, judged adequate since no state-changing
  route is reachable via a top-level GET; CSP's `style-src` allows
  `unsafe-inline` for CSS-in-JS, a known and accepted tradeoff.

**Legal/compliance audit (background agent).**
- **ADA Title III - ADA nav items were keyboard-invisible (fixed).**
  `Landing.tsx`, `Pricing.tsx`, and `SuperAdminDashboard.tsx` had
  navigation rendered as `<a>`/`<div>` elements with an `onClick` handler
  but no `href`, `role`, or `tabIndex` - invisible to the keyboard tab
  order and unusable by screen-reader users, which is exactly the pattern
  targeted by ADA Title III demand letters. Real navigation now uses
  `<Link>`, the sign-out action uses a real `<button>`, and the
  scroll-to-section anchors got real `href="#..."` targets with the
  smooth-scroll JS as progressive enhancement on top. Verified with
  Playwright: the link is keyboard-focusable and activates on Enter.
- **Overstated "verified" vendor claims (fixed, was the audit's
  highest-priority finding).** `Landing.tsx` and `Pricing.tsx` stated
  flatly that vendors are "license and insurance verified" and even
  "verified against public records." `AdminVerification.tsx` confirms
  this is actually a manual admin review of documents the vendor
  uploads, not an automated registry check or a guarantee - a developer
  relying on the unqualified marketing claim who is later harmed by an
  actually-unlicensed vendor has a real negligent-misrepresentation
  argument. Added an accurate qualifier next to the claims and in the
  "How are vendors verified?" FAQ.
- **A false "encrypted at rest" claim (fixed).** Found while verifying
  the item above: `Landing.tsx`'s FAQ claimed "all data is encrypted in
  transit and at rest." Checked the actual infrastructure code, not just
  the page copy: object-storage encryption is opt-in and off by default
  (`STORAGE_ENCRYPTION_KEY` unset means files are stored as plaintext),
  and database at-rest encryption is entirely dependent on whichever
  managed Postgres host is used - the application has no control over or
  visibility into it. This is exactly the kind of claim that turns into
  an FTC/state-UDAP deception claim after a breach. Corrected to only
  claim what's actually true (in-transit TLS, password hashing, access
  controls).
- **A non-functional "reply to unsubscribe" claim (fixed).** The generic
  transactional-email footer (`server/src/lib/email.ts`) told recipients
  to "reply with Unsubscribe in the subject line," but no inbound-email
  automation exists anywhere in the codebase to act on that - the
  campaign system's real one-click unsubscribe (`server/src/routes/
  campaigns.ts`) is separate infrastructure this generic footer never
  used. Replaced with an accurate description: email support@, a
  human-monitored inbox that already handles account/privacy requests
  elsewhere in the app.
- **Global Privacy Control mention added** to `Privacy.tsx`'s state
  privacy-rights section - newer state laws (e.g. Colorado's CPA) expect
  GPC signal recognition; practical effect is nil today since the app
  doesn't sell or share data, but the policy now says so.
- **Checked, no gap found, nothing changed:** Terms/Privacy acceptance is
  already a proper clickwrap flow (`Register.tsx` disables submit until
  an unchecked-by-default checkbox is checked); no third-party analytics
  or tracking scripts exist anywhere to disclose; a dedicated
  `/accessibility` statement with a real accommodation contact already
  exists (`Accessibility.tsx`).

**Not done, flagged for the business/legal owner rather than guessed at:**
whether to make storage-at-rest encryption mandatory-by-default (currently
opt-in; flipping the default is an infra/ops decision with deployment
implications, not a legal requirement under current US law, which
generally asks for "reasonable" security rather than mandating a specific
control); whether a CSRF double-submit token is worth adding as
defense-in-depth beyond `SameSite=Lax`; any state-specific licensing,
lien-law, or money-transmission questions beyond what Terms/Payment
Policy/Non-Circumvention already disclaim.

**Files.** `package.json`, `package-lock.json`,
`server/src/lib/email.ts`, `server/src/lib/rateLimit.ts`,
`server/src/routes/auth-native.ts`, `server/src/routes/subscriptions.ts`,
`src/pages/Landing.tsx`, `src/pages/Pricing.tsx`, `src/pages/Privacy.tsx`,
`src/pages/dashboards/SuperAdminDashboard.tsx`.

**Tests completed.** `npx tsc -p tsconfig.json --noEmit` and
`npx tsc -p server/tsconfig.json --noEmit` (both clean, aside from the
same pre-existing unrelated `PartnerOnboarding.tsx` errors noted in prior
entries), `npm test` (163/163, unchanged - no test files touched), and a
manual Playwright smoke test against the Vite dev server confirming: SPA
navigation works post-react-router-upgrade with no full reloads, the new
`Link`-based nav items are keyboard-focusable and Enter-activate, and the
new verification-qualifier copy renders on both Landing and Pricing with
zero console page errors.

---

## 2026-08-03 (13) - Copy audit: fee figures, Capital Partner terminology, AI/OCR disclosures, real plan data everywhere

**What.** A full copy pass across pages, FAQs, and legal policies to bring
every page in line with what was actually built this session (the Divini
tool suite, the Capital Partner rename, the real tiered fee structure, the
subscription/entitlement engine, and the real PDF/OCR/DXF content
extraction). Scoped by first running a read-only audit to find every
stale or inconsistent reference rather than guessing, then triaging: real
bugs first, terminology second, legal accuracy third, marketing gaps
fourth.

- **Two more fake-data bugs fixed (same class as the Dashboard bug in
  entry 12)**: `Profile.tsx` showed a hardcoded "Plan: Vendor - Beta,
  $100/mo first 2 months 50% off, Bids: Unlimited, Billing via PayPal" and
  "1 of 1 seat used" for every company, never wired to the entitlements
  engine and shown only for vendors. Replaced with real data from
  `GET /subscriptions/mine`, a "Manage plan" link to `/subscription`, and
  now shown for every company kind, not just vendors.
- **A factually wrong infrastructure claim fixed in `Privacy.tsx`**: the
  policy named Supabase (database/file storage) and Vercel (hosting) as
  data processors. This codebase migrated off Supabase to native
  Postgres/Express with pluggable object storage long before this session
  (confirmed via the session's own auth model, the `STORAGE_PROVIDER` env
  var, and `CHANGES.md`'s own note that it's stale). Replaced with an
  accurate, appropriately generic description, and added a new "Automated
  document processing" section disclosing the real PDF-text/OCR/DXF
  extraction and AI-assisted drafting built earlier this session,
  including an explicit "we do not use the content of your documents to
  train any AI model" statement (accurate: OCR/PDF extraction run locally,
  and the LLM step only ever receives classification labels/counts and
  user-typed text, never raw file content).
- **A fabricated statistic removed from `TrustProfile.tsx`**: a "~38% of
  sponsors share a full-cycle track record" claim with no data source
  behind it, replaced with a plain, honest sentence about why a full-cycle
  track record matters.
- **"Investor" renamed to "Capital Partner" in remaining user-facing text**
  (`TrustProfile.tsx`, `PublicDeveloperProfile.tsx`,
  `OnboardingChecklist.tsx`, `MessagingPolicy.tsx`, and the rendered
  `reason`/`rule` strings in `server/src/lib/messaging-policy.ts`) -
  internal role keys and DB values (`company.kind === 'investor'`,
  `investor_profiles`, the `MessagingRole` type) are unchanged by design,
  matching the established rename convention from earlier this session.
- **Legal pages updated to the real fee/subscription structure**:
  `PaymentPolicy.tsx` no longer says "a flat platform fee is added at
  checkout" (it isn't flat) - now states the actual 5%/$25k standard,
  2%/$10k existing-relationship, and 0.1%/$1.5k infrastructure figures,
  plus a new "Subscription plans" section covering Stripe billing,
  monthly-in-advance, and cancel/downgrade behavior that the policy never
  covered before (it previously only described per-transaction fees).
  `Terms.tsx` Section 2 now cross-references Payment Policy instead of
  staying fully generic, and Section 9 discloses automated document
  processing with the same "always preliminary, always requires your
  review" framing used throughout the platform. `NonCircumvention.tsx`
  replaced an unstated "grandfathered-fee treatment" with the real 2%
  capped at $10,000 figure and a link to Payment Policy.
- **`Blueprint.tsx` header comment fixed** - it still said the codebase
  "has no CAD/OCR parser," which was true when it was written but is no
  longer true; updated to describe the real filename-default classification
  plus on-request PDF text/OCR/DXF extraction, while still honestly noting
  DWG/RVT/IFC binary CAD formats have no reader.
- **`Landing.tsx` (public homepage) extended, not redesigned** - it
  predated the Divini tool suite entirely and never mentioned Capital
  Partners. Added, preserving the existing custom CSS/animation system: a
  new "Tools" section with 5 cards (Pipeline, Scope Builder, Bid Studio,
  Follow-Up Desk, Blueprint), a nav link to it, a Capital Partner sentence
  near the pricing summary reinforcing that Divini Procure only makes
  introductions and never brokers or structures an investment, and 2 new
  FAQ entries (what the tool suite is; an explicit "is this an investment
  platform? No" answer).
- **Deliberately skipped**: the `roleInvestor` i18n key exists untranslated
  in ~12 locale files, but a repo-wide search confirmed it has zero call
  sites anywhere in the app, including in the English locale where it
  would be correctly translated - it is dead, so translating it would fix
  nothing a user could ever see. Left as-is rather than spending effort on
  unreachable code.

**Files.** `src/pages/Profile.tsx`, `src/pages/TrustProfile.tsx`,
`src/pages/PublicDeveloperProfile.tsx`, `src/components/OnboardingChecklist.tsx`,
`src/pages/MessagingPolicy.tsx`, `server/src/lib/messaging-policy.ts`,
`src/pages/PaymentPolicy.tsx`, `src/pages/Terms.tsx`, `src/pages/Privacy.tsx`,
`src/pages/NonCircumvention.tsx`, `src/pages/Blueprint.tsx`, `src/pages/Landing.tsx`.

**Tests completed.** `npx tsc -p tsconfig.json --noEmit` (clean, aside from
pre-existing `PartnerOnboarding.tsx` errors that predate this session and
this change set), `npx tsc -p server/tsconfig.json --noEmit` (clean),
`npm test` (163/163 passing - no test files touched in this pass, since it
was copy-only with two data-source swaps that reuse already-tested
endpoints). Not manually verified in a browser this pass; the two live-data
swaps (Profile.tsx, Dashboard.tsx) call the same `GET /subscriptions/mine`
endpoint already exercised in entry 12.

---

## 2026-08-03 (12) - Pricing/plan selection, locked-feature teasers, usage counters, onboarding nudges

**What.** Live pricing pages, tier selection at registration, a reusable
"locked feature with an upgrade CTA" pattern, real usage counters, and
onboarding nudges toward the plan page - built on the existing (and
already solid) entitlements/Stripe subscription engine rather than a new
one. Explicitly scoped away from dark patterns: no fabricated scarcity, no
fake countdown timers, no fake testimonials or "X people just signed up"
social proof, and no fake currency conversion without real FX data. Real
signals only - actual usage, actual tier data, actual locale.

- **A real pre-existing bug fixed along the way**: the Dashboard's "Plan"
  metric card showed a hardcoded `$100/mo, first 2 mo 50% off` for every
  vendor regardless of their actual plan or price (Vendor Pro is really
  $149/mo) - never wired to the entitlements engine at all. Replaced with
  the company's real plan name and price from `GET /subscriptions/mine`.
- **A second pre-existing bug fixed**: `verified_plus` and
  `vendor_featured` are documented in `entitlements.ts` as vendor add-ons
  purchased on top of a base plan, but both `Subscription.tsx` and the old
  static `Pricing.tsx` sorted every tier by price into one ladder - mixing
  them in as if they were alternative starting plans a vendor picks
  instead of `vendor_free`/`vendor_pro`. Both pages now exclude add-on
  keys from the base-plan comparison (`ADDON_TIER_KEYS` in the new
  `src/lib/tiers.ts`). Actually exposing an add-on *purchase* flow was
  deliberately NOT built: `subscription_entitlements` stores one
  `tier_key` per company, so "buying" verified_plus today would silently
  REPLACE (not add to) a vendor's real plan and its limits - a real
  architectural gap, documented in code rather than papered over with a
  button that would quietly break a vendor's account.
- **`GET /public/subscription-tiers`** (new, no auth) - the public Pricing
  page needed real tier data, but `GET /subscriptions/tiers` requires a
  signed-in session. Tier pricing/limits are not sensitive, so this is a
  plain read of the same catalogue with no auth gate, keeping Pricing
  permanently in sync with whatever an admin configures in
  AdminSubscriptions instead of a hand-maintained copy that drifts.
- **`src/lib/tiers.ts`** - shared `Tier`/`Entitlement`/`LimitCheck` types
  and `money()`/`limitText()`/`basePlansFor()`/`audienceForKind()`
  helpers, used by Subscription, Onboarding, Pricing, and Dashboard so
  they can never disagree about tier shape or the add-on exclusion rule.
- **`src/components/UsageMeter.tsx`** - the usage-bar pattern extracted
  from Subscription.tsx into a reusable component (now also used on
  Dashboard), with a new near-limit (80%+) amber warning state that didn't
  exist before - previously a bar only changed color once you were
  already AT the limit, with no earlier warning.
- **`src/components/UpgradeGate.tsx`** - the "darken a locked feature with
  a lock icon and an Upgrade button" pattern requested for gated features:
  `<UpgradeGate locked={...} featureName="...">` blurs/dims its children
  behind an overlay when locked, always driven by a real entitlement flag
  the caller checked - never a fabricated claim about what's behind it.
  Applied to the AI COO page (`entitlement.ai_features`) as a concrete,
  representative example of the pattern, not to every gated feature in the
  app - extending it further is straightforward from here but is a much
  larger pass than this one covered.
- **Registration now includes a plan-selection step** (Onboarding.tsx
  gains a step between company info and contact details): shows the real
  base-plan ladder for whichever role was picked, defaults to that role's
  free tier, and after the company is created calls the EXISTING
  `POST /subscriptions/checkout` (free tiers assign immediately; paid
  tiers redirect to Stripe Checkout) - no new billing code, reusing
  exactly what Subscription.tsx already does for in-app upgrades. A plan
  choice made on the public Pricing page is stashed to localStorage
  (`procure_onboard_tier`, alongside the existing `procure_onboard_role`
  convention) since registration requires email verification that can
  happen minutes or days later in a different tab - a query param alone
  would not survive that gap. Validated against the real loaded plan list
  before being trusted, never applied blindly.
  - **A real bug caught in self-review**: the existing `?role=` URL-hint
    effect set `kind` directly, bypassing the reset helper that keeps
    `selectedTierKey` in sync with the audience - a vendor arriving via
    `?role=vendor` would have kept a stale developer-tier default
    selected. Fixed by updating the tier hint in that same effect.
- **Pricing page rebuilt** (`src/pages/Pricing.tsx`): audience tabs
  (Developers / Vendors / Capital Partners) over the live tier catalogue
  instead of a hardcoded plan list that only ever covered vendors: an
  FAQ/objection-handling section (change plans anytime, what happens at
  your limit, no lock-in contract, how the plan relates to the separate
  success fee, do you need to pay to start) answers the questions a real
  visitor has before committing, replacing what would otherwise be
  manufactured urgency. The existing honest fee-structure and
  trust/verification sections were kept as-is since they were already
  real, accurate content.
- **Dashboard usage counters**: a "Usage this period" card
  (`UsageMeterList`) showing the 2-3 limits most relevant to that
  company's role, linking to Subscription for full detail.
- **Onboarding checklist nudge**: every role's checklist
  (`OnboardingChecklist.tsx`) gained a "See what your plan unlocks" step
  linking to Subscription - a real, dismissible suggestion, not a modal
  interruption.

**Deliberately NOT built, and why**: IP-geolocation/VPN-based personalization
that changes marketing copy or prices per visitor. Doing this honestly
would need either a geo-IP service (a real API key the user would need to
provide - none configured) for country detection, or real-time FX rates
for accurate currency conversion (also not configured) - faking either
with guessed values or a static conversion table would show visitors
wrong prices, which is worse than showing one honest USD price to
everyone. If/when a geo-IP or FX-rate provider is configured, Pricing.tsx
is the file to extend with real per-region pricing.

**Files.** `server/src/routes/subscriptions.ts` (new public tiers route),
`src/lib/tiers.ts` (new), `src/components/UsageMeter.tsx` (new),
`src/components/UpgradeGate.tsx` (new), `src/pages/Subscription.tsx`
(refactored onto the shared module + component), `src/pages/Onboarding.tsx`
(new plan-selection step), `src/pages/Pricing.tsx` (rebuilt on live data),
`src/pages/Dashboard.tsx` (real plan card + usage counters, fixed
duplicate `apiGet`/`money()` introduced then caught in the same pass),
`src/pages/CooDashboard.tsx` (UpgradeGate applied), `src/components/
OnboardingChecklist.tsx` (plan-nudge step per role).

**Tests completed.** Both server and SPA typecheck clean; full suite
163/163 passing (no new pure logic needing unit tests this pass - the one
backend change is a plain read of the already-covered tier catalogue).
Not tested against a live database, a real Stripe account, or in a
browser - same sandbox limitation as every prior slice this session; the
checkout flow reuses Subscription.tsx's already-shipped, unchanged Stripe
integration rather than adding a new one.

---

## 2026-08-03 (11) - Real content extraction: PDF text, OCR, DXF entities, safe XLSX

**What.** A genuine capability upgrade, not just another filename-based
slice: for the file types that need NO external service or API key, Divini
Blueprint now actually reads document content instead of only guessing
from filenames. This directly answers the request to build everything
possible before the remaining backend service variables (a CAD conversion
service, self-hosted OCR infrastructure, etc) are available - three of the
four previously-deferred capabilities turned out to need no such variable
at all, just an open-source library.

- **Real PDF text extraction** (`server/src/lib/text-extraction.ts`, using
  `pdf-parse` v2, Apache-2.0) - opens the file and reads its actual text
  layer. A PDF with no real text layer (a scan) correctly returns null
  rather than reporting false success, so callers fall back to OCR instead
  of trusting empty/garbage text.
- **Real OCR** (`server/src/lib/ocr.ts`, using `tesseract.js`, Apache-2.0,
  wrapping the open-source Tesseract engine, also Apache-2.0) - runs
  entirely in this Node process via WASM. On a scanned PDF with no text
  layer, `extract-content` renders page 1 to PNG (`pdf-parse`'s
  `getScreenshot`) and OCRs that. Results below Tesseract's own confidence
  threshold are discarded rather than surfaced as noise.
- **Real DXF parsing** (`server/src/lib/dxf-extraction.ts`, using
  `dxf-parser`, MIT) - DXF is CAD's plain-text exchange format, so unlike
  DWG/RVT/IFC it never needed a conversion service. Extracts real layer
  names and TEXT/MTEXT entity strings - a drawing's actual title-block text
  ("A1.01 FLOOR PLAN") is now readable, not guessed from the filename.
- **`classifyFromContent()`** (`server/src/lib/document-classifier.ts`,
  new, alongside the unchanged filename-only `classifyDocument()`): runs
  the same keyword rules against real extracted text and returns "high"
  confidence on a match - the first time anything in Divini Blueprint has
  honestly earned that confidence level, because it is grounded in actual
  content rather than a filename guess. `POST /blueprint/documents/:id/extract-content`
  wires this together: extract by file type, store the result, reclassify
  at high confidence if a rule matches, and never touch a document a user
  already manually corrected.
- **Real XLSX budget import** (`server/src/lib/xlsx-extraction.ts`, using
  `exceljs`, MIT) - deliberately NOT the npm `xlsx` (SheetJS) package: its
  published registry version carries an unpatched HIGH-severity prototype-
  pollution/ReDoS advisory (GHSA-4r6h-8v6p-xvw6), unacceptable for a parser
  that runs directly on untrusted uploaded files. `exceljs` does pull a
  moderate-severity transitive `uuid` advisory (GHSA-w5hq-g745-h8pq, buffer
  bounds check when an attacker-controlled buffer is passed to UUID
  generation - not something exceljs's own file-reading code path does) with
  no clean non-breaking fix available upstream at the time of writing; this
  was judged an acceptable tradeoff against the alternative's much more
  directly exploitable advisory, but is worth monitoring for an exceljs
  update. `POST /blueprint/budget-imports` now accepts either `csvText`
  (unchanged) or a `documentId` (an already-uploaded file, dispatched by
  real extension) - XLS (the old binary Excel format) is explicitly
  rejected with a clear message rather than silently mishandled.
- **CAD conversion provider adapter** (`server/src/lib/cad-conversion.ts`)
  - the piece that genuinely CANNOT be built without an external service:
  DWG/RVT/IFC are binary, proprietary formats. This is the same kind of
  pluggable seam as `lib/llm.ts`: reads `CAD_CONVERSION_PROVIDER` +
  provider-specific variables, `cadConversionEnabled()` is false with none
  configured, and `convertCadFile()` honestly reports "not yet implemented"
  even when a provider is selected - this is scaffolding for the next step,
  not a working integration, since building a real client blind (especially
  Autodesk APS's OAuth + job-polling flow) without real credentials to test
  against would risk shipping broken code with false confidence.
- **A runtime-vs-typecheck pitfall caught and fixed for BOTH `dxf-parser`
  and `exceljs`**: both packages typecheck fine with a named import
  (`import { X } from "pkg"`), but this project's test runner
  (`node --experimental-strip-types`) strips only type annotations and does
  not rewrite import specifiers - so a named import that only works via
  TypeScript's CJS interop synthesis fails at actual runtime with
  "Named export not found". Caught by literally running the code (not just
  typechecking) before writing tests, and fixed with default-import +
  destructure, matching Node's own documented workaround. Every new
  extraction module was runtime-verified this way before its tests were
  written, not just typechecked.
- **A live OCR test was written, hung on a network fetch for Tesseract's
  language data, and was deliberately removed** rather than shipped: this
  sandbox cannot reliably reach tesseract.js's CDN, and a test that can
  hang indefinitely is worse than no test. OCR's contract (garbage input
  never throws) is covered where it does not require network access; a
  real "recognizes real text" test needs an environment with that access.

**Files.** `db/schema-blueprint-content-extraction.sql` (new, synced into
`db/apply-all.sql`), `server/src/lib/text-extraction.ts`,
`server/src/lib/ocr.ts`, `server/src/lib/dxf-extraction.ts`,
`server/src/lib/xlsx-extraction.ts`, `server/src/lib/cad-conversion.ts`,
`server/src/lib/document-classifier.ts` (extended),
`server/src/routes/blueprint.ts` (extended: extract-content endpoint),
`server/src/routes/blueprint-phase2.ts` (extended: XLSX budget import),
`src/pages/Blueprint.tsx` (extended: Extract content action, XLSX upload),
`server/package.json` / `server/package-lock.json` (new dependencies:
`pdf-parse`, `tesseract.js`, `dxf-parser`, `exceljs` - deliberately NOT
`xlsx`), `tests/dxf-extraction.test.ts` (6), `tests/xlsx-extraction.test.ts`
(5), `tests/text-extraction.test.ts` (3), `tests/cad-conversion.test.ts`
(2), plus 4 new tests in `tests/document-classifier.test.ts` for
`classifyFromContent()`.

**Tests completed.** 20 new unit tests, full suite 163/163 passing. Both
server and SPA typecheck clean. Every new library integration was verified
against the REAL test runner (`node --experimental-strip-types`, not just
`tsc` or `tsx`) before being trusted, which is what surfaced the dxf-
parser/exceljs import pitfall above. PDF text extraction and DXF parsing
were manually round-trip verified (a hand-crafted minimal DXF fixture for
DXF; a hand-crafted minimal PDF for the "garbage input returns null" path -
a byte-perfect success-path PDF fixture proved impractical to hand-craft
and was not force-fit into the suite; see `tests/text-extraction.test.ts`'s
own scope note). XLSX extraction was round-tripped with `exceljs` writing
its own test fixtures in memory. OCR's language-data download could not be
verified in this sandbox (no reliable network access to the CDN at test
time) - this is a real, disclosed gap, not a hidden one.

---

## 2026-08-03 (10) - Divini Blueprint Phase 2: CSI divisions, budget import, quantities, inline preview

**What.** The remaining pieces of the CAD/Drawing/Plan/Specification/Bid
Intelligence master spec buildable with NO additional backend service or
API key - explicitly scoped that way per the user's instruction to build
everything possible now and add the rest once the additional backend
support variables (a CAD-conversion/OCR service, an LLM key, etc.) exist.
Everything here is pure deterministic logic, manual data entry, or
browser-native rendering - no new external dependency, no new environment
variable.

- **CSI division tagging** (`server/src/lib/csi-divisions.ts`, pure, 9
  tests): the standard MasterFormat division list, plus a guess derived
  from a document's ALREADY-classified discipline (never content) - same
  override-locking pattern as document category/discipline elsewhere in
  Blueprint. `GET /blueprint/specification-index` also flags divisions a
  project's drawing disciplines imply but no tagged specification document
  covers - a classification-derived signal, explicitly labeled as such,
  not proof anything is actually missing.
- **Budget import, CSV only** (`server/src/lib/csv-parser.ts`, a small
  dependency-free RFC-4180-ish parser, 12 tests, since this codebase has no
  xlsx/exceljs/papaparse in package.json - an XLSX upload is rejected with
  a clear message rather than silently misread). Each row is matched to an
  existing package by deterministic keyword overlap
  (`server/src/lib/budget-mapper.ts`, pure, 7 tests) - exact category-name
  match is "medium" confidence, 2+ shared words "medium", exactly 1 shared
  word "low", never auto-applied. `GET /blueprint/budget-reconciliation`
  surfaces packages with no imported budget and budget lines still
  unmapped to any package (spec section 17).
  - **A real gap caught in self-review**: the line-reassignment endpoint
    let a caller set `matchedPackageId` without also updating `status`,
    but reconciliation only sums lines with `status = 'mapped'` - so a
    manually-reassigned line would silently vanish from the totals. Fixed
    by having a package reassignment imply the matching status
    automatically unless the caller passes one explicitly.
- **Quantity observations - manual only, deliberately not AI-assisted**
  (`quantity_observations` table): this build cannot read drawing content,
  so unlike every other Divini Blueprint feature there is no "suggested"
  value here at all, only user entry. The `source` column is
  hard-constrained in the schema to always equal `'user_entered'` as a
  guardrail against a future change quietly repurposing it.
- **Inline PDF/image preview** (`src/components/DocumentPanel.tsx`):
  browsers can render PDF and common raster images natively with no
  conversion service, so a "Preview" button now opens them inline
  (`<iframe>`/`<img>` against the existing signed-URL endpoint) instead of
  only a new-tab download. CAD file rows instead show an honest inline
  note - "CAD preview requires a conversion service, not yet configured" -
  rather than a broken or silent no-op button.

**Files.** `db/schema-blueprint-phase2.sql` (new, synced into
`db/apply-all.sql` after the blueprint-addenda block),
`server/src/lib/csi-divisions.ts`, `server/src/lib/csv-parser.ts`,
`server/src/lib/budget-mapper.ts`,
`server/src/routes/blueprint-phase2.ts` (new, mounted at `/api/blueprint`
alongside the existing blueprint router), `src/pages/Blueprint.tsx`
(extended: specification index, budget import, quantity observations
cards), `src/components/DocumentPanel.tsx` (inline preview),
`tests/csi-divisions.test.ts` (9), `tests/csv-parser.test.ts` (12),
`tests/budget-mapper.test.ts` (7).

**Permissions.** Same single-owner model as the rest of Divini Blueprint:
every new record resolves its owning organization through
`building -> company_id`; access = member of that company, or admin.

**Tests completed.** 28 new unit tests, all pure with no DB, full suite
143/143 passing. Both server and SPA typecheck clean. Self-review caught
the budget-line status-sync gap above before commit. **Not tested against
a live database or in a browser** - same sandbox limitation as every prior
slice this session.

**Deferred, waiting on the backend variables the user will add**: XLSX/XLS
budget import (needs a spreadsheet library), any AI-assisted quantity
takeoff or specification-content reading (needs OCR/CAD-parsing/an LLM
key), and CAD/BIM format preview beyond PDF/image (needs a CAD conversion
service). None of these are safe to fake without the real capability
behind them.

---

## 2026-08-03 (9) - Marketplace publication: visibility, scheduling, and urgency

**What.** Implements the master spec's "marketplace publication" sections
(20-25) on top of the pre-existing `packages` table, rather than a new
parallel listing system. Before this slice, a package with `status='open'`
was already visible to every vendor via `getOpenPackages()` with no
visibility tiers, no validation gate, no scheduling, and no urgency
concept - `POST /packages/:id/status` was the entire "publish" mechanism.
This adds all four, matching the spec's "one controlled submission action,
never automatic" framing.

- **A real correctness bug caught before it shipped**: the natural way to
  add a `visibility` column defaults it to `'private_draft'`, but Postgres
  backfills that default onto every EXISTING row too - which would have
  instantly hidden every already-published package from the marketplace
  the moment this migration ran, since the new `getOpenPackages()` filter
  also checks visibility. Caught in review before writing the route logic;
  fixed by defaulting `visibility` to `'public_marketplace'` instead, so
  every package already open (and every package created through the
  unchanged legacy `createPackage()` path, which still defaults status to
  `'open'`) stays exactly as visible as it always was. `status` remains the
  master gate on whether a package is listed at all; `visibility` only
  narrows WHO can see it once status allows listing.
- **A second bug caught in self-review**: the publish-readiness "has
  documents" check only counted `documents.package_id`, but Divini
  Blueprint's `create-package` action (previous slice) links documents
  through `blueprint_document_package_links` only, never sets
  `documents.package_id` - so a Blueprint-originated package would always
  report "no documents attached" even with several linked. Fixed by
  unioning both sources in `readinessFor()`.
- **Validation gate** (`server/src/lib/marketplace-validation.ts`, pure, 8
  tests): a fixed, hedge-free checklist - visibility chosen, bid due date
  present, question deadline not after the bid due date, review
  acknowledgment given are BLOCKING errors; missing scope or documents are
  WARNINGS only, per the spec's own "do not prevent all bidding if
  documents are incomplete" rule. `POST /packages/:id/publish` always runs
  this first and refuses with the exact errors on failure - it never
  publishes silently.
- **Urgency, gated by a configurable monthly limit**: reuses the existing
  subscription-tier entitlement engine (`server/src/lib/entitlements.ts`)
  rather than a hardcoded number - `urgentListingMonthlyLimit()` /
  `urgentListingsUsedThisMonth()` / `checkUrgentListingLimit()` follow the
  exact override-wins-else-tier-default pattern already used for every
  other limit there. This codebase's real developer tier ladder is
  `developer_free` / `developer_pro` / `developer_enterprise` (not the
  master spec's five-tier Explorer/Starter/Growth/Professional/Enterprise
  naming), so the spec's limits are adapted onto these three: free =
  unavailable (0/month), pro = 5/month, enterprise = unlimited by default
  (contract-defined per company via the existing override column). Usage is
  counted by PUBLISH time, not creation or urgency-flagging time, since the
  limit is about how many urgent listings actually go live in a month.
- **Scheduling with no external cron**: `publish_at` keeps a package in
  draft; a new 5-minute interval in `server/src/index.ts` (same
  in-process pattern as Divini Follow-Up Desk) calls
  `publishDueScheduledPackages()`, which RE-VALIDATES each due package
  (visibility/dates/urgency limit can all have changed since it was
  scheduled) and skips - never force-publishes - anything no longer ready,
  logging why.
- **Publication snapshot**: publishing writes `publication_snapshot`
  (a locked jsonb copy of the package at that moment) so the listing
  content the spec calls for stays fixed even as the working record keeps
  evolving afterward.
- **Batch publish**: `POST /packages/publish-batch` applies shared
  publication settings to a list of packages then attempts each
  independently - one package's validation failure or urgent-limit
  rejection never blocks the others (spec section 25).
- Frontend: `src/pages/PackageDetail.tsx` gains an owner-only "Marketplace
  publication" panel - status/visibility/urgency badges, the live readiness
  checklist (errors block, warnings do not), the urgent-listing usage
  counter, visibility/urgency/date/NDA fields, the spec's exact
  human-review acknowledgment checkbox, and Save / Publish (or
  Save & Schedule, when a future publish date is set) actions.
- **Deferred, not built in this slice**: vendor notification on publish
  (the spec's "notify matched vendors" step). This codebase does not yet
  have a general "new listing matches this vendor's saved trade/geography
  criteria, send an alert" mechanism to hook into - Divini Blueprint's
  addendum publish (previous slice) notifies vendors because it already
  has a concrete audience (existing `bid_invites`/`bids` rows on the
  affected package); a brand-new listing has no such audience yet.
  Building that properly means vendor-matching/saved-search infrastructure
  this slice does not attempt to fake. Pause/close/reopen/extend/clone
  listing controls (spec section 21) also remain out of scope beyond the
  pre-existing `POST /packages/:id/status`.

**Files.** `db/schema-marketplace-publication.sql` (new, synced into
`db/apply-all.sql` right after the subscriptions block, since it extends
`subscription_tiers`/`subscription_entitlements`), `server/src/lib/
marketplace-validation.ts`, `server/src/lib/entitlements.ts` (extended),
`server/src/routes/marketplace-publication.ts` (new, mounted at
`/api/marketplace`), `server/src/db.ts` (`getOpenPackages` visibility
filter), `server/src/index.ts` (the scheduler interval),
`src/pages/PackageDetail.tsx` (extended), `tests/marketplace-
validation.test.ts` (8 tests).

**Permissions.** Same single-owner model as the rest of this build: a
package's owning organization is resolved through
`packages -> buildings -> company_id`; access = member of that company, or
admin. `GET /marketplace/urgent-limit` is scoped the same way.

**Tests completed.** 8 new unit tests (validation gate, pure, no DB), full
suite 115/115 passing. Both server and SPA typecheck clean. Self-review
caught the two real bugs described above before commit. **Not tested
against a live database or in a browser** - same sandbox limitation as
every prior slice this session.

---

## 2026-08-03 (8) - Divini Blueprint: revision linking and addendum publishing (Phase 2 slice)

**What.** Continues the CAD/Drawing/Plan/Specification/Bid Intelligence spec
into its Phase 2 "revision and addendum management" section, closing a gap
left by the previous slice: `documents.parent_document_id` /
`revision_number` / `revision_label` existed in the schema but nothing
populated or read them. This adds a deterministic filename-based revision
suggester, explicit user-confirmed revision linking, and a full
draft -> review -> published addendum workflow that notifies vendors and
tracks acknowledgment - all on top of the existing `documents`, `packages`,
and `bid_invites`/`bids` tables rather than new parallel structures.

- **Revision suggestion is filename-pattern only, never automatic**
  (`server/src/lib/revision-matcher.ts`, pure, 8 tests): strips common
  revision/version/addendum tokens (`rev2`, `v3`, `addendum 1`, ...) and
  compares normalized base names. An exact match after stripping is
  "medium" confidence; a substring relationship is "low"; nothing is ever
  auto-linked - `GET /blueprint/documents/:id/suggest-revision-of` only
  returns suggestions, and `POST .../link-revision` requires the user to
  pick one explicitly.
- **Cycle-safety, a real bug caught and fixed in self-review**: the first
  draft of `link-revision` only rejected linking a document as a revision
  of itself, not a longer cycle (e.g. A -> B, then later B -> A) - which
  would have made the `WITH RECURSIVE` chain-lookup query in
  `GET /blueprint/documents/:id/revisions` loop forever against a real
  database. Fixed two ways: `link-revision` now walks the proposed
  parent's full ancestor chain and rejects any link that would close a
  loop, and the recursive query itself carries a `visited` array guard as
  defense in depth against a cycle introduced any other way.
- **Addenda** (`document_addenda`, `document_addendum_acknowledgments`):
  draft -> review -> published, the same "structural fields are only
  editable before the record leaves draft-like status" invariant used by
  change-orders and Divini Bid Studio elsewhere in this build - a
  published addendum can never be edited again. `affected_package_ids` is
  derived automatically from the selected documents' own `package_id` and
  any `blueprint_document_package_links` rows, never hand-typed.
  `POST /addenda/:id/publish` (gated on `status = 'review'`) finds every
  vendor company with a `bid_invites` or `bids` row on an affected
  package, writes an acknowledgment row per company, notifies every member
  of that company with an in-app `notifications` row, and best-effort
  emails them via the existing gracefully-degrading `lib/email.ts`.
  `POST /addenda/:id/acknowledge` is vendor-side: a user may only
  acknowledge on behalf of a company that actually has a notified
  acknowledgment row, never an arbitrary company id.
- **Honesty boundary maintained**: no content-level diffing ("changed
  dimensions", "changed specifications") is claimed anywhere - this
  codebase cannot read document content, so revision matching is a
  filename suggestion and addendum authorship (what changed, why) is
  entirely user-written.
- Frontend: `src/pages/Blueprint.tsx` now shows, per document, a
  "Check for revision of..." action with inline suggestion buttons; a
  checkbox per document plus a new Addenda card to draft, review, and
  publish; and, for vendor-role companies, the page renders an entirely
  different view (`isVendor` branch) listing addenda published to that
  company with an Acknowledge action. Vendor nav entry added in
  `src/components/Shell.tsx`.

**Files.** `db/schema-blueprint-addenda.sql` (new, synced into
`db/apply-all.sql` right after `schema-blueprint.sql`),
`server/src/lib/revision-matcher.ts`, `server/src/routes/blueprint.ts`
(extended, not a new file), `src/pages/Blueprint.tsx` (extended),
`src/components/Shell.tsx` (vendor nav entry),
`tests/revision-matcher.test.ts` (8 tests).

**Permissions.** Same single-owner model as the rest of Blueprint for
everything on the developer/owner side (addendum belongs to one
`organization_id`; member-of-company or admin). The acknowledge endpoint
is deliberately NOT gated by that same organization check, since the
acknowledging party is a different company (the vendor) than the
addendum's owner - it is instead gated by an existing, already-notified
`document_addendum_acknowledgments` row for one of the caller's own
companies, which prevents both cross-tenant reads and acknowledging on
behalf of a company never actually notified.

**Tests completed.** 8 new unit tests (revision matcher, pure, no DB), full
suite 107/107 passing. Both server and SPA typecheck clean. Self-review
re-read of the new `blueprint.ts` routes caught the revision-cycle bug
described above before commit. **Not tested against a live database or in
a browser** - same sandbox limitation as every prior slice this session.

---

## 2026-08-03 (7) - Divini Blueprint (Slice 5, folding in the CAD/Drawing/Plan/Spec/Bid Intelligence spec)

**What.** A document-intelligence module answering the "CAD, Drawing, Plan,
Specification, and Bid Intelligence" master spec, scoped honestly to what
this codebase can actually do. It classifies every uploaded project
document, suggests likely trade bid packages from that classification, and
optionally drafts a narrative project-summary from an LLM if one is
configured - then lets the user turn accepted suggestions into a real
Divini Scope Builder scope, a real bid package, or a real Divini Pipeline
opportunity. Nothing is ever auto-published; every suggestion requires an
explicit user action to become a real record.

- **Honesty boundary, load-bearing for this whole slice**: this codebase
  has no PDF-parsing, OCR, or CAD-conversion library (confirmed by grep and
  package.json before writing a line of this). The spec calls for reading
  DWG/IFC/RVT content, extracting square footage from drawings, indexing
  sheet numbers, etc. - none of that is technically possible here without
  a third-party conversion/parsing service this deployment doesn't have.
  Rather than fabricate that capability, `document-classifier.ts`
  classifies by **filename and extension only** and is contractually
  incapable of returning "high" confidence anywhere in the module (tested
  explicitly). The optional AI-summary step never receives file bytes,
  only classification counts and text the user typed themselves, and its
  system prompt explicitly forbids inventing quantities, dimensions, or
  material choices. Every summary field carries its own confidence
  (high/medium/low/`manual_confirmation_required`) and source note; the
  required disclaimer ("AI-generated preliminary project information...")
  is returned by the API and rendered verbatim in the UI.
- **Extends, does not duplicate**: uploads reuse the existing
  `POST /api/documents` endpoint (multer, extension/MIME allowlists,
  path-traversal-safe storage keys, pluggable local/S3 storage) - this
  slice only adds classification columns and review workflow on top.
  Accepted trade suggestions create rows in the *existing* `packages`,
  `scope_instances`, and `pipeline_opportunities` tables (Divini Scope
  Builder / Divini Pipeline integration points), not new parallel tables.
- **Deterministic trade suggestion engine** (`server/src/lib/trade-suggester.ts`,
  pure, 8 tests): a fixed discipline-to-trade lookup (e.g. `structural` ->
  both Concrete and Structural Steel), confidence capped at medium (2+
  supporting documents) or low (1), sorted by supporting-document count.
- **Review-before-create gate**: `POST /trade-suggestions/:id/create-package`
  and `.../create-scope` both require `status === 'accepted'` first and
  reject a second create against the same suggestion - mirrors the
  draft-only-editable / explicit-approval pattern used everywhere else in
  this build.
- Covers Phase 1 of the spec's own implementation-priority section (secure
  upload, classification, trade detection, draft bid-package generation,
  editing, with marketplace publishing/scheduling/urgency deferred - see
  below). Phase 2/3 items (specification/CSI-division indexing, CAD
  viewer, budget import/reconciliation, quantity takeoffs, revision and
  addendum workflow, scheduled/urgent marketplace publication, vendor
  matching) are **not built in this slice** and would need their own pass;
  none of them are safe to fake without either a real parsing/CAD service
  or an explicit decision to keep them manual-entry-only.

**Files.** `db/schema-blueprint.sql` (new, synced into `db/apply-all.sql`
after scope-builder/bid-studio/follow-up-desk and before award-workflow,
since it references `packages` and `scope_instances`),
`server/src/lib/document-classifier.ts`, `server/src/lib/trade-suggester.ts`,
`server/src/routes/blueprint.ts` (mounted at `/api/blueprint` in
`server/src/routes.ts`), `src/pages/Blueprint.tsx`, nav entry in
`src/components/Shell.tsx` (buyer Quick Actions), route in `src/App.tsx`,
`tests/document-classifier.test.ts` (10 tests), `tests/trade-suggester.test.ts`
(8 tests).

**Permissions.** A document/run/suggestion belongs to exactly one
`organization_id` (via the linked building's `company_id`); access =
member of that company, or admin - the same single-owner model used by
Pipeline, Scope Builder, Bid Studio, and Follow-Up Desk.

**Tests completed.** 18 new unit tests (10 classifier + 8 suggester), all
pure with no DB, all passing; full suite is 99/99. Both server and SPA
typecheck clean (the SPA's pre-existing `PartnerOnboarding.tsx` errors are
unrelated to this change, confirmed via `git log` on that file predating
this session). Self-review re-read of `blueprint.ts` was performed
specifically checking every SQL column reference against the actual table
definitions (`documents`, `buildings`, `packages`, `scope_instances`,
`pipeline_opportunities`, `pipeline_stage_history`) - no bugs found this
pass. **Not tested against a live database or in a browser** - same
sandbox limitation as every prior slice this session (no Docker, no
`DATABASE_URL`, nothing listening on 5432/5433).

---

## 2026-08-03 (6) - Divini Follow-Up Desk (Slice 4 of the Divini deterministic business tools)

**What.** A rules-based reminder/workflow engine covering the highest-value
cases across the three tools built so far: a Divini Pipeline opportunity
with no activity in 14 days, an unfinished Divini Bid Studio draft, a
submitted bid expiring within 3 days, and a vendor credential (license/
insurance/etc, from the existing verification system) expiring within 30
days. Every workflow's WORDING comes from a fixed template with
`{{merge_field}}` substitution (`server/src/lib/follow-up-scheduling.ts`
`renderTemplate`) and every CONDITION is a named, deterministic check
against the linked record's current state (`conditionMet()` in
`follow-up.ts`) - nothing generated.

- **No cron dependency**: this is a persistent Node process
  (`app.listen`), not serverless, so `server/src/index.ts` runs the engine
  on a real 15-minute `setInterval` in-process. Also triggerable on demand
  via `POST /api/follow-up/process-due` (admin) for testing or an external
  cron if a deployment prefers that instead.
- **Deterministic scheduling** (`server/src/lib/follow-up-scheduling.ts`,
  pure, zero IO, 9 tests): `addDelay()` supports business-day-aware delays
  (skips Saturday/Sunday); `renderTemplate()` does plain `{{key}}`
  substitution and leaves an unmatched token visibly broken rather than
  silently dropping it; `isApproaching`/`isStale` are the two date-window
  checks every seeded condition is built from.
- **User controls**, per the spec's Layer 4 requirements: pause, resume,
  stop any active enrollment (`PATCH /follow-up/enrollments/:id`); enroll a
  specific record into a workflow on demand
  (`POST /follow-up/enroll`, idempotent per workflow+record); full action
  history per enrollment (`GET /follow-up/actions`).
- **Manual approval gate**: a step with `requires_approval=true` pauses the
  enrollment and marks its action `awaiting_approval` rather than sending -
  `POST /follow-up/actions/:id/approve` executes it and resumes the
  sequence. None of the 4 seeded workflows use this yet, but the mechanism
  is real and tested by inspection (see bugs below).

**Two real bugs caught in self-review, fixed before commit** (both in the
approval-gate path, which none of the seeded workflows exercise, so neither
would have surfaced until a custom `requires_approval` workflow was
created):
1. The first draft fell through and advanced the enrollment past a
   `requires_approval` step regardless of whether it had actually been
   approved - the gated message would never send, but the workflow would
   silently move on as if it had. Fixed by pausing the enrollment instead of
   advancing, and adding the missing `/approve` endpoint that executes the
   action and resumes the sequence.
2. Once that was fixed, the action row itself was still never updated from
   `pending` to `awaiting_approval` - so the new approve endpoint's own
   status check would have permanently rejected every approval attempt.
   Caught on the same re-read; fixed with the missing `UPDATE`.

**Files.** `db/schema-follow-up-desk.sql` (new, synced into
`db/apply-all.sql`), `server/src/lib/follow-up-scheduling.ts`,
`server/src/routes/follow-up.ts` (mounted at `/api/follow-up`),
`server/src/index.ts` (the interval), `src/pages/FollowUpDesk.tsx`, nav
entries in `src/components/Shell.tsx` (buyer + vendor), route in
`src/App.tsx`, `tests/follow-up-scheduling.test.ts` (9 new tests, all
pure - no DB).

**Permissions.** An enrollment belongs to exactly one `organization_id`;
access = member of that company, or admin. `POST /process-due` is
admin-only (it processes every organization's due enrollments at once).

**Tests completed.** Unit tests only (9, all passing) for the pure
scheduling/template functions. Server and SPA typecheck clean. **Not
tested against a live database or in a browser** - same sandbox limitation
as the previous three slices (no Docker, no `DATABASE_URL`, nothing on
5432/5433). The condition-evaluation and action-execution logic in
`follow-up.ts` (DB-dependent, not pure) was checked by careful manual
re-read only, which is exactly how the two bugs above were found - this
underlines that a real database run is still needed before considering any
of these four slices actually verified.

**Deferred.** Slice 5 (Divini Profit Map). No automatic enrollment yet - a
Pipeline opportunity, Bid Studio draft, Scope Builder scope, or vendor
credential does not auto-enroll itself into its workflow on creation; a
user (or a future hook in those three route files) must call
`POST /follow-up/enroll` explicitly. No entitlement gating (workflow
automation is a Plus/Pro feature per the spec's plan table; every org
currently gets it for free).

---

## 2026-08-03 (5) - Divini Bid Studio (Slice 3 of the Divini deterministic business tools)

**What.** A structured draft-build-then-submit workflow for a vendor's bid,
extending the EXISTING `bids`/`bid_line_items` tables (`db/schema.sql`)
rather than duplicating them - the existing simple submission path
(`POST /api/packages/:id/bids` -> `submitPricedBid`) and the separate
`bid_items`/`package_line_items` BOQ-pricing feature are both untouched and
keep working. Bid Studio is an alternate path for a vendor who wants: line
items with optional upgrades (buyer can include/exclude), tax/discount/
deposit, a payment schedule (`bid_payment_milestones`), assumptions/
exclusions/terms, an expiration date, versioned drafts (`bid_versions`,
immutable snapshots), and reusable templates (`bid_templates` +
`bid_template_line_items`, "save as template" / "apply template" actions).

- **Deterministic totals** (`server/src/lib/bid-totals.ts`, pure, zero IO,
  10 tests): subtotal = sum of qty x unit price for included line items (an
  optional line item counts only if explicitly selected); total = subtotal
  minus discount plus tax, never negative; deposit is either an explicit
  amount or a percentage of the total. This is the one place in the codebase
  that converts the existing DOLLAR-denominated `bids.price`/
  `bid_line_items.unit_price` columns into integer CENTS, matching the
  money convention used everywhere else built this session.
- **Deterministic readiness score**, same checklist pattern as the previous
  two slices: has a line item, total > 0, expiration set, terms set, deposit
  terms set, assumptions/exclusions listed - 100 points, always shown with
  its breakdown, never a gate beyond basic input validation (at least one
  line item and a positive total are required to submit - that's input
  validation, not a business judgment about the bid).
- **On submit**, the computed total is written into the existing
  `bids.price` column (dollars) alongside the new cents-based breakdown
  columns, so award-workflow.ts, quote-compare, `bid_recommendations`, and
  purchase-order creation all keep reading the same field they always have.

**A real bug caught in self-review, fixed before commit.** The first draft
let a vendor edit line items, milestones, or tax/discount/deposit on a bid
AFTER it was already submitted - since `total_cents`/`price` are only
recomputed at submit time, this would have silently desynced the stored
total from the underlying line items. Found the existing convention for
this in `change-orders.ts` ("fields are only editable while draft") and
added the same guard (`draftEditBlockReason`) to every mutation endpoint.
Also matched the `toTextArray()` + `::text[]`-cast pattern from
`products.ts` for the `exclusions` array field, same as the Scope Builder
fix last commit.

**Files.** `db/schema-bid-studio.sql` (new, additive ALTERs + new tables,
synced into `db/apply-all.sql`), `server/src/lib/bid-totals.ts`,
`server/src/routes/bid-studio.ts` (mounted at `/api/bid-studio`),
`src/pages/BidStudio.tsx`, nav entry in `src/components/Shell.tsx` (vendor
Workspace section), route in `src/App.tsx`,
`tests/bid-totals.test.ts` (10 new tests, all pure - no DB).

**Permissions.** Same single-owner model as Pipeline and Scope Builder: a
draft belongs to its `vendor_company_id`; access = member of that company,
or admin. This is the vendor's own workspace for building a bid, not a
shared record with the developer until submitted.

**Tests completed.** Unit tests only (10, all passing) for the pure totals/
readiness functions. Server and SPA typecheck clean. **Not tested against a
live database or in a browser** - same sandbox limitation as the previous
two slices (no Docker, no `DATABASE_URL`, nothing on 5432/5433). Verified by
careful manual read of the SQL and route logic; still needs a real
`apply-all.sql` run + UI smoke test.

**Known gap, not fixed this pass.** The frontend doesn't yet hide the
line-item edit/remove controls once a bid is submitted - the backend
correctly rejects the request (400, "only a draft can be edited"), but the
UI will show a now-disabled-looking action without explaining why until the
user clicks it. Cosmetic, not a data-integrity issue.

**Deferred.** Slice 4 (Divini Follow-Up Desk), Slice 5 (Divini Profit Map).
No entitlement gating yet. No integration yet with Divini Scope Builder's
line items (a published scope's structured fields don't auto-populate a Bid
Studio draft's line items) - `bids.scope_instance_id` exists as a link but
nothing reads it yet.

---

## 2026-08-03 (4) - Divini Scope Builder (Slice 2 of the Divini deterministic business tools)

**What.** Structured, trade-specific requirement definitions for a bid
package - typed fields (text/number/quantity/date/boolean/select/multiselect)
from a reusable template, not a free-text blob. Five global default templates
seeded (electrical, plumbing, HVAC, concrete, general labor), each with a
handful of trade-specific fields (e.g. electrical: square footage, panel
amperage, circuit count, permit-pulled-by); an organization can define its
own custom template via `POST /scope/templates`.

- Every scope carries six standard narrative sections that apply regardless
  of trade: site conditions, access restrictions, delivery requirements,
  install requirements, exclusions (list), acceptance criteria (list), and
  change-order rules.
- **Deterministic completeness score** (`server/src/lib/scope-completeness.ts`,
  pure, zero IO, 8 tests): required template fields answered count for 40 of
  100 points (proportional), the six standard sections split the remaining
  60. Never a gate on publishing - informational only, shown with its
  positives/missing breakdown, per spec requirement 6 ("never make binding
  decisions for the user").
- **Publishing takes an immutable snapshot** (`scope_versions`, one row per
  publish/republish, never updated) and syncs the scope into
  `packages.requirements` (text[]) as readable lines - the first real writer
  of that column, which `server/src/routes/intel.ts`'s vendor-package
  matching already reads. This is the "publish scope into the RFP" step from
  the spec, scoped to what already exists (package requirements) rather than
  inventing a new RFP/contract document type.
- `scope_change_events` is an append-only log (created/field_updated/
  published/republished/archived) - the audit trail for what changed and
  when.

**Files.** `db/schema-scope-builder.sql` (new, synced into `db/apply-all.sql`),
`server/src/lib/scope-completeness.ts`, `server/src/routes/scope-builder.ts`
(mounted at `/api/scope`), `src/pages/ScopeBuilder.tsx`, nav entry in
`src/components/Shell.tsx` (buyer Procurement section only - this is a
developer/procurement-side tool), route in `src/App.tsx`,
`tests/scope-completeness.test.ts` (8 new tests, all pure - no DB).

**A real bug caught in self-review, fixed before commit.** The first draft of
the `PATCH /scope/instances/:id` route passed JS arrays (`exclusions`,
`acceptanceCriteria`) straight into a parameterized query bound to a
`text[]` column with no explicit cast and no input normalization. Found the
existing precedent in `server/src/routes/products.ts` (`toTextArray()` +
explicit `::text[]` casts) and matched it - added the same helper and casts
here and in the `packages.requirements` write.

**Permissions.** Same model as Divini Pipeline: a `scope_instance` belongs to
exactly one `organization_id`; access = member of that company, or admin.
Global templates (`organization_id` null) are readable by any signed-in
user; an org's own custom templates are scoped to its members.

**Tests completed.** Unit tests only (8, all passing) for the pure
completeness function. Server and SPA typecheck clean. **Not tested against
a live database or in a browser** - same sandbox limitation as Divini
Pipeline (no Docker, no `DATABASE_URL`, nothing on 5432/5433). Verified by
careful manual read of the SQL and route logic only; still needs a real
`apply-all.sql` run + UI smoke test.

**Deferred.** Slice 3 (Divini Bid Studio), Slice 4 (Divini Follow-Up Desk),
Slice 5 (Divini Profit Map). No entitlement gating yet (every org gets
unlimited custom templates and scopes). The "publish into quote request /
proposal / contract" steps beyond `packages.requirements` are not built -
Bid Studio (Slice 3) is where a scope would actually flow into a vendor-
facing bid form.

---

## 2026-08-03 (3) - Divini Pipeline (Slice 1 of the Divini deterministic business tools spec)

**What.** First build from the "Divini deterministic business tools" spec
(construction-domain adaptation: no LLM dependency, branded tools, deterministic
scoring, structured data capture). Divini Pipeline is a user-facing sales/
procurement CRM, distinct from the existing `crm_records` (`db/schema-crm.sql`),
which is Divini's own INTERNAL pipeline for signing up customers - Divini
Pipeline is what a vendor or developer uses to run their OWN funnel:
- **Vendor profile_type**: bid opportunities pursued, stage new -> reviewing ->
  qualified -> info_needed -> bid_in_progress -> bid_submitted -> negotiation ->
  awarded/lost.
- **Developer profile_type**: vendor-sourcing funnel per package, stage new ->
  reviewing -> info_needed -> sourcing_vendors -> bids_in -> comparing ->
  negotiation -> awarded/lost.
- One shared schema/engine serves both profile types (stage definitions are
  org-customizable with a seeded global default per profile type), per the
  spec's "reusable shared engine, not a duplicate per profile" principle.
- **Deterministic readiness score** (`server/src/lib/pipeline-score.ts`, pure,
  zero IO): 8 fixed-point factors (estimated value, next action + date,
  expected close date, category, linked to a real bid/package, client contact
  on file, recent activity within 14 days, an open non-overdue task) summing to
  exactly 100. Never a prediction - always shown with the exact positives/
  missing list that produced it, per spec requirement 8 ("clearly show how
  every output was calculated").
- Full CRUD: opportunities, append-only stage history (never overwritten,
  audit trail for time-in-stage), activities (call/email/note/meeting/
  site_visit), tasks, tags, org-configurable loss reasons and lead sources.
- Stage transitions into a stage flagged `is_won`/`is_lost` automatically set
  `status`/`won_at`/`lost_at` - `status` has no direct free-form write path,
  it only ever derives from a real stage transition.

**Files.** `db/schema-pipeline.sql` (new, synced into `db/apply-all.sql`),
`server/src/lib/pipeline-score.ts`, `server/src/routes/pipeline.ts` (mounted
at `/api/pipeline` in `routes.ts`), `src/pages/Pipeline.tsx`, nav entries in
`src/components/Shell.tsx` (buyer + vendor Quick Actions/Workspace), route in
`src/App.tsx`, `tests/pipeline-score.test.ts` (8 new tests, all pure - no DB).

**Permissions.** An opportunity belongs to exactly one `organization_id`
(unlike a purchase order, this is not a shared record between two companies).
Access = member of that company, or admin.

**Tests completed.** Unit tests only (8, all passing) for the pure scoring
function - exact-100 factor sum, empty-input zero score, recency threshold
boundary, overdue-vs-no-task distinction, both-required next-action check.
Server and SPA typecheck clean. **Not tested**: no live Postgres is available
in this sandbox (checked - no Docker, no `DATABASE_URL`, nothing listening on
5432/5433), so the schema and routes were not exercised against a real
database or verified in a browser. Reviewed the SQL and route logic carefully
by hand as the only available substitute; this still needs a real
apply-all.sql run + manual UI smoke test before considering it verified.

**Deferred (per the spec's own build order).** Slice 2 (Divini Scope Builder),
Slice 3 (Divini Bid Studio), Slice 4 (Divini Follow-Up Desk), Slice 5 (Divini
Profit Map), and the rest of the 12-slice roadmap. Entitlement gating
(Free/Plus/Pro limits on opportunity count, custom stages, automation) is not
implemented yet - every org currently gets the full feature set.

---

## 2026-08-03 (2) - Capital Partner module: rename + compliance boundary + tier ladder

**What.** Product-facing rename of "Investor"/"Investment" to "Capital
Partner"/"Capital" across ~35 files (nav, page headings, form labels, toasts,
admin UIs, the compliance disclaimer, the English i18n source string).
Deliberately did NOT rename: route paths (`/investor`, `/investment-profile`,
...), the `companies.kind`/`subscription_tiers.audience`/permission-level
enum values (all stay `'investor'` at the database level - "historical
database fields," per instruction), or file names.

- **Compliance boundary audit**: confirmed no waterfall/IRR, capital-call, or
  distribution engine exists (correct, per spec); removed the one thing that
  did cross the line - a dormant `capital_introduction` fee-rule type (2%,
  "for investor matching") in the `fee_rules` matrix. It was never actually
  invoked by any route, but its existence was itself a "success fee for
  capital introduction" capability the spec forbids. Removed from
  `FEE_RULE_TYPES`, the DB check constraints, the seed data (with a `delete`
  for any already-seeded row), and the two admin UIs that listed it
  (`AdminFeeMatrix.tsx`, `AdminRevenue.tsx`, which also picked up the
  `platform_infrastructure_fee` type that was missing from their pickers).
- **Capital Partner subscription tiers**: replaced `investor_basic` ($0) /
  `investor_qualified` ($499/mo) / `family_office_concierge` ($999/mo) with
  the spec's four-tier ladder in `subscription_tiers`: `capital_partner_free`
  ($0), `capital_partner_professional` ($49/mo), `capital_partner_institutional`
  ($149/mo), `capital_partner_enterprise` (custom, null price). Also updated
  the separate, actually-live `investor_profiles.plan` admin-assignment
  mechanism (`free`/`premium`/`concierge` -> `free`/`professional`/
  `institutional`/`enterprise`) with a defensive migration for any
  already-set legacy value.
- Added a `VISIBILITY_LABEL` display-only map in `InvestmentPrograms.tsx` so
  wire values like `approved_investor_preview` (a real DB enum, left
  unrenamed) render as "approved capital partner preview" without touching
  the underlying value.

**Files.** ~35 files across `src/pages/`, `src/components/`, plus
`server/src/lib/{entitlements,fee-matrix,monetization}.ts`,
`server/src/routes/subscriptions.ts`, `db/schema-{fee-matrix,revenue,
subscriptions,tiers-monetization}.sql`, `db/apply-all.sql`.

**Risks / not done.**
- **Pipeline stage vocabulary NOT remapped.** The spec's new stages
  (Potential Match, Invited, Access Requested, Access Granted, Reviewing,
  Questions Submitted, Due Diligence, Meeting Scheduled, Following, Closed,
  Archived) do not exist yet; the app still uses the old
  `investor_introduction_requests.pipeline_status` values (`matched`,
  `intro_approved`, `nda_required`, ...), which don't map 1:1. This needs a
  deliberate follow-up (label map at minimum, or a real stage migration),
  not a same-turn text rename.
- **Dormant capital-commitment tracking still exists**, separate from the
  fee I removed: `investor_introduction_requests` has a `soft_commitment`
  pipeline status and a `committed_amount_cents` column, and
  `AdminAnalytics.tsx` has a "Capital committed / Capital closed" KPI section
  reading from them (`server/src/routes/analytics.ts`). Nothing currently
  writes to these (always renders $0 in practice), but their existence is
  schema-level "capital commitment" capability the spec says not to build.
  Flagged, not removed - removing needs a deliberate decision, not a
  drive-by deletion during a rename pass.
- **12 non-English i18n locale files** (`src/i18n/locales/{es,fr,de,...}.ts`)
  still have the old translated string for `roleInvestor`; only the English
  source was updated. Translation is a separate task.

**Next.** Decide on the pipeline-stage remap and the dormant
commitment-tracking removal; translate `roleInvestor` into the other 12
locales.

---

## 2026-08-03 - Unified platform fee model (single source of truth), always-on

**What.** Replaced the three competing fee models (legacy uncapped 10%/2%,
flag-gated Monetization V2's 2%-capped-$2,500/1%-capped-$1,000) with ONE
database-driven model, always active (not flag-gated):
- Standard platform fee: 5%, capped at $25,000.
- Existing-relationship (grandfathered) fee: 2%, capped at $10,000.
- Platform infrastructure fee: 0.1%, capped at $1,500, always its own line
  item, never merged into the platform fee or labeled as a processor fee.
- All three are resolved from the `fee_rules` database table
  (`db/schema-fee-matrix.sql`, extended with a `cap_cents` column and a new
  `platform_infrastructure_fee` rule type), with `config.ts` env constants as
  the fallback default when no row exists yet. A developer- or vendor-scoped
  `fee_rules` row is an enterprise custom fee schedule.
- `payment_authorizations` gained `service_buffer_pct/cap_cents/cents`
  columns alongside the existing `success_fee_*` ones (now holding the
  unified platform fee, not a separate V2-only number).
- `platform_revenue` now allows one ledger row per authorization PER fee type
  (`source_type` in `procurement_fee`/`infrastructure_fee`/...), fixing a
  latent bug where the old auto-resolve path wrote an orphaned ledger row
  with a null `payment_authorization_id` on every award.
- `AwardWorkflow.tsx` payment-authorization rows now have a "View breakdown"
  toggle showing the full invoice (project amount, platform fee, platform
  infrastructure fee, processing fee, taxes, total) and vendor payout (gross,
  platform fee, processing allocation, infrastructure fee allocation, net)
  line items.
- Removed the now-dead legacy fee functions (`computeFeeCents`,
  `computeSuccessFeeCents`, `computeServiceBufferCents`); `fee-matrix.ts`'s
  `resolveContextFee` is the only remaining place a fee amount is computed.

**Why.** Three parallel fee models with no single source of truth was
flagged in the launch-readiness audit as a real risk; asked directly to
consolidate on one model with the new percentages/caps above.

**Files.** `server/src/config.ts`, `server/src/lib/{feeMath,fee-rules,
fee-matrix,monetization}.ts`, `server/src/routes/award-workflow.ts`,
`db/{schema-fee-matrix,schema-revenue,schema-procure-monetization-v2,
apply-all}.sql`, `src/lib/monetization.ts`, `src/pages/{Pricing,Landing,
Onboarding,AdminConsole,AwardWorkflow}.tsx`, `tests/feeMath.test.ts`.

**Risks.** A pre-existing local/dev DB that already ran the old `fee_rules`
seed (10%, uncapped) is migrated forward by an `update` statement scoped to
rows that still exactly match the old seed values, never an admin edit.
Payment processing fee display is a placeholder ("passed through at charge
time") since no live processor charge is wired yet (Stripe is accrual-only
per `16_TECH_DEBT.md`).

**Next.** QA the new caps end-to-end once a production DB exists; consider
extending the admin fee matrix UI (`AdminFeeMatrix.tsx`) to surface
`cap_cents` for editing (currently DB/API-only).

---

## 2026-06-24 - Monetization V2 build (W1-W5), behind PROCURE_MONETIZATION_V2

**What.** Built the transaction-marketplace money + verification model, flag-gated.
- W1 success-fee math: `successFeeCents` (`lib/feeMath.ts`), `computeSuccessFeeCents`
  (`lib/fee-rules.ts`); env constants in `config.ts`
  (`PROCURE_SUCCESS_FEE_PCT=2`, cap 250000; grandfathered 1%, cap 100000).
- W2 bid credits + verification gate: `lib/bidCredits.ts` (5/quarter, no rollover),
  `lib/verificationGate.ts`; wired into bid submit in `routes.ts`; credential
  expiry tracking + auto-revoke in `routes/verification.ts`.
- W3 subscriptions + Featured + Verified+: `lib/entitlements.ts`,
  `routes/subscriptions.ts`, `routes/featured.ts`, `db/featured.ts`.
- W4 onboarding + bid UI + dashboards (`src/pages/`).
- W5 pricing page (`src/pages/Pricing.tsx`), landing, badges
  (`src/components/VendorBadges.tsx`, `FeeBadge.tsx`).
- Award wiring: `routes/award-workflow.ts` records success fee on
  `payment_authorizations` at Award.

**Why.** Monetize access + outcomes (capped success fee + vendor upgrades), never
the buyer, with verification as the trust moat. See `05_BUSINESS_CONTEXT.md`.

**Files.** `server/src/config.ts`, `server/src/lib/{feeMath,fee-rules,bidCredits,
verificationGate,entitlements,monetization,relationships}.ts`,
`server/src/db/featured.ts`, `server/src/routes/{award-workflow,verification,
subscriptions,featured,fee-matrix,vendor-pricing,grandfathered-fees}.ts`,
`db/schema-procure-monetization-v2.sql`, many `src/pages/` + `src/components/`.

**Risks.** Flag not yet flipped; vendor credential-upload endpoint and some
dashboard summary endpoints are follow-ups (see `12_TASK_QUEUE.md`). `verify_status`
verified value is `approved`.

**Next.** Wire credential upload, first deploy, set email key, flip the flag.

---

## 2026-06-24 - Security hardening + first-deploy readiness

**What.** Prod fail-closed `SESSION_SECRET` / `DOWNLOAD_URL_SECRET`; deny-by-default
CORS when the allowlist is empty in prod; per-IP auth rate limiting (20/min on
`/api/auth`); created `db/apply-all.sql` (~110 tables, parents-first, idempotent);
rewrote `DEPLOY.md` to the real self-hosted loop; created `FIRST-DEPLOY-RUNBOOK.md`;
scrubbed stale Supabase keys/URLs.

**Why.** Make a misconfigured prod box refuse to start rather than run insecure;
make a first deploy reproducible.

**Files.** `server/src/config.ts`, `server/src/app.ts`, `server/src/lib/rateLimit.ts`,
`db/apply-all.sql`, `DEPLOY.md`, `FIRST-DEPLOY-RUNBOOK.md`, `README.md`.

**Risks.** Prod now requires the secrets to be set before first boot.

**Next.** Set prod env, deploy.

---

## 2026-06-24 - Legal pages, object storage + encryption, tests + CI

**What.** Terms + Payment + Non-Circumvention + Messaging policy pages (Privacy
already existed). Pluggable object storage (`local`|`s3`) with optional AES-256-GCM
encryption at rest. node:test suite (feeMath incl success fee, bidCredits,
passwordHash) -> 39 tests; `.github/workflows/ci.yml` (tsc + test).

**Files.** `src/pages/{Terms,PaymentPolicy,NonCircumvention,MessagingPolicy}.tsx`,
`server/src/lib/{objectStorage,storageCrypto,s3sigv4}.ts`, `tests/*.test.ts`,
`.github/workflows/ci.yml`, `OBJECT-STORAGE.md`.

**Risks.** Storage encryption key, if set, must be preserved (losing it loses files).

**Next.** Manual QA of upload/download + decryption in a deployed env.

---

> Older history (Authentik/Supabase, gap-closure waves, the six-system batch,
> grandfathered 2% fee, super-admin port) predates this OS and lives in the repo
> `CHANGES.md` and the workspace planning docs.
