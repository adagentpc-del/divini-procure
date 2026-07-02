/**
 * Admin Investment Governance console. ADDITIVE; sits alongside AdminInvestment.
 * Three sections:
 *   1. Per-program compliance: load a program's compliance row (legal /
 *      compliance review status, sponsor disclosure, offering exemption,
 *      restricted-materials flag) and save it via PUT.
 *   2. Broker review queue: approve / restrict / reject broker registrations.
 *   3. Investor permission levels: grant an explicit, optionally program-scoped
 *      permission level to an investor; list and revoke existing grants.
 *
 * Compliance: every advancing action here is an explicit admin action. No
 * "invest now" semantics; this surface governs access and review state only.
 */
import { useEffect, useState } from 'react';
import { useFeatures } from '../lib/features';
import { apiGet, apiSend } from '../lib/api';

type Compliance = {
  id?: string;
  program_id?: string;
  legal_review_status?: string;
  compliance_review_status?: string;
  sponsor_disclosure?: string;
  offering_exemption_type?: string;
  restricted_materials?: boolean;
  notes?: string;
  reviewed_at?: string;
} | null;

type Broker = {
  id: string;
  user_id?: string;
  broker_type?: string;
  license_status?: string;
  investor_network_type?: string;
  rev_share_terms?: string;
  status?: string;
  admin_notes?: string;
};

type Permission = {
  id: string;
  investor_id?: string;
  program_id?: string | null;
  level?: string;
  notes?: string;
};

const REVIEW_STATES = ['not_started', 'in_review', 'cleared', 'flagged'];
const LEVELS = ['investor_basic', 'investor_budget', 'investor_approval', 'owner_full', 'asset_manager'];
const STATUS_BADGE: Record<string, string> = {
  pending_review: 'b-amber', approved: 'b-green', restricted: 'b-amber', rejected: 'b-red',
};

