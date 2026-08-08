# Control Register

One row per control across all ALFY2 sections. Append-only within a section;
do not delete a prior section's rows when starting a new one (per Section 00
cross-section continuity rule). Re-test and update `Last Checked` when a
control's status changes.

| Control ID | Section | Requirement | Priority | Applicability | Status | Evidence | Risk | Remediation | Validation | Owner/Action | Last Checked |
|---|---|---|---|---|---|---|---|---|---|---|---|
| S01-01 | 01 | Architecture/data-flow map exists and is accurate | P1 | Required | PASS | `docs/platform-standard/architecture-map.md`, cross-checked against `AI_PROJECT_OS/04,20,21,22,23,24` and direct code inspection of `server/src/config.ts`, `pool.ts`, `stripe.ts`, `stripe-connect.ts` | Low | — | Read against live `server/src/*` this session | — | 2026-08-08 |
| S01-02 | 01 | Actor/capability inventory covers every real persona | P1 | Required | PASS | `applicability-register.md` actor table; confirmed no guardian/minor, health, education, or background-check actor exists via `grep` across `db/schema-*.sql` | Low | — | Grep for `create table` matches against expected regulated-actor schemas returned none | — | 2026-08-08 |
| S01-03 | 01 | Data classification inventory | P1 | Required | PASS | `applicability-register.md` data table | Medium | Referral-partner banking `account_number` stored in cleartext — tracked as S06 finding, not fixed in this section (out of Section 01 scope; Section 01 is discovery, not remediation of a Section 06-owned control) | Confirmed by reading `db/schema-referral-partner-onboarding.sql` directly | Section 06 owner | 2026-08-08 |
| S01-04 | 01 | Regulatory applicability matrix populated with evidence, not assumption | P1 | Required | PASS | `applicability-register.md` regime table, 30 regimes assessed, each with an evidence citation | Low | Securities-law item is a genuine open question, not a defect — flagged for counsel, not "fixed" | N/A — applicability determination, not a testable code control | `COUNSEL/OWNER REVIEW REQUIRED` on securities-law item and multi-state privacy thresholds | 2026-08-08 |
| S01-05 | 01 | Certification/attestation classification, HIPAA correctly NOT treated as a certification | P1 | Required | PASS | `applicability-register.md` certification table; HIPAA is absent from that table by design (it is a legal-compliance question, assessed separately in the regime table as N/A) | Low | — | — | — | 2026-08-08 |
| S01-06 | 01 | Output gate: later sections tagged REQUIRED/CONDITIONAL/N/A | P1 | Required | PASS | `applicability-register.md` output-gate table | Low | — | — | — | 2026-08-08 |
