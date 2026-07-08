/**
 * Admin Fee Matrix.
 *
 * The configurable platform fee rules: rule_type, scope, optional developer /
 * vendor / program scoping, percentage or flat cents, payer_type, and active
 * status. Admins can create a rule, edit its percentage / flat / payer_type /
 * notes inline, toggle active, or soft-delete it. Grandfathered 2% developer
 * vendor pairs ALWAYS override anything here and are resolved before the matrix.
 */
import { useEffect, useState } from 'react';
import { useFeatures } from '../lib/features';
import { apiGet, apiSend } from '../lib/api';

type FeeRule = {
  id: string;
  rule_type: string;
  scope: string;
  developer_company_id: string | null;
  vendor_company_id: string | null;
  program_id: string | null;
  percentage: number | string | null;
  flat_cents: number | string | null;
  payer_type: string;
  billing_cycle: string | null;
  active: boolean;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

const RULE_TYPES = [
  'standard_platform',
  'preferred_vendor_placement',
  'white_glove',
  'referral_partner',
  'capital_introduction',
  'grandfathered_2pct',
] as const;

const SCOPES = ['global', 'developer', 'vendor', 'pair', 'program'] as const;

const PAYER_TYPES = [
  'developer_pays',
  'vendor_pays',
  'split_fee',
  'deducted_from_vendor_payment',
  'added_to_developer_invoice',
  'admin_configured',
] as const;

const RULE_LABEL: Record<string, string> = {
  standard_platform: 'Standard platform',
  preferred_vendor_placement: 'Preferred vendor placement',
  white_glove: 'White glove',
  referral_partner: 'Referral partner',
  capital_introduction: 'Capital introduction',
  grandfathered_2pct: 'Grandfathered 2%',
};

const PAYER_LABEL: Record<string, string> = {
  developer_pays: 'Developer pays',
  vendor_pays: 'Vendor pays',
  split_fee: 'Split fee',
  deducted_from_vendor_payment: 'Deducted from vendor payment',
  added_to_developer_invoice: 'Added to developer invoice',
  admin_configured: 'Admin configured',
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

export default function AdminFeeMatrix() {
  const { isAdmin } = useFeatures();
  const [rows, setRows] = useState<FeeRule[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // create form
  const [ruleType, setRuleType] = useState<string>('standard_platform');
  const [scope, setScope] = useState<string>('global');
  const [devId, setDevId] = useState('');
  const [venId, setVenId] = useState('');
  const [programId, setProgramId] = useState('');
  const [percentage, setPercentage] = useState('');
  const [flatCents, setFlatCents] = useState('');
  const [payerType, setPayerType] = useState<string>('admin_configured');
  const [billingCycle, setBillingCycle] = useState('');
  const [notes, setNotes] = useState('');

  async function load() {
    try {
      const d = await apiGet<{ rules: FeeRule[] }>('/admin/fee-rules');
      setRows(d.rules ?? []);
    } catch (e: any) { setErr(e.message ?? 'Could not load fee rules.'); }
  }
  useEffect(() => { if (isAdmin) load(); }, [isAdmin]);

  if (!isAdmin) return <div className="card">Admins only.</div>;

  async function create() {
    setBusy(true); setErr('');
    try {
      await apiSend('POST', '/admin/fee-rules', {
        rule_type: ruleType,
        scope,
        developer_company_id: devId || undefined,
        vendor_company_id: venId || undefined,
        program_id: programId || undefined,
        percentage: percentage === '' ? undefined : Number(percentage),
        flat_cents: flatCents === '' ? undefined : Number(flatCents),
        payer_type: payerType,
        billing_cycle: billingCycle || undefined,
        notes: notes || undefined,
      });
      setDevId(''); setVenId(''); setProgramId('');
      setPercentage(''); setFlatCents(''); setBillingCycle(''); setNotes('');
      await load();
    } catch (e: any) { setErr(e.message ?? 'Could not create fee rule.'); }
    finally { setBusy(false); }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(true); setErr('');
    try { await apiSend('PATCH', `/admin/fee-rules/${id}`, body); await load(); }
    catch (e: any) { setErr(e.message ?? 'Could not update fee rule.'); }
    finally { setBusy(false); }
  }

  async function softDelete(id: string) {
    setBusy(true); setErr('');
    try { await apiSend('DELETE', `/admin/fee-rules/${id}`); await load(); }
    catch (e: any) { setErr(e.message ?? 'Could not delete fee rule.'); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div className="page-head"><div>
        <h1>Fee Matrix</h1>
        <div className="sub">Configurable platform fee rules with a payer_type and scope. The most specific active rule applies (pair &gt; program &gt; developer &gt; vendor &gt; global).</div>
      </div></div>

      <div className="note badge b-amber" style={{ marginBottom: 14, display: 'inline-block' }}>
        Grandfathered 2% developer-vendor pairs always override the matrix. They are resolved before any rule here and cannot be superseded by it.
      </div>

      {err && <div className="err">{err}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div><label className="note">Rule type</label>
            <select value={ruleType} onChange={e => setRuleType(e.target.value)}>
              {RULE_TYPES.map(t => <option key={t} value={t}>{RULE_LABEL[t]}</option>)}
            </select>
          </div>
          <div><label className="note">Scope</label>
            <select value={scope} onChange={e => setScope(e.target.value)}>
              {SCOPES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div><label className="note">Payer type</label>
            <select value={payerType} onChange={e => setPayerType(e.target.value)}>
              {PAYER_TYPES.map(p => <option key={p} value={p}>{PAYER_LABEL[p]}</option>)}
            </select>
          </div>
          <div><label className="note">Percentage</label><input value={percentage} onChange={e => setPercentage(e.target.value)} type="number" placeholder="10" style={{ width: 90 }} /></div>
          <div><label className="note">Flat (cents)</label><input value={flatCents} onChange={e => setFlatCents(e.target.value)} type="number" placeholder="50000" style={{ width: 110 }} /></div>
          <div><label className="note">Billing cycle</label><input value={billingCycle} onChange={e => setBillingCycle(e.target.value)} placeholder="monthly" style={{ width: 110 }} /></div>
        </div>
        {(scope === 'developer' || scope === 'vendor' || scope === 'pair' || scope === 'program') && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 10 }}>
            {(scope === 'developer' || scope === 'pair') && (
              <div><label className="note">Developer company id</label><input value={devId} onChange={e => setDevId(e.target.value)} placeholder="uuid" style={{ width: 280 }} /></div>
            )}
            {(scope === 'vendor' || scope === 'pair') && (
              <div><label className="note">Vendor company id</label><input value={venId} onChange={e => setVenId(e.target.value)} placeholder="uuid" style={{ width: 280 }} /></div>
            )}
            {scope === 'program' && (
              <div><label className="note">Program id</label><input value={programId} onChange={e => setProgramId(e.target.value)} placeholder="uuid" style={{ width: 280 }} /></div>
            )}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 10 }}>
          <div style={{ flex: 1, minWidth: 240 }}><label className="note">Notes</label><input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Describe this rule" style={{ width: '100%' }} /></div>
          <button className="btn primary" disabled={busy} onClick={create}>Add fee rule</button>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr>
            <th>Rule type</th><th>Scope</th><th>Developer</th><th>Vendor</th>
            <th>% / Flat</th><th>Payer type</th><th>Active</th><th></th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} style={{ opacity: r.active ? 1 : 0.55 }}>
                <td><strong>{RULE_LABEL[r.rule_type] ?? r.rule_type}</strong>{r.notes ? <div className="note">{r.notes}</div> : null}</td>
                <td><span className="badge b-neutral">{r.scope}</span></td>
                <td className="note">{r.developer_company_id ? r.developer_company_id.slice(0, 8) : '-'}</td>
                <td className="note">{r.vendor_company_id ? r.vendor_company_id.slice(0, 8) : '-'}</td>
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
                  {dollars(r.flat_cents) ? <span className="note"> {dollars(r.flat_cents)}{r.billing_cycle ? `/${r.billing_cycle}` : ''}</span> : (pct(r.percentage) ? null : <span className="note"> -</span>)}
                </td>
                <td>
                  <select value={r.payer_type} onChange={e => patch(r.id, { payer_type: e.target.value })}>
                    {PAYER_TYPES.map(p => <option key={p} value={p}>{PAYER_LABEL[p]}</option>)}
                  </select>
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
            {!rows.length && <tr><td colSpan={8} className="note" style={{ padding: 14 }}>No fee rules yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
