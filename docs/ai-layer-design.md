# Divini Procure — Selective AI Layer Design (Ask Divini / Procurement Graph)

**Status: DESIGN PROPOSAL ONLY. Nothing in this document is built.** This is a
scoping pass, requested explicitly as the next phase after platform hardening.
It is written against the same standing constraint the last two engagements
were built under (Phase 0's AI/Procurement Graph freeze, restated in Phase 1):
no Procurement Graph, Ask Divini, predictive cost benchmarking, or predictive
vendor ranking has been built. This document proposes the architecture for
if/when that's authorized, and is explicit about the smallest safe first
slice — it is not itself the authorization to start building it. Treat it the
same way `docs/canonical-procurement-financial-model.md` and
`docs/procurement-graph-readiness.md` were treated in Phase 0: a target to
build toward, reviewed before anything is implemented.

## 1. What "only calls AI when it needs to" means, concretely

This phrase is a real architectural constraint, not a vibe. It means three
specific things, all already true of this codebase's existing 3 AI touch
points (`intel.ts`'s quote narrative, `blueprint.ts`'s AI summary fields,
`onboarding.ts`) and must stay true of everything new:

1. **Deterministic answer first, AI narration second, never the reverse.**
   Every number, score, or fact a user sees is computed by ordinary code
   from real rows. The LLM is never the source of a number - it is, at
   most, a sentence wrapped around numbers that already exist and were
   already computed correctly without it. If `llmEnabled()` is false (the
   default), the feature must degrade to "no narration," never "no
   feature" and never "wrong number."
2. **AI is called on an explicit trigger, not a page render.** A dashboard,
   a list, a summary panel - none of these call an LLM just because a user
   opened a page. AI runs only when: (a) a user explicitly asks a question
   in a NL query box ("Ask Divini"), or (b) a user explicitly triggers a
   one-time extraction/analysis action on content they just uploaded (a
   button press, not a page load), or (c) a background job processes
   something once and caches the result (see §4). Every existing AI call
   site in this codebase already follows this rule; nothing new should
   weaken it.
3. **Every AI call is capped and reused, never repeated for free.** Rate
   limiting (`llmRateLimit`, per-user, already exists) and caching
   (`TtlCache`, added this pass - H-01) both apply to every new AI call
   site by default, not as an afterthought bolted on later.

## 2. What already exists to build on (verified, not assumed)

| Piece | File | What it gives the AI layer |
|---|---|---|
| Deterministic relationship/reputation engine | `server/src/lib/procure-moat.ts` | Divini Score, relationship graph edges, War Room flags - all pure functions over real rows, zero AI. This is the graph's actual foundation (see §3). |
| LLM client | `server/src/lib/llm.ts` | Fails closed, no hard dependency, every call has a timeout, credential never exportable. |
| Prompt-injection sanitizer | `server/src/lib/extract.ts`'s `sanitizeForLlm()` | Strips role-header tokens and override phrasing from any untrusted text before it reaches a prompt. Already used for website-profile extraction; reusable everywhere untrusted text meets a prompt. |
| Cost/abuse rate limiting | `server/src/lib/rateLimit.ts`'s `llmRateLimit()` | Per-user hourly caps, already applied to every existing LLM route. |
| Result caching | `server/src/lib/cache.ts`'s `TtlCache` (H-01, this pass) | Content-hash-keyed, never caches a failure - directly reusable for Ask Divini answers. |
| Canonical financial facts | `server/src/lib/financial-summary.ts`, `financial-model.ts` (Phase 1) | The exact "committed/contracted/invoiced/paid/variance" numbers a real developer would ask Ask Divini about - already computed correctly, live, from source. |
| Factual vendor-relationship signals | `server/src/lib/vendor-signals.ts` (Phase 1) | Invited/bid/awarded/final-cost facts per vendor-developer pair - the exact non-opaque, provable signal set §3 below extends. |

Nothing above needs to be rebuilt. The AI layer's job is to sit on top of
these, never to duplicate or second-guess them.

## 3. The Procurement Graph: still a deterministic aggregation layer, not an AI system

Per the Phase 0 readiness map, 3 of its 5 gaps are now closed by Phase 1:
budget/committed/spent (`financial-summary.ts`), change-order deltas
(`change_orders` + `financial-model.ts`), and an invoice-submitted timestamp
(`invoices.submitted_at` via status history) all now exist as real, correct
fields. The remaining 3 gaps are still open and are the actual Procurement
Graph build, none of it AI:

1. **Edge weighting** - `developer_vendor_relationships` is a status enum
   today. A weighted edge (transaction count, dollar volume, recency-decay)
   is a pure SQL aggregation over `purchase_orders`/`bids`, computable
   today with zero new data.
2. **Edge typing beyond developer↔vendor** - vendor↔vendor (co-bid on the
   same package) and package↔package (same building/trade) edges, both
   derivable from existing `bids`/`packages` rows, never aggregated this
   way yet.
3. **Score history, not point-in-time** - `diviniScore()` computes one
   current number. A time series needs either an append-only
   `score_snapshots` table or (preferred, matching this codebase's
   "recompute from source" convention) computing historical scores
   on-demand from timestamped source rows for a given past date.

None of this requires an LLM. It is the same kind of work `procure-moat.ts`
already does, extended. This should be built and load-tested as pure
deterministic code, independent of and before any AI interface sits on top
of it - the graph must be correct and fast on its own merits first.

## 4. Ask Divini: the one narrow, safe way to let AI touch this data

The single highest-risk part of "Ask Divini" is not the LLM call itself -
it's what data the LLM is allowed to see and whether it can generate its own
queries. This design makes one hard rule to eliminate the biggest risk
class entirely:

> **Ask Divini never writes or executes its own database query, ever.** It
> receives a pre-computed, pre-scoped JSON payload (already filtered by the
> same RLS/company-membership rules as every other endpoint) and is asked
> to summarize or answer a question about *that* payload only, the same
> way `intel.ts`'s quote-narrative prompt already works today
> ("Use ONLY the numbers provided... do not invent figures"). This is a
> retrieval-then-narrate pattern, not a text-to-SQL pattern. Text-to-SQL is
> explicitly rejected here: it would require either running LLM-generated
> queries against production (unacceptable) or an entirely separate,
> heavily sandboxed query layer (disproportionate risk for the value, and
> a second, harder-to-audit path to the same data every other endpoint
> already serves correctly).

Concretely, the flow for a question like "what packages are over budget on
this project":

1. User asks a question in a NL box, scoped to a project/company they
   already have access to (never a free-floating global query box - the
   scope is chosen by clicking into a project, matching how every other
   page in this app already establishes context).
2. The route handler runs the EXACT SAME authorization check every other
   endpoint for that resource already runs (company membership, RLS).
3. The route handler calls the EXISTING deterministic services
   (`computeProjectFinancialSummary`, `computePackageFinancialSummary`,
   `vendor-signals.ts`, `procure-moat.ts`) to assemble a small, already-
   correct JSON payload - never a raw table dump, never unfiltered rows.
4. That payload (never the user's raw question concatenated with anything
   else untrusted) goes into a prompt structurally identical to the
   existing quote-narrative one: "answer ONLY using this data; if the data
   doesn't answer the question, say so; never invent a number."
5. The answer is cached (`TtlCache`, keyed by scope + question text hash +
   a hash of the payload itself, so the moment the underlying data changes
   the cache naturally misses - identical pattern to H-01's narrative
   cache) and rate-limited per user (`llmRateLimit`).
6. The UI shows the answer with a visible "AI-generated summary of your own
   project data" disclosure, matching the existing disclaimer pattern
   Section 08 verified is real and rendered, not just returned in the API.

This means Ask Divini's real engineering cost is almost entirely in step 3
(building enough of the right pre-computed payloads) and almost none of it
is in the AI call itself, which becomes a thin, low-risk, easily-swappable
layer on top of code that already exists and is already tested.

## 5. The other AI use case: structured extraction (quote/invoice parsing)

Distinct from Ask Divini (interpretation of already-correct data), this is
AI turning unstructured input (an uploaded PDF/photo quote) into structured
data (line items into `invoice_line_items`/`bid_line_items`). This is the
"smallest Phase 2" already flagged at the end of the Phase 1 completion
report. Its trigger model is different from Ask Divini's (§1 rule 2b, not
2a): a user uploads a document and explicitly presses "extract line items"
- never automatic on upload, always a one-time, cached, user-confirmed
action (matching the existing pattern where every AI output that becomes
real data requires explicit user confirmation before it's saved - Section
08 verified this is already true of every AI-touching feature in this
codebase). Same sanitizer, same rate limiter, same "never auto-publish"
rule as everything else. Lower priority than Ask Divini for a first slice
- it touches file/document handling and OCR-quality concerns Ask Divini
does not.

