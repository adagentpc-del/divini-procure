# Data Retention Matrix

Per ALFY2 Section 02.D. This is a documentation-only deliverable this pass —
no automated retention/deletion job exists yet (`data_retention_policies` is
not built; see the gap noted below). Populated from the real data classes
inventoried in `applicability-register.md` and the tables that back them.

| Data category | Purpose | Retention period | Trigger event | Deletion/anonymization action | Legal hold override | Owner | Enforcing job |
|---|---|---|---|---|---|---|---|
| Auth credentials (`users.password_hash`, verify/reset tokens) | Login | Life of account | Account deletion | Row deleted (`db.deleteMyAccount`, cascades) | N/A | Engineering | Manual (user-initiated) |
| Sessions (`user_sessions`) | Keep a user logged in | 30 days from issuance, or until logout/deletion | Logout, password reset, account deletion, natural expiry | Row deleted (explicit on logout/reset) or cascade-deleted (account deletion); `expires_at`-based rows are never actively purged today | N/A | Engineering | **Gap: no cron/job purges expired-but-undeleted rows; `deleteExpiredSessions`-shaped helper exists in `db.ts` (line ~1082) but nothing currently calls it on a schedule** |
| Legal acceptances (`user_legal_acceptances`, `users.terms_*`) | Prove consent (E-SIGN) | Indefinite (evidentiary record) | Never actively deleted; cascades only on account deletion | Cascade on account deletion | Should survive account deletion for a limited window if a dispute is pending — **not currently implemented**; today deletion is immediate and total | Engineering + Legal | None |
| Vendor credentials (license, GL insurance, workers comp, trade cert, W-9, bonding) | Verification gate | Life of vendor relationship + a reasonable post-relationship window for dispute defense | Credential expiry (auto-revokes Verified status), account deletion | File deleted from storage + DB row on account deletion; expired-but-not-deleted credentials remain visible as "expired" (not purged) | Yes — should be held if a dispute/award is contested | Engineering + Business | None automated |
| Referral-partner banking info (`referral_partner_banking.account_number`) | Payout | Life of partner relationship | Partner offboarding | **Not defined** — no deletion path found for this table | Yes, for payout-dispute defense | Business + Engineering | None |
| Project/bid/award documents | Core product function | Life of project + reasonable archival period | Explicit deletion is not exposed to users for these (they live inside a project/company's own data) | Deleted via account/company deletion cascade only | Yes — award/payment-authorization records should never be deleted while a fee is owed | Engineering + Business | None automated |
| Investment offering documents, NDA records | Investor due diligence | Life of the program + archival period | Program closes | Not currently defined | Yes, strongly — securities-adjacent records | Engineering + Legal | None |
| Audit logs (`document_access_log`, `dvr_audit_log`, `change_order_audit`, `fee_rule_audit`, `investment_audit_log`, `campaign_blast_audit`, `ownership_transfer_audit`) | Security/compliance evidence | Indefinite by design (these are the evidence, not the primary record) | Never | Never deleted; not exposed to users to delete | Always | Engineering + Legal | None |
| CRM records (`crm_records`) | Admin-owned lead/contact tracking | Until admin deletes or the associated user deletes their account | Account deletion (matches by email — see `routes.ts:284`) | Explicit `delete from crm_records where email matches` before user deletion | No | Business | Wired in `POST /account/delete` |
| AI prompts/outputs (drafting, extraction, matching/scoring) | Product feature | **Not defined** — depends on the LLM provider's own retention policy for prompts sent to it, plus however long any generated output is stored in the app's own tables | Not defined | Not defined | N/A | Engineering (Section 08 owns full audit) | None |

## Gaps identified (not fixed this pass — documentation only, per Section 02.D scope; a follow-up implementation pass would need to build an actual `data_retention_policies`-backed job)

1. No automated retention-enforcement job of any kind exists. Every row above marked "None"/"None automated" in the Enforcing-job column relies entirely on the one-shot cascade at account deletion — there is no background process purging expired sessions, stale credentials, or time-boxed records independent of a user actively deleting their account.
2. Legal-hold override is a column concept in the ALFY2 pack's recommended `data_retention_policies` table but has **no implementation** here — if a dispute or investigation required Divini to preserve a specific account's records past a normal deletion request, there is currently no mechanism to flag and exempt that account from the immediate, total deletion `db.deleteMyAccount` performs.
3. Referral-partner banking info has no defined retention or deletion path at all (separate from the plaintext-storage finding already tracked as risk R-01).

## Validation performed this pass (Section 02.G)

1. **New user sees current legal documents** — PASS. `Register.tsx` links Terms/Privacy; registration is rejected without `agreed: true` (`auth-native.ts:184-187`).
2. **Acceptance version is persisted** — PASS (upgraded this pass). `users.terms_version` held the most recent value only; `user_legal_acceptances` now records every acceptance event with its version, verified live: a fresh vendor registration produced one `terms` row (source `register`) and one `vendor_agreement` row (source `onboarding`) with real timestamps and IPs (see evidence register).
3. **Policy links work from public site and account settings** — PASS. Confirmed `/cookies`, `/privacy`, `/accessibility` routes exist as pages (`src/pages/Cookies.tsx`, `Privacy.tsx`, `Accessibility.tsx`); `CookieBanner.tsx` links `/cookies` and `/privacy`.
4. **Privacy export returns only the correct user's data** — PASS. `exportMyData(userId)` scopes every query to the caller's own `user_id` or their own `company_id`s only (`server/src/db.ts:571-618`); redacts password/token/secret columns before returning.
5. **Deletion cannot delete another user's account** — PASS. `POST /account/delete` takes no target-user parameter; it always operates on `auth.userId` from the verified session (`routes.ts:275-293`).
6. **Deletion revokes sessions/tokens and prevents login** — PASS (verified this pass, corrected an earlier working assumption that this was missing). `user_sessions.user_id` has `references users(id) on delete cascade` (`db/schema-sessions.sql:7`), and `auth.ts`'s `verify()` checks `isSessionActive(jti)` against `user_sessions` on every request — so a deleted account's outstanding session tokens fail immediately, not just at natural 30-day expiry.
7. **Retained records are documented** — PASS this pass, via this file; **not yet true that they are "no longer exposed as active profile data"** in every case (see gaps above) — PARTIAL overall on this specific validation item.
8. **Marketing opt-out actually suppresses delivery** — **Not tested in this pass**; carried to Section 10 (Email/SMS/push/marketing compliance), which owns marketing-preference enforcement.

## New control implemented this pass

**Vendor Agreement acceptance is now server-recorded, not just client-gated.**
Before this pass, the "I have read and accept the Vendor Agreement" checkbox
in `Onboarding.tsx` only disabled the submit button client-side — the
`POST /companies` payload never included the acceptance, and the server
never checked for or stored it. A vendor who disputed the platform's 5%
success fee later would have found **zero server-side evidence** they ever
agreed to it, unlike Terms-of-Service acceptance, which was already
properly recorded. Fixed:

- `POST /companies` now rejects vendor company creation with
  `400 { error: "Vendor Agreement must be accepted..." }` unless
  `vendorAgreementAccepted: true` is present in the body (server is
  authority — rule 6 — a direct API call can no longer bypass the checkbox).
- On acceptance, a row is written to the new `user_legal_acceptances` table
  (`document_type: 'vendor_agreement'`, versioned, with IP and source).
- Verified live end to end: (a) a Playwright run through the real
  Onboarding UI produced a `vendor_agreement` row with `source='onboarding'`;
  (b) a direct `curl` to `POST /companies` with
  `kind: 'vendor'` and no `vendorAgreementAccepted` field returned
  `400`; (c) the same call with `vendorAgreementAccepted: true` returned
  `201` as expected.
