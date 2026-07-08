/**
 * Admin Split Terms.
 *
 * The AGREED per-party disbursement shares. Each term names a recipient
 * (referral partner / client / vendor / profile / other) and a scope
 * (developer / vendor / program), computed on the platform fee or the gross
 * payment. When a revenue row is collected, every matching active term feeds
 * the 1-click payout queue as a payout instruction. Admins can create a term,
 * edit its percentage / flat / notes inline, toggle active, or soft delete it.
 */
import { useEffect, useState } from 'react';
import { useFeatures } from '../lib/features';
import { apiGet, apiSend } from '../lib/api';

type SplitTerm = {
  id: string;
  recipient_kind: string | null;
  recipient_company_id: string | null;
  recipient_user_id: string | null;
  recipient_referral_partner_id: string | null;
  developer_company_id: string | null;
  vendor_company_id: string | null;
  program_id: string | null;
  basis: string | null;
  percentage: number | string | null;
  flat_cents: number | string | null;
  active: boolean;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

const RECIPIENT_KINDS = ['referral_partner', 'client', 'vendor', 'profile', 'other'] as const;
const BASES = ['fee', 'payment'] as const;

const KIND_LABEL: Record<string, string> = {
  referral_partner: 'Referral partner',
  client: 'Client',
  vendor: 'Vendor',
  profile: 'Profile',
  other: 'Other',
};

const BASIS_LABEL: Record<string, string> = {
  fee: 'Platform fee',
  payment: 'Payment',
};

const dollars = (cents: number | string | null) => {
  if (cents == null || cents === '') return null;
  const n = Number(cents);
  return Number.isFinite(n) ? `$${(n / 100).toFixed(2)}` : null;
};

const pct = (p: number | string | null) => {
  if (p == null || p === '') return null;
  const n = Number(p);
  return Number.isFinite(n) ? `${n}%` : null;
};

export default function AdminSplitTerms() {
  const { isAdmin } = useFeatures();
  const [rows, setRows] = useState<SplitTerm[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // create form
  const [recipientKind, setRecipientKind] = useState<string>('vendor');
  const [recipientCompanyId, setRecipientCompanyId] = useState('');
  const [recipientUserId, setRecipientUserId] = useState('');
  const [recipientReferralPartnerId, setRecipientReferralPartnerId] = useState('');
  const [devId, setDevId] = useState('');
  const [venId, setVenId] = useState('');
  const [programId, setProgramId] = useState('');
  const [basis, setBasis] = useState<string>('fee');
  const [percentage, setPercentage] = useState('');
  const [flatCents, setFlatCents] = useState('');
  const [notes, setNotes] = useState('');

  async function load() {
    try {
      const d = await apiGet<{ terms: SplitTerm[] }>('/admin/split-terms');
      setRows(d.terms ?? []);
    } catch (e: any) { setErr(e.message ?? 'Could not load split terms.'); }
  }
  useEffect(() => { if (isAdmin) load(); }, [isAdmin]);

  if (!isAdmin) return <div className="card">Admins only.</div>;

  async function create() {
    setBusy(true); setErr('');
    try {
      await apiSend('POST', '/admin/split-terms', {
        recipient_kind: recipientKind,
        recipient_company_id: recipientCompanyId || undefined,
        recipient_user_id: recipientUserId || undefined,
        recipient_referral_partner_id: recipientReferralPartnerId || undefined,
        developer_company_id: devId || undefined,
        vendor_company_id: venId || undefined,
        program_id: programId || undefined,
        basis,
        percentage: percentage === '' ? undefined : Number(percentage),
        flat_cents: flatCents === '' ? undefined : Number(flatCents),
        notes: notes || undefined,
      });
      setRecipientCompanyId(''); setRecipientUserId(''); setRecipientReferralPartnerId('');
      setDevId(''); setVenId(''); setProgramId('');
      setPercentage(''); setFlatCents(''); setNotes('');
      await load();
    } catch (e: any) { setErr(e.message ?? 'Could not create split term.'); }
    finally { setBusy(false); }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(true); setErr('');
    try { await apiSend('PATCH', `/admin/split-terms/${id}`, body); await load(); }
    catch (e: any) { setErr(e.message ?? 'Could not update split term.'); }
    finally { setBusy(false); }
  }

  async function softDelete(id: string) {
    setBusy(true); setErr('');
    try { await apiSend('DELETE', `/admin/split-terms/${id}`); await load(); }
    catch (e: any) { setErr(e.message ?? 'Could not delete split term.'); }
    finally { setBusy(false); }
  }

  function recipientCell(r: SplitTerm) {
    const id = r.recipient_referral_partner_id || r.recipient_company_id || r.recipient_user_id;
    return (
      <>
        <strong>{KIND_LABEL[r.recipient_kind ?? 'other'] ?? r.recipient_kind}</strong>
        <div className="note">{id ? id.slice(0, 8) : '-'}</div>
      </>
    );
  }

  return (
    <>
      <div className="page-head"><div>
        <h1>Split Terms</h1>
        <div className="sub">Agreed per-party disbursement shares. Each active term whose scope matches a collected revenue row feeds the 1-click payout queue as a payout instruction.</div>
      </div></div>

      <div className="note badge b-amber" style={{ marginBottom: 14, display: 'inline-block' }}>
        These terms feed the payout queue when revenue is collected. A term produces a split only when active, with a real recipient and a positive amount. A recipient already paid as the referral partner is never double counted.
      </div>

      {err && <div className="err">{err}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div><label className="note">Recipient kind</label>
            <select value={recipientKind} onChange={e => setRecipientKind(e.target.value)}>
              {RECIPIENT_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
          </div>
          <div><label className="note">Basis</label>
            <select value={basis} onChange={e => setBasis(e.target.value)}>
              {BASES.map(b => <option key={b} value={b}>{BASIS_LABEL[b]}</option>)}
            </select>
          </div>
          <div><label className="note">Percentage</label><input value={percentage} onChange={e => setPercentage(e.target.value)} type="number" placeholder="5" style={{ width: 90 }} /></div>
          <div><label className="note">Flat (cents)</label><input value={flatCents} onChange={e => setFlatCents(e.target.value)} type="number" placeholder="25000" style={{ width: 110 }} /></div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 10 }}>
          <div><label className="note">Recipient company id</label><input value={recipientCompanyId} onChange={e => setRecipientCompanyId(e.target.value)} placeholder="uuid" style={{ width: 240 }} /></div>
          <div><label className="note">Recipient user id</label><input value={recipientUserId} onChange={e => setRecipientUserId(e.target.value)} placeholder="user id" style={{ width: 200 }} /></div>
          <div><label className="note">Recipient referral partner id</label><input value={recipientReferralPartnerId} onChange={e => setRecipientReferralPartnerId(e.target.value)} placeholder="uuid" style={{ width: 240 }} /></div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 10 }}>
          <div><label className="note">Developer company id (scope)</label><input value={devId} onChange={e => setDevId(e.target.value)} placeholder="uuid" style={{ width: 240 }} /></div>
          <div><label className="note">Vendor company id (scope)</label><input value={venId} onChange={e => setVenId(e.target.value)} placeholder="uuid" style={{ width: 240 }} /></div>
          <div><label className="note">Program id (scope)</label><input value={programId} onChange={e => setProgramId(e.target.value)} placeholder="uuid" style={{ width: 240 }} /></div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 10 }}>
          <div style={{ flex: 1, minWidth: 240 }}><label className="note">Notes</label><input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Describe this split term" style={{ width: '100%' }} /></div>
          <button className="btn primary" disabled={busy} onClick={create}>Add split term</button>
        </div>
        <div className="note" style={{ marginTop: 8 }}>
          At least one scope id (developer / vendor / program) is required for a term to match a revenue row. Provide a percentage or a flat amount, not both.
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr>
            <th>Recipient</th><th>Basis</th><th>Developer</th><th>Vendor</th><th>Program</th>
            <th>% / Flat</th><th>Active</th><th></th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} style={{ opacity: r.active ? 1 : 0.55 }}>
                <td>{recipientCell(r)}{r.notes ? <div className="note">{r.notes}</div> : null}</td>
                <td><span className="badge b-neutral">{BASIS_LABEL[r.basis ?? 'fee'] ?? r.basis}</span></td>
                <td className="note">{r.developer_company_id ? r.developer_company_id.slice(0, 8) : '-'}</td>
                <td className="note">{r.vendor_company_id ? r.vendor_company_id.slice(0, 8) : '-'}</td>
                <td className="note">{r.program_id ? r.program_id.slice(0, 8) : '-'}</td>
                <td>
                  <input
                    defaultValue={r.percentage == null ? '' : String(r.percentage)}
                    type="number"
                    placeholder="%"
                    style={{ width: 70 }}
                    onBlur={e => {
                      const v = e.target.value;
                      patch(r.id, { percentage: v === '' ? null : Number(v) });
                    }}
                  />
                  {dollars(r.flat_cents) ? <span className="note"> {dollars(r.flat_cents)}</span> : (pct(r.percentage) ? null : <span className="note"> -</span>)}
                </td>
                <td>
                  <button className={'btn' + (r.active ? ' primary' : '')} onClick={() => patch(r.id, { active: !r.active })}>
                    {r.active ? 'Active' : 'Inactive'}
                  </button>
                </td>
                <td>
                  {r.active && <button className="btn" onClick={() => softDelete(r.id)}>Delete</button>}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8} className="note" style={{ padding: 14 }}>No split terms yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
