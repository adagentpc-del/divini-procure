/**
 * Divini Procure - AI COO engines (DETERMINISTIC, no external LLM).
 *
 * One company-scoped module that turns the live procurement data into an
 * executive layer:
 *
 *   businessHealth(companyId)  -> 0-100 score + per-dimension breakdown, persisted
 *   cooTasks(companyId)        -> ranked, deduped task feed from real signals
 *   dailyBriefing(companyId)   -> headline + priorities + risks + revenue ops
 *   commandCenter(companyId,q) -> deterministic answers to a small canned set
 *
 * Domain mapping (PROCUREMENT):
 *   - developers/buyers      = companies(kind='buyer')
 *   - vendors                = companies(kind='vendor')
 *   - projects               = buildings (owned by the buyer company)
 *   - bid packages           = packages (open|shortlisting|awarded|closed)
 *   - bids                   = bids (status/awarded/paid/docs_ok)
 *   - submittals             = submittals + submittal_history
 *   - deliveries             = deliveries + delivery_events
 *   - existing relationships = developer_vendor_relationships (admin_review_status)
 *   - referral revenue       = referral_partners + partner_commissions (cents)
 *
 * Authorization is the caller's responsibility (the routes assert company
 * membership before invoking any of these). Every computation is pure-ish: it
 * reads via q/q1 and, for businessHealth + cooTasks, writes its own summary
 * tables. There is no AI here and no AI is feature-flagged on.
 *
 * Integer cents for money. Zero em dashes by convention.
 */
import { q, q1 } from "../pool.js";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface Dimension {
  /** 0-100 normalized sub-score. */
  score: number;
  /** the raw counts/values that produced the score (for transparency in UI). */
  raw: Record<string, number>;
}

export interface BusinessHealth {
  score: number;
  dimensions: Record<string, Dimension>;
}

export interface CooTask {
  title: string;
  detail: string;
  category: string;
  impact: number; // 1..5
  urgency: number; // 1..5
  score: number; // impact * urgency
  link: string;
}

