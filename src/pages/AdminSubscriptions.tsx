/**
 * Admin console for Subscription Tiers + Entitlements. Lets an admin:
 *   - list + edit the tier catalogue (price, limits, feature flags),
 *   - assign a tier to a company by company id (with optional limit overrides),
 *   - view every company's effective entitlement.
 *
 * Reads /subscriptions/tiers + /admin/subscriptions. Writes via
 * /admin/subscriptions/tiers + /admin/subscriptions/entitlement.
 */
import { useEffect, useState } from 'react';
import { useFeatures } from '../lib/features';
import { apiGet, apiSend } from '../lib/api';

type Tier = {
  id?: string;
  key: string;
  name: string;
  audience: 'developer' | 'vendor' | 'investor';
  price_cents: number;
  active_project_limit: number | null;
  bid_package_limit: number | null;
  vendor_invite_limit: number | null;
  investment_program_limit: number | null;
  investor_match_limit: number | null;
  seat_limit: number | null;
  ai_features: boolean;
  reporting_access: boolean;
  white_glove: boolean;
  sort: number;
};
type Entitlement = {
  company_id: string;
  company_name: string | null;
  company_kind: string | null;
  tier_key: string | null;
  tier_name: string | null;
  audience: string | null;
  price_cents: number | null;
  seat_limit: number | null;
  active_project_limit: number | null;
  bid_package_limit: number | null;
  ai_features: boolean | null;
  reporting_access: boolean | null;
  white_glove: boolean | null;
  updated_at: string | null;
};

const NUM_FIELDS: [keyof Tier, string][] = [
  ['active_project_limit', 'Projects'],
  ['bid_package_limit', 'Bid pkgs'],
  ['vendor_invite_limit', 'Vendor invites'],
  ['investment_program_limit', 'Inv programs'],
  ['investor_match_limit', 'Inv matches'],
  ['seat_limit', 'Seats'],
];

function lim(n: number | null): string {
  return n === null ? '∞' : String(n);
}
function money(cents: number | null): string {
  if (!cents) return 'Free';
  return `$${(cents / 100).toLocaleString()}/mo`;
}

