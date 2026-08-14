# Accounting / ERP Export

Closes part of competitive gap #7 (docs/competitive-analysis-2026-08.md):
"deep two-way sync with QuickBooks/Sage/Viewpoint/Xero." This is the
honest slice of that gap that is buildable and verifiable without
credentials this environment does not have.

## What this is

`GET /api/reports/invoices/:buildingId.csv` exports a project's invoices
as a generic CSV: vendor name, invoice number, invoice date, PO number,
cost code, gross amount, retainage, approved amount, net payable, and
status. The column shape is deliberately generic (plain vendor/amount/
date/cost-code fields) so it can be mapped into whatever bill or journal
import a given accounting system already accepts:

- QuickBooks Online has a generic "Bills" CSV import under
  Bookkeeping -> Transactions -> Import.
- Xero has an equivalent "Bills to pay" CSV import under
  Business -> Bills to pay -> Import.
- Sage, Viewpoint, and most others have some form of generic journal or
  vendor-bill CSV import.

Each of those tools requires you to map this file's columns to its own
fields once, the same as importing a bank statement.

## What this is not

**Not a certified or tested integration with any specific product.** A
real QuickBooks Online or Xero integration is an OAuth connection to a
live account in that product, built and verified against real developer
credentials for that product. This environment has none of those
credentials, so building an integration and calling it
"QuickBooks-compatible" or "Xero-certified" without ever running it
against a real account would be a claim this session cannot back up.
What is here instead: a correct, honest generic export that a person can
map into any of those tools' own import screens today, without
overclaiming a relationship with any of those companies or their APIs.

A genuine two-way OAuth sync (auto-creating vendor bills, pulling payment
status back, reconciling automatically) is a real, larger project that
needs API credentials/app registration with each accounting platform and
testing against live sandbox and production accounts - a decision and a
resourcing question for whoever owns those relationships, not something
to fabricate here.

## Access

Same visibility as the invoices themselves (row-level security): a
developer sees every invoice on their project, a vendor sees only their
own invoices against it. Requesting a project you are not a party to
returns an empty file, not an error, matching how the underlying
`GET /invoices` endpoint already behaves.