export interface CooTaskRow extends CooTask {
  id: string;
  company_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface DailyBriefing {
  date: string;
  headline: string;
  topPriorities: CooTaskRow[];
  revenueOpportunities: string[];
  risks: string[];
  healthScore: number;
}

export interface CommandCenterAnswer {
  answer: string;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Small deterministic helpers
// ---------------------------------------------------------------------------

function clamp(n: number, lo = 0, hi = 100): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

/** ratio -> 0-100, guarding divide-by-zero. neutral is the score when no data. */
function pct(numerator: number, denominator: number, neutral = 50): number {
  if (denominator <= 0) return neutral;
  return clamp((numerator / denominator) * 100);
}

function toInt(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/** The company's kind (buyer | vendor), or null when the company is unknown. */
async function companyKind(companyId: string): Promise<string | null> {
  const row = await q1<{ kind: string }>(`select kind from companies where id = $1`, [companyId]);
  return row?.kind ?? null;
}

// ===========================================================================
// BUSINESS HEALTH
// ===========================================================================

/**
 * Compute the company's 0-100 business health from seven procurement
 * dimensions, then persist a snapshot into business_health_scores and return
 * the score + breakdown. Buyer-side and vendor-side companies share the same
 * dimensions; the underlying queries are written to be meaningful for both
 * (e.g. a buyer's "pipeline" is its own open packages; a vendor's is the open
 * packages it could bid plus its live bids).
 */
export async function businessHealth(companyId: string): Promise<BusinessHealth> {
  const kind = await companyKind(companyId);
  const isVendor = kind === "vendor";

  // --- pipeline: how much live work is in flight ---------------------------
  // Buyer: open/shortlisting packages on its own buildings.
  // Vendor: live (non-draft, non-terminal) bids it has placed.
  let pipelineRaw: Record<string, number>;
  let pipelineScore: number;
  if (isVendor) {
    const r = await q1<{ active_bids: string; open_market: string }>(
      `select
         (select count(*) from bids b
            where b.vendor_company_id = $1
              and b.status in ('submitted','shortlisted','rebid','revision')) as active_bids,
         (select count(*) from packages p where p.status in ('open','shortlisting')) as open_market`,
      [companyId],
    );
    const activeBids = toInt(r?.active_bids);
    const openMarket = toInt(r?.open_market);
    pipelineRaw = { active_bids: activeBids, open_market: openMarket };
    // 5+ active bids is a healthy vendor pipeline.
    pipelineScore = clamp((activeBids / 5) * 100);
  } else {
    const r = await q1<{ open_packages: string; total_packages: string }>(
      `select
         (select count(*) from packages p join buildings b on b.id = p.building_id
            where b.company_id = $1 and p.status in ('open','shortlisting')) as open_packages,
         (select count(*) from packages p join buildings b on b.id = p.building_id
            where b.company_id = $1) as total_packages`,
      [companyId],
    );
    const openPackages = toInt(r?.open_packages);
    const totalPackages = toInt(r?.total_packages);
    pipelineRaw = { open_packages: openPackages, total_packages: totalPackages };
    // 3+ live packages is a healthy buyer pipeline.
    pipelineScore = clamp((openPackages / 3) * 100);
  }

  // --- conversion: awarded bids / total bids -------------------------------
  let conversionRaw: Record<string, number>;
  if (isVendor) {
    const r = await q1<{ awarded: string; total: string }>(
      `select
         count(*) filter (where awarded) as awarded,
         count(*) as total
       from bids where vendor_company_id = $1`,
      [companyId],
    );
    conversionRaw = { awarded_bids: toInt(r?.awarded), total_bids: toInt(r?.total) };
  } else {
    const r = await q1<{ awarded: string; total: string }>(
      `select
         count(*) filter (where bd.awarded) as awarded,
         count(*) as total
       from bids bd
       join packages p on p.id = bd.package_id
       join buildings b on b.id = p.building_id
       where b.company_id = $1`,
      [companyId],
    );
    conversionRaw = { awarded_bids: toInt(r?.awarded), total_bids: toInt(r?.total) };
  }
  const conversionScore = pct(conversionRaw.awarded_bids, conversionRaw.total_bids);

  // --- revenue: referral commission earned (cents), if any -----------------
  // A company can also be a referral partner; surface earned profit-share as a
  // revenue signal. Mapped to integer cents.
  const revRow = await q1<{ commission_cents: string; partners: string }>(
    `select
       coalesce(sum(pc.commission_cents),0) as commission_cents,
       count(distinct rp.id) as partners
     from referral_partners rp
     left join partner_commissions pc
       on pc.partner_id = rp.id and pc.excluded = false and pc.status <> 'disputed'
     where rp.company_id = $1`,
    [companyId],
  );
  const commissionCents = toInt(revRow?.commission_cents);
  const revenueRaw = { commission_cents: commissionCents, partner_count: toInt(revRow?.partners) };
  // No referral program is neutral (not a penalty). $1,000 earned (100000c) is full marks.
  const revenueScore = revenueRaw.partner_count === 0 ? 50 : clamp((commissionCents / 100000) * 100);

  // --- delivery: on-time vs late ------------------------------------------
  let deliveryRaw: Record<string, number>;
  {
    const filter = isVendor ? `d.vendor_company_id = $1` : `b.company_id = $1`;
    const r = await q1<{ on_time: string; late: string; total: string }>(
      `select
         count(*) filter (where d.status not in ('delayed')
           and (d.delivery_date is null or d.expected_delivery is null
                or d.delivery_date <= d.expected_delivery)) as on_time,
         count(*) filter (where d.status = 'delayed'
           or (d.delivery_date is not null and d.expected_delivery is not null
               and d.delivery_date > d.expected_delivery)) as late,
         count(*) as total
       from deliveries d
       join packages p on p.id = d.package_id
       join buildings b on b.id = p.building_id
       where ${filter}`,
      [companyId],
    );
    deliveryRaw = { on_time: toInt(r?.on_time), late: toInt(r?.late), total: toInt(r?.total) };
  }
  const deliveryScore = pct(deliveryRaw.on_time, deliveryRaw.total);

  // --- submittals: approved (and beyond) / total ---------------------------
  let submittalRaw: Record<string, number>;
  {
    const filter = isVendor ? `s.vendor_company_id = $1` : `b.company_id = $1`;
    const r = await q1<{ approved: string; total: string; overdue: string }>(
      `select
         count(*) filter (where s.current_status in ('approved','ordered','delivered','installed','closed')) as approved,
         count(*) as total,
         count(*) filter (where s.current_status in ('submitted','review','revision_required')
           and s.updated_at < now() - interval '7 days') as overdue
       from submittals s
       join packages p on p.id = s.package_id
       join buildings b on b.id = p.building_id
       where ${filter}`,
      [companyId],
    );
    submittalRaw = {
      approved: toInt(r?.approved),
      total: toInt(r?.total),
      overdue: toInt(r?.overdue),
    };
  }
  const submittalScore = pct(submittalRaw.approved, submittalRaw.total);

  // --- compliance: vendor credentials present + ok (vendors only) ----------
  // Buyers are scored on whether their awarded vendors carry credentials.
  let complianceRaw: Record<string, number>;
  let complianceScore: number;
  if (isVendor) {
    const r = await q1<{ ok: string; total: string }>(
      `select
         count(*) filter (where ok and status in ('approved','ai-verified')) as ok,
         count(*) as total
       from vendor_credentials where company_id = $1`,
      [companyId],
    );
    const ok = toInt(r?.ok);
    const total = toInt(r?.total);
    complianceRaw = { credentials_ok: ok, credentials_total: total };
    // A vendor with zero credentials on file is non-compliant (score 0), not neutral.
    complianceScore = total === 0 ? 0 : pct(ok, total);
  } else {
    const r = await q1<{ with_creds: string; awarded_vendors: string }>(
      `select
         count(distinct case when vc.id is not null then bd.vendor_company_id end) as with_creds,
         count(distinct bd.vendor_company_id) as awarded_vendors
       from bids bd
       join packages p on p.id = bd.package_id
       join buildings b on b.id = p.building_id
       left join vendor_credentials vc on vc.company_id = bd.vendor_company_id and vc.ok
       where b.company_id = $1 and bd.awarded`,
      [companyId],
    );
    complianceRaw = {
      vendors_with_credentials: toInt(r?.with_creds),
      awarded_vendors: toInt(r?.awarded_vendors),
    };
    complianceScore = pct(complianceRaw.vendors_with_credentials, complianceRaw.awarded_vendors);
  }

  // --- relationships: active developer/vendor relationships ----------------
  const relCol = isVendor ? "vendor_company_id" : "developer_company_id";
  const relRow = await q1<{ active: string; pending: string; total: string }>(
    `select
       count(*) filter (where relationship_status = 'grandfathered_2_percent'
                            or relationship_status = 'standard_fee') as active,
       count(*) filter (where admin_review_status = 'pending_review') as pending,
       count(*) as total
     from developer_vendor_relationships
     where ${relCol} = $1`,
    [companyId],
  );
  const relationshipRaw = {
    active: toInt(relRow?.active),
    pending_review: toInt(relRow?.pending),
    total: toInt(relRow?.total),
  };
  // Having confirmed/active relationships is a strength; none on file is neutral.
  const relationshipScore =
    relationshipRaw.total === 0 ? 50 : pct(relationshipRaw.active, relationshipRaw.total);

  const dimensions: Record<string, Dimension> = {
    pipeline: { score: clamp(pipelineScore), raw: pipelineRaw },
    conversion: { score: clamp(conversionScore), raw: conversionRaw },
    revenue: { score: clamp(revenueScore), raw: revenueRaw },
    delivery: { score: clamp(deliveryScore), raw: deliveryRaw },
    submittals: { score: clamp(submittalScore), raw: submittalRaw },
    compliance: { score: clamp(complianceScore), raw: complianceRaw },
    relationships: { score: clamp(relationshipScore), raw: relationshipRaw },
  };

  // Equal-weighted mean of the seven dimensions (deterministic).
  const keys = Object.keys(dimensions);
  const score = clamp(keys.reduce((s, k) => s + dimensions[k].score, 0) / keys.length);

  // Persist a snapshot (history). The latest row is the current score.
  await q(
    `insert into business_health_scores (company_id, score, dimensions)
     values ($1, $2, $3::jsonb)`,
    [companyId, score, JSON.stringify(dimensions)],
  );

  return { score, dimensions };
}

// ===========================================================================
// COO TASKS
// ===========================================================================

/**
 * Generate the ranked task feed from live procurement signals, then UPSERT it
 * into coo_tasks (deduped by company_id + title so reloads do not duplicate).
 * Returns the persisted rows ordered by score desc. Existing user dispositions
 * (in_progress / done / dismissed) are PRESERVED on regeneration.
 */
export async function cooTasks(companyId: string): Promise<CooTaskRow[]> {
  const kind = await companyKind(companyId);
  const isVendor = kind === "vendor";
  const generated: CooTask[] = [];

  // 1) Overdue submittals (stuck in a working status for 7+ days). ----------
  {
    const filter = isVendor ? `s.vendor_company_id = $1` : `b.company_id = $1`;
    const r = await q1<{ n: string }>(
      `select count(*) as n
       from submittals s
       join packages p on p.id = s.package_id
       join buildings b on b.id = p.building_id
       where ${filter}
         and s.current_status in ('submitted','review','revision_required')
         and s.updated_at < now() - interval '7 days'`,
      [companyId],
    );
    const n = toInt(r?.n);
    if (n > 0) {
      generated.push({
        title: "Resolve overdue submittals",
        detail: `${n} submittal${n === 1 ? "" : "s"} stuck in review or revision for over 7 days. Move them forward to avoid schedule slippage.`,
        category: "Submittals",
        impact: 4,
        urgency: n >= 3 ? 5 : 3,
        score: 0,
        link: "/app",
      });
    }
  }

  // 2) Late / delayed deliveries. -------------------------------------------
  {
    const filter = isVendor ? `d.vendor_company_id = $1` : `b.company_id = $1`;
    const r = await q1<{ n: string }>(
      `select count(*) as n
       from deliveries d
       join packages p on p.id = d.package_id
       join buildings b on b.id = p.building_id
       where ${filter}
         and (d.status = 'delayed'
              or (d.expected_delivery is not null and d.delivery_date is null
                  and d.expected_delivery < current_date
                  and d.status not in ('delivered','installed','complete')))`,
      [companyId],
    );
    const n = toInt(r?.n);
    if (n > 0) {
      generated.push({
        title: "Address late deliveries",
        detail: `${n} deliver${n === 1 ? "y is" : "ies are"} delayed or past the expected delivery date. Follow up with the responsible party.`,
        category: "Delivery",
        impact: 5,
        urgency: n >= 2 ? 5 : 4,
        score: 0,
        link: "/app",
      });
    }
  }

  // 3) Packages past their deadline with no award (buyer-only signal). -------
  if (!isVendor) {
    const r = await q1<{ n: string }>(
      `select count(*) as n
       from packages p
       join buildings b on b.id = p.building_id
       where b.company_id = $1
         and p.status in ('open','shortlisting')
         and p.deadline is not null and p.deadline < current_date
         and not exists (select 1 from bids bd where bd.package_id = p.id and bd.awarded)`,
      [companyId],
    );
    const n = toInt(r?.n);
    if (n > 0) {
      generated.push({
        title: "Award packages past deadline",
        detail: `${n} bid package${n === 1 ? "" : "s"} passed the deadline without an award. Review the bids and award or extend.`,
        category: "Procurement",
        impact: 4,
        urgency: 5,
        score: 0,
        link: "/projects",
      });
    }
  }

  // 4) Pending grandfathered-relationship reviews. --------------------------
  {
    const relCol = isVendor ? "vendor_company_id" : "developer_company_id";
    const r = await q1<{ n: string }>(
      `select count(*) as n from developer_vendor_relationships
        where ${relCol} = $1 and admin_review_status = 'pending_review'`,
      [companyId],
    );
    const n = toInt(r?.n);
    if (n > 0) {
      generated.push({
        title: "Confirm existing-relationship reviews",
        detail: `${n} developer-vendor relationship${n === 1 ? "" : "s"} awaiting admin confirmation of the grandfathered 2% fee. Provide any supporting detail to clear the review.`,
        category: "Relationships",
        impact: 3,
        urgency: 3,
        score: 0,
        link: "/relationships",
      });
    }
  }

  // 5) Missing documents on awarded bids. -----------------------------------
  {
    const r = await q1<{ n: string }>(
      isVendor
        ? `select count(*) as n from bids bd
            where bd.vendor_company_id = $1 and bd.awarded and bd.docs_ok = false`
        : `select count(*) as n from bids bd
            join packages p on p.id = bd.package_id
            join buildings b on b.id = p.building_id
            where b.company_id = $1 and bd.awarded and bd.docs_ok = false`,
      [companyId],
    );
    const n = toInt(r?.n);
    if (n > 0) {
      generated.push({
        title: "Complete documents on awarded bids",
        detail: `${n} awarded bid${n === 1 ? "" : "s"} ${n === 1 ? "is" : "are"} missing required documents. Upload them to keep the award compliant.`,
        category: "Compliance",
        impact: 3,
        urgency: 4,
        score: 0,
        link: "/bids",
      });
    }
  }

  // Finalize scores (impact * urgency).
  for (const t of generated) t.score = t.impact * t.urgency;

  // UPSERT each generated task, preserving any prior user disposition. Then
  // close out stale OPEN tasks the engine no longer generated (signal cleared).
  const titles = generated.map((t) => t.title);
  for (const t of generated) {
    await q(
      `insert into coo_tasks (company_id, title, detail, category, impact, urgency, score, status, link)
       values ($1,$2,$3,$4,$5,$6,$7,'open',$8)
       on conflict (company_id, title) do update set
         detail = excluded.detail,
         category = excluded.category,
         impact = excluded.impact,
         urgency = excluded.urgency,
         score = excluded.score,
         link = excluded.link,
         updated_at = now()`,
      [companyId, t.title, t.detail, t.category, t.impact, t.urgency, t.score, t.link],
    );
  }
  // Auto-dismiss open tasks whose signal is gone this run (keeps the feed honest).
  if (titles.length > 0) {
    await q(
      `update coo_tasks set status = 'dismissed', updated_at = now()
        where company_id = $1 and status = 'open' and not (title = any($2))`,
      [companyId, titles],
    );
  } else {
    await q(
      `update coo_tasks set status = 'dismissed', updated_at = now()
        where company_id = $1 and status = 'open'`,
      [companyId],
    );
  }

  return listCooTasks(companyId);
}

/** The company's task feed (most actionable first), excluding dismissed. */
export async function listCooTasks(companyId: string): Promise<CooTaskRow[]> {
  return q<CooTaskRow>(
    `select id, company_id, title, detail, category, impact, urgency, score, status, link,
            created_at, updated_at
       from coo_tasks
      where company_id = $1 and status <> 'dismissed'
      order by (status = 'done') asc, score desc, updated_at desc`,
    [companyId],
  );
}

/** Set one task's disposition. Scoped to the company so it is IDOR-safe. */
export async function setCooTaskStatus(
  companyId: string,
  taskId: string,
  status: string,
): Promise<CooTaskRow | null> {
  const allowed = ["open", "in_progress", "done", "dismissed"];
  if (!allowed.includes(status)) return null;
  return q1<CooTaskRow>(
    `update coo_tasks set status = $3, updated_at = now()
      where id = $1 and company_id = $2
      returning id, company_id, title, detail, category, impact, urgency, score, status, link,
                created_at, updated_at`,
    [taskId, companyId, status],
  );
}

// ===========================================================================
// DAILY BRIEFING
// ===========================================================================

/**
 * Assemble the company's daily executive briefing deterministically from the
 * health score + the freshly recomputed task feed. No randomness, no AI.
 */
export async function dailyBriefing(companyId: string): Promise<DailyBriefing> {
  const health = await businessHealth(companyId);
  const tasks = await cooTasks(companyId);
  const open = tasks.filter((t) => t.status === "open" || t.status === "in_progress");
  const topPriorities = open.slice(0, 5);

  const date = new Date().toISOString().slice(0, 10);

  // Headline reflects the urgent count + health band.
  const urgent = open.filter((t) => t.score >= 16).length;
  let band = "steady";
  if (health.score >= 75) band = "strong";
  else if (health.score < 45) band = "needs attention";

  const headline =
    open.length === 0
      ? `Business health is ${band} (${health.score}/100). No open priorities today, you are clear.`
      : `Business health is ${band} (${health.score}/100). ${open.length} open priorit${open.length === 1 ? "y" : "ies"}${urgent > 0 ? `, ${urgent} urgent` : ""}.`;

  // Revenue opportunities (deterministic, drawn from real gaps).
  const revenueOpportunities: string[] = [];
  const rev = health.dimensions.revenue.raw;
  if (toInt(rev.partner_count) === 0) {
    revenueOpportunities.push(
      "No referral partner program on record. Enrolling as a referral partner opens a profit-share revenue line.",
    );
  } else if (toInt(rev.commission_cents) > 0) {
    revenueOpportunities.push(
      `Referral commissions earned to date: $${(toInt(rev.commission_cents) / 100).toFixed(2)}.`,
    );
  }
  const conv = health.dimensions.conversion.raw;
  if (toInt(conv.total_bids) > 0 && health.dimensions.conversion.score < 40) {
    revenueOpportunities.push(
      "Bid conversion is low. Reviewing pricing or scope on recent bids could lift the award rate.",
    );
  }
  const pipe = health.dimensions.pipeline.raw;
  if (health.dimensions.pipeline.score < 40) {
    revenueOpportunities.push(
      "Pipeline is thin. Adding active packages or bids would strengthen near-term revenue.",
    );
  }

  // Risks: the highest-impact open tasks, phrased as risks.
  const risks = open
    .filter((t) => t.impact >= 4)
    .slice(0, 4)
    .map((t) => `${t.title}: ${t.detail}`);

  return {
    date,
    headline,
    topPriorities,
    revenueOpportunities,
    risks,
    healthScore: health.score,
  };
}

// ===========================================================================
// COMMAND CENTER (canned, deterministic Q&A)
// ===========================================================================

export const SUPPORTED_QUESTIONS: { key: string; label: string }[] = [
  { key: "what_needs_my_attention", label: "What needs my attention?" },
  { key: "how_is_my_pipeline", label: "How is my pipeline?" },
  { key: "where_am_i_losing_money", label: "Where am I losing money?" },
  { key: "what_is_overdue", label: "What is overdue?" },
  { key: "how_healthy_is_my_business", label: "How healthy is my business?" },
];

const QUESTION_KEYS = SUPPORTED_QUESTIONS.map((q2) => q2.key);

/** Normalize a free-text or keyed question to one supported key (or null). */
function normalizeQuestion(question: string): string | null {
  const raw = (question || "").trim().toLowerCase();
  if (QUESTION_KEYS.includes(raw)) return raw;
  if (/attention|priorit|focus|today/.test(raw)) return "what_needs_my_attention";
  if (/pipeline|packages|bids|deals|flow/.test(raw)) return "how_is_my_pipeline";
  if (/losing money|revenue|lost|leak|where.*money|margin/.test(raw)) return "where_am_i_losing_money";
  if (/overdue|late|past due|deadline|behind/.test(raw)) return "what_is_overdue";
  if (/health|how.*business|doing|score/.test(raw)) return "how_healthy_is_my_business";
  return null;
}

/**
 * Answer one canned executive question deterministically by composing the
 * existing engines. Always returns { answer, data }; an unrecognized question
 * yields a helpful fallback listing the supported questions.
 */
export async function commandCenter(
  companyId: string,
  question: string,
): Promise<CommandCenterAnswer> {
  const key = normalizeQuestion(question);
  if (!key) {
    return {
      answer:
        "I can answer: what needs my attention, how is my pipeline, where am I losing money, what is overdue, and how healthy is my business.",
      data: { supported: SUPPORTED_QUESTIONS },
    };
  }

  if (key === "what_needs_my_attention") {
    const tasks = await cooTasks(companyId);
    const open = tasks.filter((t) => t.status === "open" || t.status === "in_progress");
    const top = open.slice(0, 5);
    const answer =
      top.length === 0
        ? "Nothing needs your attention right now. No open priorities."
        : `${open.length} open priorit${open.length === 1 ? "y" : "ies"}. Top: ${top.map((t) => t.title).join("; ")}.`;
    return { answer, data: { tasks: top, openCount: open.length } };
  }

  if (key === "how_is_my_pipeline") {
    const health = await businessHealth(companyId);
    const p = health.dimensions.pipeline;
    const answer = `Pipeline health is ${p.score}/100. ${Object.entries(p.raw)
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
      .join(", ")}.`;
    return { answer, data: { pipeline: p } };
  }

  if (key === "where_am_i_losing_money") {
    const health = await businessHealth(companyId);
    const conv = health.dimensions.conversion;
    const del = health.dimensions.delivery;
    const reasons: string[] = [];
    if (conv.raw.total_bids > 0 && conv.score < 50) {
      reasons.push(`low bid conversion (${conv.raw.awarded_bids}/${conv.raw.total_bids} awarded)`);
    }
    if (del.raw.total > 0 && del.score < 70) {
      reasons.push(`late deliveries (${del.raw.late} of ${del.raw.total})`);
    }
    const answer =
      reasons.length === 0
        ? "No major leakage detected: conversion and delivery are within healthy ranges."
        : `Likely money leaks: ${reasons.join("; ")}.`;
    return { answer, data: { conversion: conv, delivery: del } };
  }

  if (key === "what_is_overdue") {
    const tasks = await cooTasks(companyId);
    const overdue = tasks.filter(
      (t) =>
        (t.category === "Submittals" || t.category === "Delivery" || t.category === "Procurement") &&
        (t.status === "open" || t.status === "in_progress"),
    );
    const answer =
      overdue.length === 0
        ? "Nothing is overdue. Submittals, deliveries, and awards are on schedule."
        : `Overdue items: ${overdue.map((t) => t.title).join("; ")}.`;
    return { answer, data: { overdue } };
  }

  // how_healthy_is_my_business
  const health = await businessHealth(companyId);
  const weakest = Object.entries(health.dimensions).sort((a, b) => a[1].score - b[1].score)[0];
  const answer = `Overall business health is ${health.score}/100. Weakest dimension: ${weakest[0]} (${weakest[1].score}/100).`;
  return { answer, data: { health } };
}

// ===========================================================================
// ADMIN PORTFOLIO ROLLUP
// ===========================================================================

export interface AdminCooOverview {
  totals: {
    companies: number;
    open_tasks: number;
    urgent_tasks: number;
    pending_relationship_reviews: number;
  };
  topTasks: (CooTaskRow & { company_name: string | null })[];
  lowestHealth: { company_id: string; company_name: string | null; score: number; computed_at: string }[];
}

/**
 * Portfolio rollup across ALL companies for the admin console. Uses the latest
 * persisted health row per company plus the live coo_tasks feed. Read-only.
 */
export async function adminCooOverview(): Promise<AdminCooOverview> {
  const totals = await q1<{
    companies: string;
    open_tasks: string;
    urgent_tasks: string;
    pending_relationship_reviews: string;
  }>(
    `select
       (select count(*) from companies) as companies,
       (select count(*) from coo_tasks where status in ('open','in_progress')) as open_tasks,
       (select count(*) from coo_tasks where status in ('open','in_progress') and score >= 16) as urgent_tasks,
       (select count(*) from developer_vendor_relationships where admin_review_status = 'pending_review')
         as pending_relationship_reviews`,
  );

  const topTasks = await q<CooTaskRow & { company_name: string | null }>(
    `select t.id, t.company_id, t.title, t.detail, t.category, t.impact, t.urgency, t.score,
            t.status, t.link, t.created_at, t.updated_at, c.name as company_name
       from coo_tasks t
       left join companies c on c.id = t.company_id
      where t.status in ('open','in_progress')
      order by t.score desc, t.updated_at desc
      limit 20`,
  );

  // Latest health snapshot per company, lowest first.
  const lowestHealth = await q<{
    company_id: string;
    company_name: string | null;
    score: number;
    computed_at: string;
  }>(
    `select distinct on (h.company_id)
            h.company_id, c.name as company_name, h.score, h.computed_at
       from business_health_scores h
       left join companies c on c.id = h.company_id
      order by h.company_id, h.computed_at desc`,
  );
  lowestHealth.sort((a, b) => a.score - b.score);

  return {
    totals: {
      companies: toInt(totals?.companies),
      open_tasks: toInt(totals?.open_tasks),
      urgent_tasks: toInt(totals?.urgent_tasks),
      pending_relationship_reviews: toInt(totals?.pending_relationship_reviews),
    },
    topTasks,
    lowestHealth: lowestHealth.slice(0, 15),
  };
}
