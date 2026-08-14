# Divini Procure API Platform

Closes competitive gap #11 (docs/competitive-analysis-2026-08.md): "open
app marketplace / public API ecosystem... extensibility functions as a
moat and reduces switching-cost objections." This is the foundation -
personal-access-token authentication over the app's existing REST API -
not a public third-party app marketplace with billing/review/listing
(that is its own product and business decision, out of scope here).

## Authentication

Create a key from **Account -> API Keys** in the app. Send it as a
standard bearer token on any request:

```
curl https://your-divini-instance/api/me \
  -H "Authorization: Bearer dvp_live_..."
```

A key authenticates **as the company member who created it** - it is not
a separate permission system. It sees exactly what that person's session
would see (their company's data, subject to the same Row-Level Security
every other request goes through), and can do exactly what they could
do. There is no way for a key to reach data or actions its creator
couldn't already reach.

## Scopes

Every key has one or both of:

- `read` - GET requests only.
- `write` - also allowed to make POST/PATCH/PUT/DELETE requests.

A `read`-only key that attempts a write gets a `403` with
`{"error": "this API key does not have write scope"}`. Scopes only ever
*narrow* a key below its creator's real permissions; they never grant
anything beyond what that person could already do through the app.

## Rate limits

- 120 requests/minute per API key (separate from, and in addition to,
  the general per-IP request limit every route already has).
- A `429` response includes a `Retry-After` header in seconds.

## Revoking a key

Revoke from the API Keys page, or `DELETE /api/api-keys/:id`. Revocation
is immediate - the next request with that key gets `401`.

## Endpoints

There is no separate "public API" surface to learn: an API key works
against the same REST endpoints the web app itself calls, documented in
`server/src/routes.ts`'s own endpoint map at the top of that file. A few
representative read endpoints likely to be useful for an external
integration:

| Endpoint | What it returns |
|---|---|
| `GET /api/me` | Your account and company |
| `GET /api/buildings?companyId=` | Your projects |
| `GET /api/packages/:id` | A procurement package |
| `GET /api/packages/:id/bids` | Bids on a package you own (or your own bid) |
| `GET /api/reviews?vendorCompanyId=` | A vendor's public review history |
| `GET /api/payment-reputation/:developerCompanyId` | A developer's public payment-timing record |
| `GET /api/prequalification?vendorCompanyId=&buildingId=` | A vendor's compliance snapshot |
| `GET /api/invoices?...` | Invoices you're a party to |
| `GET /api/documents?packageId=` | A package's documents, if you can view that package |

Write endpoints (creating bids, uploading documents, submitting reviews,
recording payments, etc.) follow the same request shape the web app
uses for each - see the corresponding route file under
`server/src/routes/` for the exact body each one expects.

## What this is not

- Not a webhook/event-push system - integrations must poll.
- Not a public app directory with third-party listings, OAuth-on-behalf-
  of-another-company, or a review/approval process. That is a real
  product and business scoping decision (billing model, security review
  of third-party apps, a public listing surface) that belongs to its own
  pass, not something to improvise here.
- Not a replacement for session-based browser auth - both work side by
  side; a key is purely for programmatic/integration use.
