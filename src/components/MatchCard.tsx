/**
 * Match card renderers for the Investor Matching system.
 *
 * InvestorMatchCard   -> shown to DEVELOPERS reviewing investors matched to one
 *                        of their programs. Surfaces investor profile, fit score,
 *                        eligibility + compliance status, and intro decision
 *                        actions (approve / request info / require NDA / decline).
 * OpportunityMatchCard -> shown to INVESTORS browsing matched programs. Surfaces
 *                        the opportunity, requirements, returns, and access
 *                        actions. CTAs never say "invest now": "Request access",
 *                        "Sign NDA", "Request introduction", "Save",
 *                        "Not interested".
 *
 * Money is INTEGER CENTS over the API; rendered here as dollars.
 */

// ---- helpers ---------------------------------------------------------------

function dollars(cents?: number | null): string {
  if (cents == null || Number.isNaN(Number(cents))) return '-';
  const n = Number(cents) / 100;
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function range(min?: number | null, max?: number | null): string {
  if (min == null && max == null) return 'Flexible';
  if (min != null && max != null) return `${dollars(min)} - ${dollars(max)}`;
  if (min != null) return `${dollars(min)}+`;
  return `Up to ${dollars(max)}`;
}

function scoreClass(score?: number | null): string {
  const s = Number(score ?? 0);
  if (s >= 80) return 'b-green';
  if (s >= 60) return 'b-amber';
  return 'b-neutral';
}

function ScoreBadge({ score, label }: { score?: number | null; label?: string }) {
  return (
    <span className={`badge ${scoreClass(score)}`}>
      {label ? `${label} ` : ''}
      {score != null ? `${Math.round(Number(score))}% match` : 'Unscored'}
    </span>
  );
}

function StatusChip({ ok, yes, no }: { ok?: boolean; yes: string; no: string }) {
  return <span className={`badge ${ok ? 'b-green' : 'b-neutral'}`}>{ok ? yes : no}</span>;
}

function pretty(v?: string | null): string {
  if (!v) return '-';
  return String(v).replace(/_/g, ' ');
}

function list(arr?: string[] | null): string {
  if (!arr || arr.length === 0) return '-';
  return arr.map((x) => x.replace(/_/g, ' ')).join(', ');
}

/**
 * Explainable-match line. Prefers backend-supplied `reasons`; otherwise builds a
 * concise "matched on" summary from the salient fields so the card is never an
 * opaque score. Explainable matches convert; bare lists get ignored.
 */
function WhyLine({ reasons, fallback }: { reasons?: string[] | null; fallback: (string | null | undefined)[] }) {
  const parts = (reasons && reasons.length > 0
    ? reasons
    : fallback.filter((x): x is string => !!x && x !== '-')
  ).map((x) => String(x).replace(/_/g, ' '));
  if (parts.length === 0) return null;
  return (
    <div className="note" style={{ marginTop: 8 }}>
      <strong>Why this match:</strong> {parts.join(' · ')}
    </div>
  );
}

// ---- shared types (loose; backend may add fields) --------------------------

export type Investor = {
  id?: string;
  full_name?: string;
  entity_name?: string;
  investor_type?: string;
  accreditation_status?: string;
  location?: string;
  min_investment_cents?: number;
  max_investment_cents?: number;
  asset_classes?: string[];
  markets?: string[];
};

export type InvestorMatch = {
  investor: Investor;
  score?: number;
  label?: string;
  eligibility?: string;
  ndaStatus?: string;
  kycStatus?: string;
  accreditation?: string;
  proofOfFundsStatus?: string;
  recommendedNextStep?: string;
  introductionRequestId?: string;
  reasons?: string[];
};

export type Program = {
  id?: string;
  name?: string;
  developer_name?: string;
  asset_class?: string;
  location?: string;
  min_investment_cents?: number;
  max_investment_cents?: number;
  investor_type_accepted?: string;
  accredited_only?: boolean;
  non_accredited_accepted?: boolean;
  projected_return?: string;
  hold_period?: string;
  risk_level?: string;
  nda_required?: boolean;
};

export type OpportunityMatch = {
  program: Program;
  score?: number;
  label?: string;
  eligibility?: string;
  canView?: boolean;
  accessStatus?: string;
  ndaSigned?: boolean;
  reasons?: string[];
  trustScore?: number;
  trustBand?: 'new' | 'building' | 'established' | 'trusted';
};

function TrustBadge({ score, band }: { score?: number; band?: string }) {
  if (score == null) return null;
  const cls = band === 'trusted' ? 'b-green' : band === 'established' ? 'b-amber' : 'b-neutral';
  const label = band ? band.charAt(0).toUpperCase() + band.slice(1) : 'Trust';
  return <span className={`badge ${cls}`} title="Divini Trust Score — a reputational score for the sponsor, not a rating of any investment.">Trust: {label} ({Math.round(score)})</span>;
}

// ---- InvestorMatchCard (developer-facing) ----------------------------------

export function InvestorMatchCard({
  match,
  onApprove,
  onRequestInfo,
  onRequireNda,
  onDecline,
  busy,
}: {
  match: InvestorMatch;
  onApprove?: (m: InvestorMatch) => void;
  onRequestInfo?: (m: InvestorMatch) => void;
  onRequireNda?: (m: InvestorMatch) => void;
  onDecline?: (m: InvestorMatch) => void;
  busy?: boolean;
}) {
  const inv = match.investor ?? {};
  const hasActions = match.introductionRequestId != null;
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>
            {inv.entity_name || inv.full_name || 'Investor'}
          </div>
          <div className="note">{inv.location || ''}</div>
        </div>
        <ScoreBadge score={match.score} label={match.label} />
      </div>

      <WhyLine reasons={match.reasons} fallback={[list(inv.asset_classes), list(inv.markets), range(inv.min_investment_cents, inv.max_investment_cents)]} />

      <div className="two" style={{ marginTop: 12 }}>
        <div><span className="note">Investor type</span><div>{pretty(inv.investor_type)}</div></div>
        <div><span className="note">Accreditation</span><div>{pretty(match.accreditation || inv.accreditation_status)}</div></div>
        <div><span className="note">Investment range</span><div>{range(inv.min_investment_cents, inv.max_investment_cents)}</div></div>
        <div><span className="note">Eligibility</span><div>{pretty(match.eligibility)}</div></div>
        <div><span className="note">Asset classes</span><div>{list(inv.asset_classes)}</div></div>
        <div><span className="note">Markets</span><div>{list(inv.markets)}</div></div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <StatusChip ok={/sign|complete|yes|approved/i.test(match.ndaStatus || '')} yes="NDA signed" no={`NDA: ${pretty(match.ndaStatus) || 'not signed'}`} />
        <StatusChip ok={/complete|yes|passed|approved/i.test(match.kycStatus || '')} yes="KYC complete" no={`KYC: ${pretty(match.kycStatus) || 'pending'}`} />
        <StatusChip ok={/yes|verified|provided|complete/i.test(match.proofOfFundsStatus || '')} yes="Proof of funds" no={`Proof of funds: ${pretty(match.proofOfFundsStatus) || 'pending'}`} />
      </div>

      {match.recommendedNextStep && (
        <div className="note" style={{ marginTop: 10 }}>
          <strong>Recommended next step:</strong> {match.recommendedNextStep}
        </div>
      )}

      {hasActions && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
          <button className="btn primary" disabled={busy} onClick={() => onApprove?.(match)}>Approve introduction</button>
          <button className="btn" disabled={busy} onClick={() => onRequestInfo?.(match)}>Request more info</button>
          <button className="btn" disabled={busy} onClick={() => onRequireNda?.(match)}>Require NDA</button>
          <button className="btn" disabled={busy} onClick={() => onDecline?.(match)}>Decline</button>
        </div>
      )}
    </div>
  );
}

