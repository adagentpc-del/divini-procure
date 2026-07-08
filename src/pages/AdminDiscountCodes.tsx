import { useEffect, useState } from 'react';
import { useFeatures } from '../lib/features';
import { apiGet, apiSend } from '../lib/api';

type Discount = {
  id: string; code: string; kind: string; value: number;
  max_uses?: number; uses: number; status: string;
  applies_to?: string; expires_at?: string; created_at: string;
};

const date = (s?: string) => (s ? new Date(s).toLocaleDateString() : '-');

export default function AdminDiscountCodes() {
  const { isAdmin } = useFeatures();
  const [rows, setRows] = useState<Discount[]>([]);
  const [code, setCode] = useState('');
  const [kind, setKind] = useState('percent');
  const [value, setValue] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [appliesTo, setAppliesTo] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const d = await apiGet<{ discounts: Discount[] }>('/admin/discount-codes');
      setRows(d.discounts ?? []);
    } catch (e: any) { setErr(e.message ?? 'Could not load discount codes.'); }
  }
  useEffect(() => { if (isAdmin) load(); }, [isAdmin]);

  if (!isAdmin) return <div className="card">Admins only.</div>;

  async function create() {
    setBusy(true); setErr('');
    try {
      await apiSend('POST', '/admin/discount-codes', {
        code: code || undefined,
        kind,
        value: value === '' ? 0 : Number(value),
        maxUses: maxUses === '' ? undefined : Number(maxUses),
        appliesTo: appliesTo || undefined,
      });
      setCode(''); setValue(''); setMaxUses(''); setAppliesTo('');
      await load();
    } catch (e: any) { setErr(e.message ?? 'Could not create code.'); }
    finally { setBusy(false); }
  }

  async function toggle(d: Discount) {
    const next = d.status === 'active' ? 'disabled' : 'active';
    try { await apiSend('PATCH', `/admin/discount-codes/${d.id}`, { status: next }); await load(); }
    catch (e: any) { setErr(e.message ?? 'Could not update.'); }
  }

  return (
    <>
      <div className="page-head"><div>
        <h1>Discount Codes</h1>
        <div className="sub">Create promo codes. Leave the code blank to auto-generate one.</div>
      </div></div>

      {err && <div className="err">{err}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div><label className="note">Code (optional)</label><input value={code} onChange={e => setCode(e.target.value)} placeholder="AUTO" /></div>
          <div><label className="note">Kind</label>
            <select value={kind} onChange={e => setKind(e.target.value)}>
              <option value="percent">Percent (%)</option>
              <option value="flat">Flat ($)</option>
            </select>
          </div>
          <div><label className="note">Value</label><input value={value} onChange={e => setValue(e.target.value)} type="number" placeholder="10" style={{ width: 90 }} /></div>
          <div><label className="note">Max uses</label><input value={maxUses} onChange={e => setMaxUses(e.target.value)} type="number" placeholder="∞" style={{ width: 90 }} /></div>
          <div><label className="note">Applies to</label><input value={appliesTo} onChange={e => setAppliesTo(e.target.value)} placeholder="subscription" /></div>
          <button className="btn primary" disabled={busy} onClick={create}>Create code</button>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Code</th><th>Kind</th><th>Value</th><th>Uses</th><th>Applies to</th><th>Expires</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map(d => (
              <tr key={d.id}>
                <td><code>{d.code}</code></td>
                <td>{d.kind}</td>
                <td>{d.kind === 'percent' ? `${d.value}%` : `$${d.value}`}</td>
                <td>{d.uses}{d.max_uses != null ? ` / ${d.max_uses}` : ''}</td>
                <td>{d.applies_to ?? '-'}</td>
                <td>{date(d.expires_at)}</td>
                <td><button className={'btn' + (d.status === 'active' ? ' primary' : '')} onClick={() => toggle(d)}>{d.status === 'active' ? 'Active' : 'Disabled'}</button></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="note">No discount codes yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
