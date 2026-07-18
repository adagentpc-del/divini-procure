# Divini Procure — Stripe Refund Ops Runbook

## Overview

Divini Procure does not have an in-app refund route. All refunds are issued manually through the Stripe Dashboard or Stripe CLI. This is intentional — refunds involve revenue impact and require human review before issuance.

---

## When to Issue a Refund

| Scenario | Action |
|---|---|
| User charged for a subscription but did not receive access (provisioning failure) | Full refund + re-provision access |
| Duplicate charge (webhook fired twice, user charged twice) | Refund the duplicate charge |
| User cancels within refund window (check your Terms of Service) | Refund per policy |
| Chargeback threat — user opened a dispute | Do NOT refund through dashboard — respond to dispute in Stripe |
| Fraudulent transaction (stolen card) | Issue refund; Stripe may already have flagged it |

---

## How to Issue a Refund — Stripe Dashboard

1. Log in to [dashboard.stripe.com](https://dashboard.stripe.com) with your production account.
2. Navigate to **Payments** → search by customer email, charge ID, or PaymentIntent ID.
3. Click the charge you want to refund.
4. Click **Refund** (top right of the charge detail page).
5. Choose:
   - **Full refund** — refunds 100% of the charge
   - **Partial refund** — enter the amount in dollars
6. Select a **reason** from the dropdown (duplicate, fraudulent, requested\_by\_customer).
7. Add an internal **note** describing why the refund was issued (for your records).
8. Click **Refund**.

Stripe sends an automated refund notification email to the customer. No additional email from Divini Procure is sent for refunds.

---

## How to Issue a Refund — Stripe CLI

For high-volume or scripted situations:

```bash
# Refund a full payment intent
stripe refunds create --payment-intent pi_XXXXXXXXXXXXXXXX

# Partial refund ($25.00)
stripe refunds create --payment-intent pi_XXXXXXXXXXXXXXXX --amount 2500

# Use --live flag for production (CLI defaults to test mode)
stripe refunds create --payment-intent pi_XXXXXXXXXXXXXXXX --live
```

---

## Stripe Connect — Vendor Payout Reversals

Divini Procure uses Stripe Connect to split payments to vendors. If a payout to a connected vendor account needs to be reversed:

1. This can only be done within a short window after the transfer (before funds leave Stripe).
2. In Stripe Dashboard → **Connect** → **Transfers**, find the transfer.
3. Click the transfer → **Reverse transfer**.
4. If funds have already been paid out to the vendor's bank, a reversal will create a negative balance on their Stripe Connect account. They must cover it before receiving future payouts.
5. Coordinate with the vendor before reversing a transfer.

---

## Subscription Cancellation vs. Refund

- **Cancellation only** — use Stripe Dashboard → Customers → Subscriptions → Cancel. User loses access at end of billing period. No money returned.
- **Cancellation + refund** — cancel the subscription AND issue a refund on the most recent charge. Do both steps.
- **Immediate cancellation with proration** — Stripe can calculate unused days. Use the CLI:
  ```bash
  stripe subscriptions cancel sub_XXXXXXXXXXXXXXXX --prorate
  ```

---

## Chargeback / Dispute Response

Do NOT issue a refund when a dispute is open — Stripe will return the funds automatically if you lose, and issuing a refund while a dispute is open can complicate the process.

1. In Stripe Dashboard → **Disputes**, find the dispute.
2. Review the evidence Stripe recommends (invoice, email confirmation, Terms of Service, usage logs).
3. Pull the relevant audit logs from the Divini Procure database:
   ```sql
   SELECT * FROM audit_logs WHERE user_id = 'USER_ID' ORDER BY created_at DESC LIMIT 100;
   SELECT * FROM payout_audit WHERE created_at > '2026-01-01' ORDER BY created_at DESC;
   ```
4. Submit evidence through the Stripe Dashboard before the response deadline.

---

## Logging and Records

After issuing any refund:
- [ ] Add a note in the Stripe charge with the reason
- [ ] Record the refund in your internal ops log (Notion, Airtable, or email thread)
- [ ] If the refund is > $500, notify Alyssa

---

## Future: In-App Refund Route

When the platform reaches sufficient volume, consider adding an admin-only refund route:

```
POST /api/admin/refunds
Body: { chargeId: string, amount?: number, reason: string }
```

This would call `stripe.refunds.create()` server-side and log the action to `audit_logs`. Requires `requireAdmin` middleware and a confirmation step.

---

*Last updated: 2026-07-18*