// ---- OpportunityMatchCard (investor-facing) --------------------------------

export function OpportunityMatchCard({
  match,
  onRequestAccess,
  onSignNda,
  onRequestIntroduction,
  onSave,
  onNotInterested,
  busy,
}: {
  match: OpportunityMatch;
  onRequestAccess?: (m: OpportunityMatch) => void;
  onSignNda?: (m: OpportunityMatch) => void;
  onRequestIntroduction?: (m: OpportunityMatch) => void;
  onSave?: (m: OpportunityMatch) => void;
  onNotInterested?: (m: OpportunityMatch) => void;
  busy?: boolean;
}) {
  const p = match.program ?? {};
  const accreditationReq = p.accredited_only
    ? 'Accredited investors only'
    : p.non_accredited_accepted
      ? 'Open to non-accredited'
      : 'See offering';
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{p.name || 'Opportunity'}</div>
          <div className="note">{p.developer_name || 'Sponsor'}{p.location ? ` · ${p.location}` : ''}</div>
        </div>
        <ScoreBadge score={match.score} label={match.label} />
      </div>

      <WhyLine reasons={match.reasons} fallback={[pretty(p.asset_class), p.location, range(p.min_investment_cents, p.max_investment_cents), p.projected_return ? `targets ${p.projected_return}` : null]} />

      <div className="two" style={{ marginTop: 12 }}>
        <div><span className="note">Asset class</span><div>{pretty(p.asset_class)}</div></div>
        <div><span className="note">Market</span><div>{p.location || '-'}</div></div>
        <div><span className="note">Investment range</span><div>{range(p.min_investment_cents, p.max_investment_cents)}</div></div>
        <div><span className="note">Investor type required</span><div>{pretty(p.investor_type_accepted)}</div></div>
        <div><span className="note">Accreditation</span><div>{accreditationReq}</div></div>
        <div><span className="note">Target return</span><div>{p.projected_return || '-'}</div></div>
        <div><span className="note">Hold period</span><div>{p.hold_period || '-'}</div></div>
        <div><span className="note">Risk</span><div>{pretty(p.risk_level)}</div></div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <TrustBadge score={match.trustScore} band={match.trustBand} />
        {p.nda_required && <span className="badge b-amber">NDA required</span>}
        <span className={`badge ${match.canView ? 'b-green' : 'b-neutral'}`}>
          {match.accessStatus ? pretty(match.accessStatus) : match.canView ? 'Access granted' : 'Access required'}
        </span>
        {match.eligibility && <span className="badge b-neutral">{pretty(match.eligibility)}</span>}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
        {!match.canView && (
          <button className="btn primary" disabled={busy} onClick={() => onRequestAccess?.(match)}>Request access</button>
        )}
        {p.nda_required && !match.ndaSigned && (
          <button className="btn" disabled={busy} onClick={() => onSignNda?.(match)}>Sign NDA</button>
        )}
        <button className="btn" disabled={busy} onClick={() => onRequestIntroduction?.(match)}>Request introduction</button>
        {onSave && <button className="btn" disabled={busy} onClick={() => onSave(match)}>Save</button>}
        {onNotInterested && <button className="btn" disabled={busy} onClick={() => onNotInterested(match)}>Not interested</button>}
      </div>
    </div>
  );
}