## 6. What this explicitly does not propose

No vector database, no embedding model, no fine-tuning, no predictive
scoring or forecasting model (every number Ask Divini surfaces is already
computed by deterministic code - "forecast at completion" already means
"revised commitment," never a predictive AI estimate), no autonomous
agent that takes actions (Ask Divini answers questions, it never approves
a change order, releases a payment, or writes anything), no text-to-SQL, no
new pricing/monetization tier, no expansion of the investor/capital-
matching feature (a future read-only stakeholder Ask Divini view is
plausible given how this is scoped, but is explicitly out of scope for a
first slice and would need its own authorization).

## 7. Recommended smallest first build slice, if authorized

1. **Procurement Graph, deterministic only (§3), no AI.** Ship and test
   edge weighting + vendor↔vendor/package↔package edges as pure
   `procure-moat.ts` extensions. This has value on its own (a richer
   Relationship Map / War Room) even if Ask Divini is never built.
2. **Ask Divini, read-only, single-project scope, financial questions
   only.** The narrowest possible slice: one route, one payload shape
   (project financial summary + its packages), one prompt template, reusing
   every piece of existing infrastructure in §2. No portfolio-wide
   questions, no vendor-comparison questions, no free-text scope selection
   - all deliberately deferred to keep the first slice reviewable and
   small.
3. Expand payload coverage (vendor signals, procurement graph edges) and
   scope (portfolio-wide, for a company with multiple projects) only after
   step 2 is live, tested, and its cost/latency/cache-hit-rate is real
   data, not a guess.

## 8. Stop condition

This document is the design; it is not the build. Per the standing
freeze, no Procurement Graph, Ask Divini, or extraction code should be
written until this design is reviewed and a build is explicitly
authorized - the same two-step process Phase 0's design docs went through
before Phase 1 implemented the financial spine.
