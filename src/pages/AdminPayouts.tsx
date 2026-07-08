/**
 * Admin Payouts - the 1-CLICK RELEASE queue for the Stripe Connect payout rail.
 *
 * Each row is a queued split (recipient, basis, split %, amount, status). A
 * Release button per ready row instructs Stripe to transfer the funds to the
 * recipient's connected bank. Admin can also hold or cancel a row.
 *
 * SAFETY: Release sends real funds via Stripe to the recipient bank. Nothing
 * auto-disburses; every transfer is a deliberate one-click action. When Stripe
 * is not configured or the recipient is not payouts-enabled, Release marks the
 * row 'blocked' with a clear reason instead of moving money.
 */
import { useEffect, useState } from 'react';
import { useFeatures } from '../lib/features';
import { apiGet, apiSend } from '../lib/api';

type Row = {
  id: string;
  recipient_kind: string;
  recipient_company_id: string | null;
  recipient_referral_partner_id: string | null;
  recipient_company_name: string | null;
  recipient_partner_name: string | null;
  account_payouts_enabled: boolean | null;
  account_bank_last4: string | null;
  account_stripe_id: string | null;
  basis_cents: number | string | null;
  split_percentage: number | string | null;
  amount_cents: number | string | null;
  currency: string;
  status: string;
  stripe_transfer_id: string | null;
  failure_reason: string | null;
  notes: string | null;
  created_at: string;
};

type Totals = { pendingCents: number; readyCents: number; paidCents: number };

const STATUS_BADGE: Record<string, string> = {
  pending: 'b-neutral',
  ready: 'b-amber',
  releasing: 'b-amber',
  paid: 'b-green',
  failed: 'b-red',
  blocked: 'b-red',
  held: 'b-neutral',
  canceled: 'b-neutral',
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

function recipientName(r: Row): string {
  if (r.recipient_partner_name) return r.recipient_partner_name;
  if (r.recipient_company_name) return r.recipient_company_name;
  if (r.recipient_referral_partner_id) return r.recipient_referral_partner_id.slice(0, 8);
  if (r.recipient_company_id) return r.recipient_company_id.slice(0, 8);
  return '-';
}

export default function AdminPayouts() {
  const { isAdmin } = useFeatures();
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Totals>({ pendingCents: 0, readyCents: 0, paidCents: 0 });
  const [configured, setConfigured] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');

  async function load() {
    try {
      const d = await apiGet<{ rows: Row[]; totals: Totals; configured: boolean }>(
        '/admin/payouts/queue',
      );
      setRows(d.rows ?? []);
      setTotals(d.totals ?? { pendingCents: 0, readyCents: 0, paidCents: 0 });
      setConfigured(d.configured);
    } catch (e: any) {
      setErr(e.message ?? 'Could not load payout queue.');
    }
  }

  useEffect(() => {
    if (isAdmin) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  if (!isAdmin) return <div className="card">Admins only.</div>;

  async function release(id: string) {
    setBusy(id);
    setErr('');
    setMsg('');
    try {
      const d = await apiSend<{ released: boolean; status: string; reason?: string }>(
        'POST',
        `/admin/payouts/${id}/release`,
        {},
      );
      if (d.released) setMsg('Payout released via Stripe.');
      else setMsg(d.reason ?? `Not released (${d.status}).`);
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Release failed.');
      await load();
    } finally {
      setBusy('');
    }
  }

  async function control(id: string, status: 'held' | 'canceled') {
    setBusy(id);
    setErr('');
    try {
      await apiSend('PATCH', `/admin/payouts/${id}`, { status });
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Update failed.');
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Payouts</h1>
          <div className="sub">
            Release queue for the Stripe Connect payout rail. Each split is computed when a payment is
            collected; release sends the funds to the recipient's connected bank.
          </div>
        </div>
      </div>

      <div className="note badge b-red" style={{ marginBottom: 14, display: 'inline-block' }}>
        Release sends real funds via Stripe to the recipient bank. Nothing auto-disburses; each
        transfer is a deliberate one-click action.
      </div>

      {!configured && (
        <div className="note badge b-amber" style={{ marginBottom: 14, display: 'block' }}>
          Stripe is not configured (STRIPE_SECRET_KEY unset). Releasing will mark rows blocked, not
          move money, until Stripe is connected.
        </div>
      )}

      {err && <div className="err">{err}</div>}
      {msg && <div className="note" style={{ marginBottom: 12 }}>{msg}</div>}

      <div className="two" style={{ display: 'flex', gap: 14, marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="card" style={{ flex: 1, minWidth: 180 }}>
          <div className="note">Pending</div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>{dollars(totals.pendingCents)}</div>
        </div>
        <div className="card" style={{ flex: 1, minWidth: 180 }}>
          <div className="note">Ready to release</div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>{dollars(totals.readyCents)}</div>
        </div>
        <div className="card" style={{ flex: 1, minWidth: 180 }}>
          <div className="note">Paid</div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>{dollars(totals.paidCents)}</div>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Recipient</th>
              <th>Kind</th>
              <th>Bank</th>
              <th>Basis</th>
              <th>Split %</th>
              <th>Amount</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><strong>{recipientName(r)}</strong></td>
                <td className="note">{r.recipient_kind}</td>
                <td className="note">
                  {r.account_bank_last4 ? `•••• ${r.account_bank_last4}` : 'not connected'}
                </td>
                <td>{dollars(r.basis_cents)}</td>
                <td>{pct(r.split_percentage)}</td>
                <td><strong>{dollars(r.amount_cents)}</strong></td>
                <td>
                  <span className={'badge ' + (STATUS_BADGE[r.status] ?? 'b-neutral')}>{r.status}</span>
                  {r.failure_reason ? <div className="note">{r.failure_reason}</div> : null}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {['ready', 'pending', 'blocked', 'failed'].includes(r.status) && (
                      <button
                        className="btn primary"
                        disabled={!!busy}
                        onClick={() => release(r.id)}
                        title={
                          r.account_payouts_enabled
                            ? 'Send funds via Stripe'
                            : 'Recipient not payouts-enabled yet; will mark blocked'
                        }
                      >
                        Release
                      </button>
                    )}
                    {r.status !== 'held' && r.status !== 'paid' && (
                      <button className="btn" disabled={!!busy} onClick={() => control(r.id, 'held')}>
                        Hold
                      </button>
                    )}
                    {r.status !== 'canceled' && r.status !== 'paid' && (
                      <button className="btn" disabled={!!busy} onClick={() => control(r.id, 'canceled')}>
                        Cancel
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={8} className="note" style={{ padding: 14 }}>
                  No payouts queued. Splits appear here when a collected revenue row has an agreed
                  recipient share.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