export default function AdminSubscriptions() {
  const { isAdmin } = useFeatures();
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [ents, setEnts] = useState<Entitlement[]>([]);
  const [edit, setEdit] = useState<Tier | null>(null);
  const [assignCompany, setAssignCompany] = useState('');
  const [assignTier, setAssignTier] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadTiers() {
    try { const d = await apiGet<{ tiers: Tier[] }>('/subscriptions/tiers'); setTiers(d.tiers ?? []); }
    catch (e: any) { setErr(e.message ?? 'Could not load tiers.'); }
  }
  async function loadEnts() {
    try { const d = await apiGet<{ entitlements: Entitlement[] }>('/admin/subscriptions'); setEnts(d.entitlements ?? []); }
    catch (e: any) { setErr(e.message ?? 'Could not load entitlements.'); }
  }
  useEffect(() => { if (isAdmin) { void loadTiers(); void loadEnts(); } }, [isAdmin]);

  if (!isAdmin) return <div className="card">Admins only.</div>;

  function startEdit(t: Tier) {
    setEdit({ ...t });
    setOk(''); setErr('');
  }
  function newTier() {
    setEdit({
      key: '', name: '', audience: 'developer', price_cents: 0,
      active_project_limit: null, bid_package_limit: null, vendor_invite_limit: null,
      investment_program_limit: null, investor_match_limit: null, seat_limit: 2,
      ai_features: false, reporting_access: false, white_glove: false, sort: 0,
    });
    setOk(''); setErr('');
  }

  function setNum(field: keyof Tier, raw: string) {
    if (!edit) return;
    const v = raw.trim() === '' ? null : Number(raw);
    setEdit({ ...edit, [field]: v as any });
  }

  async function saveTier() {
    if (!edit) return;
    if (!edit.key.trim()) { setErr('Tier key is required.'); return; }
    setBusy(true); setErr(''); setOk('');
    try {
      await apiSend('POST', '/admin/subscriptions/tiers', edit);
      setOk(`Tier "${edit.key}" saved.`); setEdit(null); await loadTiers();
    } catch (e: any) { setErr(e.message ?? 'Could not save tier.'); }
    finally { setBusy(false); }
  }

  async function assign() {
    if (!assignCompany.trim() || !assignTier) { setErr('Company id and tier are required.'); return; }
    setBusy(true); setErr(''); setOk('');
    try {
      await apiSend('PATCH', '/admin/subscriptions/entitlement', {
        companyId: assignCompany.trim(),
        tierKey: assignTier,
      });
      setOk('Tier assigned.'); setAssignCompany(''); await loadEnts();
    } catch (e: any) { setErr(e.message ?? 'Could not assign tier.'); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div className="page-head"><div>
        <h1>Subscriptions</h1>
        <div className="sub">Manage the tier catalogue and assign plans to companies.</div>
      </div></div>

      {err && <div className="err">{err}</div>}
      {ok && <div className="ok">{ok}</div>}

      {/* ---- Assign a tier to a company ---- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <strong>Assign a tier to a company</strong>
        <div className="two" style={{ marginTop: 10 }}>
          <div className="field">
            <label>Company id</label>
            <input value={assignCompany} onChange={(e) => setAssignCompany(e.target.value)} placeholder="company UUID" />
          </div>
          <div className="field">
            <label>Tier</label>
            <select value={assignTier} onChange={(e) => setAssignTier(e.target.value)}>
              <option value="">Select a tier…</option>
              {tiers.map((t) => (
                <option key={t.key} value={t.key}>{t.name} ({t.audience})</option>
              ))}
            </select>
          </div>
        </div>
        <button className="btn primary" onClick={assign} disabled={busy} style={{ marginTop: 10 }}>Assign tier</button>
      </div>

      {/* ---- Tier catalogue ---- */}
      <div className="page-head"><div>
        <h1 style={{ fontSize: 18 }}>Tier catalogue</h1>
        <div className="sub">A NULL limit (shown ∞) means unlimited.</div>
      </div></div>

      <div style={{ marginBottom: 10 }}>
        <button className="btn" onClick={newTier}>+ New tier</button>
      </div>

      <div className="card" style={{ padding: 0, marginBottom: 16 }}>
        <table>
          <thead>
            <tr>
              <th>Tier</th><th>Audience</th><th>Price</th>
              <th>Proj</th><th>Pkgs</th><th>Invites</th><th>Programs</th><th>Matches</th><th>Seats</th>
              <th>Flags</th><th></th>
            </tr>
          </thead>
          <tbody>
            {tiers.length === 0 ? (
              <tr><td colSpan={11} className="note" style={{ padding: 14 }}>No tiers yet.</td></tr>
            ) : tiers.map((t) => (
              <tr key={t.key}>
                <td><strong>{t.name}</strong><div className="note">{t.key}</div></td>
                <td><span className="badge b-neutral">{t.audience}</span></td>
                <td>{money(t.price_cents)}</td>
                <td>{lim(t.active_project_limit)}</td>
                <td>{lim(t.bid_package_limit)}</td>
                <td>{lim(t.vendor_invite_limit)}</td>
                <td>{lim(t.investment_program_limit)}</td>
                <td>{lim(t.investor_match_limit)}</td>
                <td>{lim(t.seat_limit)}</td>
                <td>
                  {t.ai_features && <span className="badge b-green">AI</span>}{' '}
                  {t.reporting_access && <span className="badge b-green">Rpt</span>}{' '}
                  {t.white_glove && <span className="badge b-green">WG</span>}
                </td>
                <td><button className="btn" onClick={() => startEdit(t)}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---- Tier editor ---- */}
      {edit && (
        <div className="card" style={{ marginBottom: 16 }}>
          <strong>{tiers.some((t) => t.key === edit.key) ? 'Edit tier' : 'New tier'}</strong>
          <div className="two" style={{ marginTop: 10 }}>
            <div className="field">
              <label>Key</label>
              <input value={edit.key} onChange={(e) => setEdit({ ...edit, key: e.target.value })} placeholder="developer_pro" />
            </div>
            <div className="field">
              <label>Name</label>
              <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </div>
          </div>
          <div className="two">
            <div className="field">
              <label>Audience</label>
              <select value={edit.audience} onChange={(e) => setEdit({ ...edit, audience: e.target.value as Tier['audience'] })}>
                <option value="developer">developer</option>
                <option value="vendor">vendor</option>
                <option value="investor">investor</option>
              </select>
            </div>
            <div className="field">
              <label>Price (cents)</label>
              <input type="number" value={edit.price_cents} onChange={(e) => setEdit({ ...edit, price_cents: Number(e.target.value) || 0 })} />
            </div>
          </div>
          <div className="two">
            {NUM_FIELDS.map(([field, label]) => (
              <div className="field" key={field as string}>
                <label>{label} (blank = unlimited)</label>
                <input
                  type="number"
                  value={(edit[field] as number | null) === null ? '' : (edit[field] as number)}
                  onChange={(e) => setNum(field, e.target.value)}
                  placeholder="unlimited"
                />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
            <label><input type="checkbox" checked={edit.ai_features} onChange={(e) => setEdit({ ...edit, ai_features: e.target.checked })} /> AI features</label>
            <label><input type="checkbox" checked={edit.reporting_access} onChange={(e) => setEdit({ ...edit, reporting_access: e.target.checked })} /> Reporting access</label>
            <label><input type="checkbox" checked={edit.white_glove} onChange={(e) => setEdit({ ...edit, white_glove: e.target.checked })} /> White glove</label>
            <div className="field" style={{ maxWidth: 120 }}>
              <label>Sort</label>
              <input type="number" value={edit.sort} onChange={(e) => setEdit({ ...edit, sort: Number(e.target.value) || 0 })} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn primary" onClick={saveTier} disabled={busy}>Save tier</button>
            <button className="btn" onClick={() => setEdit(null)} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}

      {/* ---- All entitlements ---- */}
      <div className="page-head"><div>
        <h1 style={{ fontSize: 18 }}>Company entitlements</h1>
        <div className="sub">Every company with an assigned plan.</div>
      </div></div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr><th>Company</th><th>Kind</th><th>Tier</th><th>Price</th><th>Seats</th><th>Flags</th><th>Updated</th></tr>
          </thead>
          <tbody>
            {ents.length === 0 ? (
              <tr><td colSpan={7} className="note" style={{ padding: 14 }}>No entitlements assigned yet.</td></tr>
            ) : ents.map((e) => (
              <tr key={e.company_id}>
                <td><strong>{e.company_name ?? e.company_id}</strong></td>
                <td><span className="badge b-neutral">{e.company_kind ?? '-'}</span></td>
                <td>{e.tier_name ?? e.tier_key ?? '-'}</td>
                <td>{money(e.price_cents)}</td>
                <td>{lim(e.seat_limit)}</td>
                <td>
                  {e.ai_features && <span className="badge b-green">AI</span>}{' '}
                  {e.reporting_access && <span className="badge b-green">Rpt</span>}{' '}
                  {e.white_glove && <span className="badge b-green">WG</span>}
                </td>
                <td className="note">{e.updated_at ? new Date(e.updated_at).toLocaleDateString() : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
