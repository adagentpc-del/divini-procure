/**
 * Admin Platform Revenue Ledger.
 *
 * The accrual ledger of Divini's own platform revenue. Every procurement fee
 * (and any capital-introduction / subscription / manual entry) lands here at
 * status 'accrued' when a developer authorizes a payment. An admin marks a row
 * invoiced -> collected (or waives / voids it) by hand here.
 *
 * RECORDING ONLY. Marking a row collected is bookkeeping; it does NOT charge a
 * card or move money through any processor.
 */
import { useEffect, useState } from 'react';
import { useFeatures } from '../lib/features';
import { apiGet, apiSend } from '../lib/api';

type RevenueRow = {
  id: string;
  source_type: string;
  developer_company_id: string | null;
  vendor_company_id: string | null;
  developer_name: string | null;
  vendor_name: string | null;
  purchase_order_id: string | null;
  base_cents: number | string | null;
  fee_percentage: number | string | null;
  fee_cents: number | string | null;
  fee_source: string | null;
  payer_type: string | null;
  status: string;
  collected_at: string | null;
  notes: string | null;
  created_at: string;
};

type Totals = { accruedCents: number; collectedCents: number };

const STATUS_FILTERS = ['', 'accrued', 'invoiced', 'collected', 'waived', 'void'] as const;

const SOURCE_LABEL: Record<string, string> = {
  procurement_fee: 'Procurement fee',
  capital_introduction: 'Capital introduction',
  subscription: 'Subscription',
  manual: 'Manual',
};

const FEE_SOURCE_LABEL: Record<string, string> = {
  grandfathered_2_percent: 'Grandfathered 2%',
  fee_rule: 'Fee matrix',
  standard: 'Standard',
  manual: 'Manual',
};

const STATUS_BADGE: Record<string, string> = {
  accrued: 'b-amber',
  invoiced: 'b-neutral',
  collected: 'b-green',
  waived: 'b-neutral',
  void: 'b-neutral',
};

const dollars = (cents: number | string | null) => {
  if (cents == null || cents === '') return '-';
  const n = Number(cents);
  return Number.isFinite(n) ? `$${(n / 100).toFixed(2)}` : '-';
};

const pct = (p: number | string | null) => {
  if (p == null || p === '') return '-';
  const n = Number(p);
  return Number.isFinite(n) ? `${n}%` : '-';
};

export default function AdminRevenue() {
  const { isAdmin } = useFeatures();
  const [rows, setRows] = useState<RevenueRow[]>([]);
  const [totals, setTotals] = useState<Totals>({ accruedCents: 0, collectedCents: 0 });
  const [filter, setFilter] = useState<string>('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const qs = filter ? `?status=${encodeURIComponent(filter)}` : '';
      const d = await apiGet<{ rows: RevenueRow[]; totals: Totals }>(`/admin/revenue${qs}`);
      setRows(d.rows ?? []);
      setTotals(d.totals ?? { accruedCents: 0, collectedCents: 0 });
    } catch (e: any) {
      setErr(e.message ?? 'Could not load revenue ledger.');
    }
  }
  useEffect(() => {
    if (isAdmin) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, filter]);

  if (!isAdmin) return <div className="card">Admins only.</div>;

  async function setStatus(id: string, status: string) {
    setBusy(true);
    setErr('');
    try {
      await apiSend('PATCH', `/admin/revenue/${id}`, { status });
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Could not update revenue row.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Platform Revenue</h1>
          <div className="sub">
            The accrual ledger of Divini platform revenue. Fees are recorded automatically when a
            developer authorizes a payment. The correct rate (grandfathered 2%, fee matrix, or
            standard) is resolved at that moment.
          </div>
        </div>
      </div>

      <div className="note badge b-amber" style={{ marginBottom: 14, display: 'inline-block' }}>
        Recording only. Marking a row collected does not charge a card or move money. It records that
        Divini received payment out of band.
      </div>

      {err && <div className="err">{err}</div>}

      <div className="two" style={{ display: 'flex', gap: 14, marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="card" style={{ flex: 1, minWidth: 200 }}>
          <div className="note">Accrued (not yet collected)</div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>{dollars(totals.accruedCents)}</div>
          <div className="note">Includes invoiced rows awaiting collection.</div>
        </div>
        <div className="card" style={{ flex: 1, minWidth: 200 }}>
          <div className="note">Collected</div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>{dollars(totals.collectedCents)}</div>
          <div className="note">Marked received by an admin.</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <label className="note">Filter by status</label>{' '}
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          {STATUS_FILTERS.map((s) => (
            <option key={s || 'all'} value={s}>
              {s === '' ? 'All' : s}
            </option>
          ))}
        </select>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Developer</th>
              <th>Vendor</th>
              <th>Base</th>
              <th>Fee %</th>
              <th>Fee</th>
              <th>Fee source</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>{SOURCE_LABEL[r.source_type] ?? r.source_type}</strong>
                  {r.notes ? <div className="note">{r.notes}</div> : null}
                </td>
                <td className="note">
                  {r.developer_name ??
                    (r.developer_company_id ? r.developer_company_id.slice(0, 8) : '-')}
                </td>
                <td className="note">
                  {r.vendor_name ?? (r.vendor_company_id ? r.vendor_company_id.slice(0, 8) : '-')}
                </td>
                <td>{dollars(r.base_cents)}</td>
                <td>{pct(r.fee_percentage)}</td>
                <td>
                  <strong>{dollars(r.fee_cents)}</strong>
                </td>
                <td>
                  <span className="badge b-neutral">
                    {FEE_SOURCE_LABEL[r.fee_source ?? ''] ?? r.fee_source ?? '-'}
                  </span>
                </td>
                <td>
                  <span className={'badge ' + (STATUS_BADGE[r.status] ?? 'b-neutral')}>
                    {r.status}
                  </span>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {r.status !== 'invoiced' && r.status !== 'collected' && (
                      <button className="btn" disabled={busy} onClick={() => setStatus(r.id, 'invoiced')}>
                        Mark invoiced
                      </button>
                    )}
                    {r.status !== 'collected' && (
                      <button
                        className="btn primary"
                        disabled={busy}
                        onClick={() => setStatus(r.id, 'collected')}
                      >
                        Mark collected
                      </button>
                    )}
                    {r.status !== 'waived' && r.status !== 'void' && (
                      <button className="btn" disabled={busy} onClick={() => setStatus(r.id, 'waived')}>
                        Waive
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={9} className="note" style={{ padding: 14 }}>
                  No revenue recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