export default function AdminInvestmentCompliance() {
  const { isAdmin } = useFeatures();
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  // --- per-program compliance ---
  const [programId, setProgramId] = useState('');
  const [comp, setComp] = useState<Compliance>(null);
  const [legal, setLegal] = useState('not_started');
  const [compliance, setCompliance] = useState('not_started');
  const [sponsorDisclosure, setSponsorDisclosure] = useState('');
  const [offeringExemptionType, setOfferingExemptionType] = useState('');
  const [restrictedMaterials, setRestrictedMaterials] = useState(false);
  const [compNotes, setCompNotes] = useState('');

  // --- broker queue ---
  const [brokers, setBrokers] = useState<Broker[]>([]);

  // --- investor permissions ---
  const [investors, setInvestors] = useState<any[]>([]);
  const [permInvestorId, setPermInvestorId] = useState('');
  const [permProgramId, setPermProgramId] = useState('');
  const [permLevel, setPermLevel] = useState('investor_basic');
  const [permNotes, setPermNotes] = useState('');
  const [permissions, setPermissions] = useState<Permission[]>([]);

  async function loadBrokers() {
    try { const r = await apiGet<{ brokers: Broker[] }>('/admin/brokers'); setBrokers(r.brokers ?? []); }
    catch (e: any) { setErr(e.message ?? 'Could not load brokers.'); }
  }
  async function loadInvestors() {
    try { const r = await apiGet<{ profiles: any[] }>('/admin/investor/profiles'); setInvestors(r.profiles ?? []); }
    catch (e: any) { setErr(e.message ?? 'Could not load investors.'); }
  }
  useEffect(() => { if (isAdmin) { void loadBrokers(); void loadInvestors(); } }, [isAdmin]);

  if (!isAdmin) return <div className="card">Admins only.</div>;

  async function loadCompliance() {
    if (!programId.trim()) { setErr('Enter a program id.'); return; }
    setErr(''); setOk('');
    try {
      const r = await apiGet<{ compliance: Compliance }>(`/investment/programs/${programId.trim()}/compliance`);
      const c = r.compliance;
      setComp(c);
      setLegal(c?.legal_review_status ?? 'not_started');
      setCompliance(c?.compliance_review_status ?? 'not_started');
      setSponsorDisclosure(c?.sponsor_disclosure ?? '');
      setOfferingExemptionType(c?.offering_exemption_type ?? '');
      setRestrictedMaterials(c?.restricted_materials ?? false);
      setCompNotes(c?.notes ?? '');
    } catch (e: any) { setErr(e.message ?? 'Could not load compliance.'); }
  }

  async function saveCompliance() {
    if (!programId.trim()) { setErr('Enter a program id.'); return; }
    setBusy(true); setErr(''); setOk('');
    try {
      const r = await apiSend<{ compliance: Compliance }>('PUT', `/admin/investment/programs/${programId.trim()}/compliance`, {
        legalReviewStatus: legal,
        complianceReviewStatus: compliance,
        sponsorDisclosure: sponsorDisclosure || undefined,
        offeringExemptionType: offeringExemptionType || undefined,
        restrictedMaterials,
        notes: compNotes || undefined,
      });
      setComp(r.compliance);
      setOk('Compliance saved.');
    } catch (e: any) { setErr(e.message ?? 'Could not save compliance.'); }
    finally { setBusy(false); }
  }

  async function reviewBroker(id: string, status: 'approved' | 'restricted' | 'rejected') {
    setBusy(true); setErr(''); setOk('');
    try {
      await apiSend('PATCH', `/admin/brokers/${id}`, { status });
      setOk(`Broker ${status}.`); await loadBrokers();
    } catch (e: any) { setErr(e.message ?? 'Could not review broker.'); }
    finally { setBusy(false); }
  }

  async function loadPermissions(investorId: string) {
    setPermInvestorId(investorId);
    if (!investorId) { setPermissions([]); return; }
    try {
      const r = await apiGet<{ permissions: Permission[] }>(`/admin/investor-permissions?investorId=${investorId}`);
      setPermissions(r.permissions ?? []);
    } catch (e: any) { setErr(e.message ?? 'Could not load permissions.'); }
  }

  async function grantPermission() {
    if (!permInvestorId) { setErr('Select an investor.'); return; }
    setBusy(true); setErr(''); setOk('');
    try {
      await apiSend('POST', '/admin/investor-permissions', {
        investorId: permInvestorId,
        programId: permProgramId.trim() || undefined,
        level: permLevel,
        notes: permNotes || undefined,
      });
      setOk('Permission granted.'); setPermNotes('');
      await loadPermissions(permInvestorId);
    } catch (e: any) { setErr(e.message ?? 'Could not grant permission.'); }
    finally { setBusy(false); }
  }

  async function revokePermission(id: string) {
    setBusy(true); setErr(''); setOk('');
    try {
      await apiSend('DELETE', `/admin/investor-permissions/${id}`);
      setOk('Permission revoked.'); await loadPermissions(permInvestorId);
    } catch (e: any) { setErr(e.message ?? 'Could not revoke permission.'); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div className="page-head"><div>
        <h1>Investment Governance</h1>
        <div className="sub">Per-program compliance review, broker registration review, and investor permission levels.</div>
      </div></div>

      {err && <div className="err">{err}</div>}
      {ok && <div className="ok">{ok}</div>}

      {/* ---- per-program compliance ---- */}
      <div className="sectitle">Program compliance</div>
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="two">
          <div className="field"><label>Program id</label>
            <input value={programId} onChange={(e) => setProgramId(e.target.value)} placeholder="investment_programs.id" />
          </div>
          <div className="field" style={{ alignSelf: 'end' }}>
            <button className="btn" onClick={loadCompliance}>Load compliance</button>
          </div>
        </div>
        <div className="two" style={{ marginTop: 6 }}>
          <div className="field"><label>Legal review status</label>
            <select value={legal} onChange={(e) => setLegal(e.target.value)}>
              {REVIEW_STATES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div className="field"><label>Compliance review status</label>
            <select value={compliance} onChange={(e) => setCompliance(e.target.value)}>
              {REVIEW_STATES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div className="field"><label>Offering exemption type</label>
            <input value={offeringExemptionType} onChange={(e) => setOfferingExemptionType(e.target.value)} placeholder="Reg D 506(b), Reg D 506(c), Reg A…" />
          </div>
          <div className="field" style={{ alignSelf: 'end' }}>
            <label className="note"><input type="checkbox" checked={restrictedMaterials} onChange={(e) => setRestrictedMaterials(e.target.checked)} /> Restricted materials</label>
          </div>
        </div>
        <div className="field"><label>Sponsor disclosure</label><textarea rows={2} value={sponsorDisclosure} onChange={(e) => setSponsorDisclosure(e.target.value)} /></div>
        <div className="field"><label>Notes</label><textarea rows={2} value={compNotes} onChange={(e) => setCompNotes(e.target.value)} /></div>
        <button className="btn primary" disabled={busy} onClick={saveCompliance}>Save compliance</button>
        {comp?.reviewed_at && <div className="note" style={{ marginTop: 8 }}>Last reviewed: {new Date(comp.reviewed_at).toLocaleString()}</div>}
      </div>

      {/* ---- broker queue ---- */}
      <div className="sectitle">Broker review queue</div>
      <div className="card" style={{ padding: 0, marginBottom: 18 }}>
        <table>
          <thead><tr><th>Type</th><th>License</th><th>Network</th><th>Rev share</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {brokers.length === 0 && <tr><td colSpan={6} className="note" style={{ padding: 12 }}>No broker registrations.</td></tr>}
            {brokers.map((b) => (
              <tr key={b.id}>
                <td>{(b.broker_type ?? '').replace(/_/g, ' ')}</td>
                <td>{(b.license_status ?? '').replace(/_/g, ' ')}</td>
                <td>{b.investor_network_type ?? '-'}</td>
                <td>{b.rev_share_terms ?? '-'}</td>
                <td><span className={`badge ${STATUS_BADGE[b.status ?? ''] ?? 'b-neutral'}`}>{(b.status ?? '').replace(/_/g, ' ')}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn" disabled={busy} onClick={() => reviewBroker(b.id, 'approved')}>Approve</button>{' '}
                  <button className="btn" disabled={busy} onClick={() => reviewBroker(b.id, 'restricted')}>Restrict</button>{' '}
                  <button className="btn" disabled={busy} onClick={() => reviewBroker(b.id, 'rejected')}>Reject</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---- investor permissions ---- */}
      <div className="sectitle">Investor permission levels</div>
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="two">
          <div className="field"><label>Investor</label>
            <select value={permInvestorId} onChange={(e) => loadPermissions(e.target.value)}>
              <option value="">Select an investor…</option>
              {investors.map((i) => (
                <option key={i.id} value={i.id}>{i.entity_name || i.full_name || i.email || i.id}</option>
              ))}
            </select>
          </div>
          <div className="field"><label>Level</label>
            <select value={permLevel} onChange={(e) => setPermLevel(e.target.value)}>
              {LEVELS.map((l) => <option key={l} value={l}>{l.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div className="field"><label>Program id (optional, scopes the grant)</label>
            <input value={permProgramId} onChange={(e) => setPermProgramId(e.target.value)} placeholder="leave blank for all programs" />
          </div>
          <div className="field"><label>Notes</label><input value={permNotes} onChange={(e) => setPermNotes(e.target.value)} /></div>
        </div>
        <button className="btn primary" disabled={busy} onClick={grantPermission}>Grant permission</button>

        {permInvestorId && (
          <div className="card" style={{ padding: 0, marginTop: 12 }}>
            <table>
              <thead><tr><th>Level</th><th>Program</th><th>Notes</th><th></th></tr></thead>
              <tbody>
                {permissions.length === 0 && <tr><td colSpan={4} className="note" style={{ padding: 12 }}>No permissions granted.</td></tr>}
                {permissions.map((p) => (
                  <tr key={p.id}>
                    <td>{(p.level ?? '').replace(/_/g, ' ')}</td>
                    <td>{p.program_id ?? 'all programs'}</td>
                    <td>{p.notes ?? '-'}</td>
                    <td><button className="btn" disabled={busy} onClick={() => revokePermission(p.id)}>Revoke</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
