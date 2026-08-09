/**
 * Phase 1 P1-15: canonical financial summary display for a project or a
 * package. Reads the server's single financial read model
 * (server/src/lib/financial-summary.ts, via GET .../financial-summary) -
 * this component never computes a total itself, only formats what the
 * backend already derived. Progressive disclosure: a compact metric strip
 * up front, a "Show detail" toggle for the full breakdown - not an
 * accounting spreadsheet dumped on the user.
 */
import { useState } from 'react';

function money(cents: number | null | undefined): string {
  if (cents == null) return '—';
  const dollars = cents / 100;
  const sign = dollars < 0 ? '-' : '';
  return `${sign}$${Math.abs(dollars).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function varianceColor(cents: number | null | undefined): string {
  if (cents == null) return 'var(--muted)';
  if (cents > 0) return '#b91c1c';
  if (cents < 0) return '#15803d';
  return 'var(--muted)';
}

const HEALTH_LABEL: Record<string, string> = {
  healthy: 'Healthy',
  at_risk: 'At Risk',
  over_budget: 'Over Budget',
  unbudgeted: 'Unbudgeted',
  no_award_yet: 'No Award Yet',
  within_budget: 'Within Allowance',
};
const HEALTH_BADGE: Record<string, string> = {
  healthy: 'b-green',
  within_budget: 'b-green',
  at_risk: 'b-amber',
  over_budget: 'b-red',
  unbudgeted: 'b-neutral',
  no_award_yet: 'b-neutral',
};

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="metric">
      <div className="k">{label}</div>
      <div className="v" style={tone ? { color: tone } : undefined}>{value}</div>
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <tr>
      <td>{label}{hint ? <span className="note" style={{ marginLeft: 6 }}>{hint}</span> : null}</td>
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{value}</td>
    </tr>
  );
}

export function ProjectFinancialSummaryPanel({ summary }: { summary: any }) {
  const [showDetail, setShowDetail] = useState(false);
  if (!summary) return null;
  const health = summary.budgetHealth as string;

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div className="sectitle" style={{ margin: 0 }}>Project financials</div>
        <span className={`badge ${HEALTH_BADGE[health] ?? 'b-neutral'}`}>{HEALTH_LABEL[health] ?? health}</span>
      </div>
      <div className="cards3 kpi" style={{ marginBottom: showDetail ? 14 : 0 }}>
        <Metric label="Current Budget" value={money(summary.budgetCurrentCents)} />
        <Metric label="Forecast at Completion" value={money(summary.forecastAtCompletionCents)} />
        <Metric label="Variance" value={money(summary.varianceCents)} tone={varianceColor(summary.varianceCents)} />
      </div>
      <button className="btn" style={{ marginTop: 10 }} onClick={() => setShowDetail((s) => !s)}>
        {showDetail ? 'Hide detail' : 'Show detail'}
      </button>
      {showDetail && (
        <table style={{ marginTop: 10 }}>
          <tbody>
            <Row label="Original budget" value={money(summary.budgetOriginalCents)} />
            <Row label="Current budget" value={money(summary.budgetCurrentCents)} />
            <Row label="Contingency" value={money(summary.contingencyCents)} />
            <Row label="Allocated to packages" value={money(summary.allocatedCents)} />
            <Row label="Unallocated" value={money(summary.unallocatedCents)} hint={summary.allocationState === 'over_allocated' ? '(over-allocated)' : undefined} />
            <Row label="Committed" value={money(summary.committedCents)} />
            <Row label="Contracted" value={money(summary.contractedCents)} />
            <Row label="Approved changes" value={money(summary.approvedChangeOrdersCents)} />
            <Row label="Revised commitment" value={money(summary.revisedCommitmentCents)} />
            <Row label="Invoiced" value={money(summary.invoicedGrossCents)} />
            <Row label="Approved for payment" value={money(summary.approvedForPaymentCents)} />
            <Row label="Paid" value={money(summary.paidCents)} />
            <Row label="Retainage held" value={money(summary.retainageHeldCents)} />
            <Row label="Remaining commitment" value={money(summary.remainingCommitmentCents)} />
            <Row label={`Packages over allowance (of ${summary.packageCount})`} value={String(summary.packagesOverAllowance)} />
          </tbody>
        </table>
      )}
    </div>
  );
}

export function PackageFinancialSummaryPanel({ summary }: { summary: any }) {
  const [showDetail, setShowDetail] = useState(false);
  if (!summary) return null;
  const status = summary.status as string;

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div className="sectitle" style={{ margin: 0 }}>Package financials</div>
        <span className={`badge ${HEALTH_BADGE[status] ?? 'b-neutral'}`}>{HEALTH_LABEL[status] ?? status}</span>
      </div>
      <div className="cards3 kpi" style={{ marginBottom: showDetail ? 14 : 0 }}>
        <Metric label="Allowance" value={money(summary.allowanceCurrentCents)} />
        <Metric label="Revised Commitment" value={money(summary.revisedCommitmentCents)} />
        <Metric label="Variance" value={money(summary.varianceCents)} tone={varianceColor(summary.varianceCents)} />
      </div>
      {summary.contractDiscrepancyCents ? (
        <div className="note" style={{ marginTop: 8, color: varianceColor(summary.contractDiscrepancyCents) }}>
          Contract amount differs from the award by {money(summary.contractDiscrepancyCents)}.
        </div>
      ) : null}
      <button className="btn" style={{ marginTop: 10 }} onClick={() => setShowDetail((s) => !s)}>
        {showDetail ? 'Hide detail' : 'Show detail'}
      </button>
      {showDetail && (
        <table style={{ marginTop: 10 }}>
          <tbody>
            <Row label="Original allowance" value={money(summary.allowanceOriginalCents)} />
            <Row label="Current allowance" value={money(summary.allowanceCurrentCents)} />
            <Row label="Estimate range" value={summary.estimateMinCents != null || summary.estimateMaxCents != null ? `${money(summary.estimateMinCents)} – ${money(summary.estimateMaxCents)}` : '—'} />
            {summary.bidStatistics?.validBidCount > 0 && (
              <Row label={`Bids (${summary.bidStatistics.validBidCount})`} value={`Low ${money(summary.bidStatistics.lowCents)} · Median ${money(summary.bidStatistics.medianCents)} · High ${money(summary.bidStatistics.highCents)}`} />
            )}
            <Row label="Awarded amount" value={money(summary.awardedAmountCents)} />
            <Row label="Contract amount" value={money(summary.contractAmountCents)} />
            <Row label="Original commitment" value={money(summary.originalCommitmentCents)} />
            <Row label="Approved changes" value={money(summary.approvedChangeOrdersCents)} />
            <Row label="Revised commitment" value={money(summary.revisedCommitmentCents)} />
            <Row label="Invoiced" value={money(summary.invoicedGrossCents)} />
            <Row label="Approved for payment" value={money(summary.approvedForPaymentCents)} />
            <Row label="Paid" value={money(summary.paidCents)} />
            <Row label="Retainage held" value={money(summary.retainageHeldCents)} />
            <Row label="Retainage released" value={money(summary.retainageReleasedCents)} />
            <Row label="Remaining commitment" value={money(summary.remainingCommitmentCents)} />
            <Row label={summary.isFinanciallyClosed ? 'Final cost (closed)' : 'Forecast final'} value={money(summary.isFinanciallyClosed ? summary.finalCostCents : summary.forecastFinalCents)} />
          </tbody>
        </table>
      )}
    </div>
  );
}
