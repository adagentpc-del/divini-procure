# Email Setup

Divini Procure sends transactional email through the Resend HTTP API (no SMTP
dependency). Email is REQUIRED for the account lifecycle: the
register -> verify email -> login flow cannot complete unless verification mail
is delivered. If email is not configured, new users never receive their
verification link and cannot log in.

## Required environment

| Env var | Example | Notes |
| --- | --- | --- |
| `EMAIL_PROVIDER` | `resend` | must be exactly `resend` to enable sending |
| `EMAIL_API_KEY` | `re_...` | Resend API key |
| `EMAIL_FROM` | `Divini Procure <noreply@diviniprocure.com>` | verified sender |

When `EMAIL_PROVIDER` is not `resend` or `EMAIL_API_KEY` is unset, sending is
disabled: every call is logged and reports skipped, and nothing is transmitted.
This keeps non-production environments safe but means verification email is not
delivered, so leave email enabled wherever real users sign up.

`diviniprocure.com` is verified in the same Resend account as Divini Partners, so
the same `EMAIL_API_KEY` can send from either domain; `EMAIL_FROM` controls which
one is used.

## SPF / DKIM

For mail to reach the inbox (and for the verify-login flow to be reliable), the
sending domain must pass SPF and DKIM. In the Resend dashboard, add
`diviniprocure.com` as a domain and create the DNS records it provides:

- An SPF TXT record authorizing Resend to send for the domain.
- The DKIM CNAME / TXT records Resend generates for signing.
- A DMARC TXT record (for example `v=DMARC1; p=none; rua=mailto:...`) is
  recommended so you get delivery reports and can later tighten policy.

Wait for Resend to show the domain as verified before relying on delivery.
Unverified domains will fail or land in spam, which breaks registration.

## Verify delivery

A standalone test script sends one message through the real transport:

```
# build first
npm run build   # (or your server build command)

# send a test to yourself
node server/dist/scripts/send-test-email.js you@example.com
```

The recipient can also be set with the `TEST_EMAIL` env var. Source your
environment first so the script sees the email vars:

```
source .env.local
node server/dist/scripts/send-test-email.js you@example.com
```

Outcomes:

- `SENT` plus a message id: delivery succeeded; check the inbox (and spam).
- `SKIPPED`: email is disabled (`EMAIL_PROVIDER` / `EMAIL_API_KEY` not set). The
  wiring is intact but nothing was sent. Set the env vars to send for real.
- `ERROR`: the provider rejected the send; the printed error explains why (bad
  key, unverified `EMAIL_FROM` domain, etc.).

There is also a broader harness (`server/dist/test-emails.js <address>`) that
sends one sample of each Procure email type.
