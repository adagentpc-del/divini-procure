# 11 Active Sprint

**Sprint goal:** Get Divini Procure from "built behind the flag" to its **first
production deploy**, and close the last wiring gaps so the Monetization V2 flag
can be flipped with confidence.

**Window:** > TODO(owner): set sprint start/end dates.

## In flight

- [ ] **Wire vendor credential-upload endpoint** - `POST /me/verification/documents`
      storing `credential_type` + `expires_at` + `doc_status` (the vendor side of
      `routes/verification.ts`; admin review already exists). See `12_TASK_QUEUE.md`.
- [ ] **First production deploy** - per `FIRST-DEPLOY-RUNBOOK.md` (rsync ->
      apply-all.sql twice -> deploy.sh -> pm2). Requires prod secrets + email key.
- [ ] **Set email key** - `EMAIL_PROVIDER=resend` + `EMAIL_API_KEY` so
      register -> verify -> login works. Verify with the send-test-email script.

## Queued for this sprint (stretch)

- [ ] Light up dashboard summary endpoints (`/api/me/success-fees`,
      `/api/admin/monetization-summary`, RFQ verified-only preferences).
- [ ] End-to-end success-fee money-math QA (new pair 2% cap, grandfathered 1% cap).

## Not in this sprint

- Flipping `PROCURE_MONETIZATION_V2=true` in production (do after deploy + smoke).
- iOS native build (Mac-only; separate track, `IOS-APP-STORE-RUNBOOK.md`).
- Revenue-rebuild extras (capital introductions, enterprise OS, payment spreads).

> Update this file as items move in or out of the active sprint.
