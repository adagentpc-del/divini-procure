/**
 * My Payouts - the signed-in company's payout instructions.
 *
 * Read-only list of what the company is owed / has been paid via the Stripe
 * Connect payout rail. Money is released by an admin/owner; this page just shows
 * the status and amounts.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { apiGet } from '../lib/api';

type Instruction = {
  id: string;
  recipient_kind: string;
  basis_cents: number | string | null;
  split_percentage: number | string | null;
  amount_cents: number | string | null;
  currency: string;
  status: string;
  stripe_transfer_id: string | null;
  failure_reason: string | null;
  released_at: string | null;
  created_at: string;
};

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

export default function MyPayouts() {
  const { company } = useAuth();
  const [rows, setRows] = useState<Instruction[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!company) return;
    apiGet<{ instructions: Instruction[] }>(`/payouts/mine?companyId=${company.id}`)
      .then((d) => setRows(d.instructions ?? []))
      .catch((e: any) => setErr(e.message ?? 'Could not load payouts.'));
  }, [company]);

  if (!company) return <div className="card">Sign in with a company to view payouts.</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My Payouts</h1>
          <div className="sub">
            Amounts owed and paid to you through the Stripe payout rail. Funds are sent to your
            connected bank account once an admin releases a payout.
          </div>
        </div>
      </div>

      {err && <div className="err">{err}</div>}

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Kind</th>
              <th>Basis</th>
              <th>Split %</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Released</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="note">{r.recipient_kind}</td>
                <td>{dollars(r.basis_cents)}</td>
                <td>{pct(r.split_percentage)}</td>
                <td><strong>{dollars(r.amount_cents)}</strong></td>
                <td>
                  <span className={'badge ' + (STATUS_BADGE[r.status] ?? 'b-neutral')}>{r.status}</span>
                  {r.failure_reason ? <div className="note">{r.failure_reason}</div> : null}
                </td>
                <td className="note">
                  {r.released_at ? new Date(r.released_at).toLocaleDateString() : '-'}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="note" style={{ padding: 14 }}>
                  No payouts yet. When a payment you share in is collected, your split appears here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
