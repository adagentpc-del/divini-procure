/**
 * Investor dashboard. Shows profile + qualification/access status, matched
 * opportunities (request introduction, sign NDA), document upload, and a browse
 * list of open opportunities (public teasers). If the user has no investor
 * profile yet, route them to onboarding. Disclaimer always present.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiSend } from '../lib/api';
import ComplianceDisclaimer from '../components/ComplianceDisclaimer';
import { OpportunityMatchCard, type OpportunityMatch } from '../components/MatchCard';

type Me = { profile?: any; preferences?: any; qualification?: any; accessLevel?: string } | null;
type Teaser = Record<string, any> & { id: string; name?: string };

const dollars = (c?: number) =>
  c == null ? '-' : (Number(c) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export default function InvestorDashboard() {
  const nav = useNavigate();
  const [me, setMe] = useState<Me>(null);
  const [loaded, setLoaded] = useState(false);
  const [matches, setMatches] = useState<OpportunityMatch[]>([]);
  const [open, setOpen] = useState<Teaser[]>([]);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  // document upload
  const [docType, setDocType] = useState('accreditation');
  const [docUrl, setDocUrl] = useState('');

  async function loadMe() {
    try {
      const r = await apiGet<Me>('/investor/me');
      setMe(r);
    } catch { setMe(null); }
    finally { setLoaded(true); }
  }
  async function loadMatches() {
    try { const r = await apiGet<{ matches: OpportunityMatch[] }>('/investor/matches'); setMatches(r.matches ?? []); }
    catch (e: any) { setErr(e.message ?? 'Could not load matches.'); }
  }
  async function loadOpen() {
    try { const r = await apiGet<{ programs: Teaser[] }>('/investment/open'); setOpen(r.programs ?? []); }
    catch { /* open list optional */ }
  }

  useEffect(() => { void loadMe(); }, []);
  useEffect(() => { if (me) { void loadMatches(); void loadOpen(); } }, [me]);

  if (!loaded) return <div className="note">Loading…</div>;

  if (!me) {
    return (
      <>
        <div className="page-head"><div>
          <h1>Investor</h1>
          <div className="sub">You have not created an investor profile yet.</div>
        </div></div>
        <div className="card">
          <div className="note" style={{ marginBottom: 12 }}>Complete onboarding to be matched with suitable opportunities.</div>
          <button className="btn primary" onClick={() => nav('/investor-onboarding')}>Start investor onboarding</button>
        </div>
        <ComplianceDisclaimer />
      </>
    );
  }

  async function requestIntro(m: OpportunityMatch) {
    if (!m.program?.id) return;
    setBusy(true); setErr(''); setOk('');
    try {
      await apiSend('POST', '/investor/introductions', { programId: m.program.id });
      setOk('Introduction requested.'); await loadMatches();
    } catch (e: any) { setErr(e.message ?? 'Could not request introduction.'); }
    finally { setBusy(false); }
  }
  async function signNda(m: OpportunityMatch) {
    if (!m.program?.id) return;
    const signerName = prompt('Type your full legal name to sign the NDA:');
    if (!signerName) return;
    setBusy(true); setErr(''); setOk('');
    try {
      await apiSend('POST', `/investor/nda/${m.program.id}/sign`, { signerName });
      setOk('NDA signed.'); await loadMatches();
    } catch (e: any) { setErr(e.message ?? 'Could not sign NDA.'); }
    finally { setBusy(false); }
  }
  async function uploadDoc() {
    if (!docUrl) { setErr('Provide a document URL.'); return; }
    setBusy(true); setErr(''); setOk('');
    try {
      await apiSend('POST', '/investor/documents', { docType, url: docUrl });
      setDocUrl(''); setOk('Document uploaded.');
    } catch (e: any) { setErr(e.message ?? 'Could not upload document.'); }
    finally { setBusy(false); }
  }

  const accessLevel = me.accessLevel ?? me.qualification?.access_level ?? 'pending';
  const qStatus = me.qualification?.status;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Investor dashboard</h1>
          <div className="sub">Your qualification, matched opportunities, and access status.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span className="badge b-neutral">Access: {String(accessLevel).replace(/_/g, ' ')}</span>
          {qStatus && <span className="badge b-amber">{String(qStatus).replace(/_/g, ' ')}</span>}
        </div>
      </div>

      {err && <div className="err">{err}</div>}
      {ok && <div className="ok">{ok}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="note" style={{ fontWeight: 700, marginBottom: 8 }}>Profile</div>
        <div className="two">
          <div><span className="note">Name</span><div>{me.profile?.entity_name || me.profile?.full_name || '-'}</div></div>
          <div><span className="note">Investor type</span><div>{(me.profile?.investor_type ?? '-').replace?.(/_/g, ' ') ?? '-'}</div></div>
          <div><span className="note">Accreditation</span><div>{(me.profile?.accreditation_status ?? '-').replace?.(/_/g, ' ') ?? '-'}</div></div>
          <div><span className="note">Allocation</span><div>{dollars(me.preferences?.total_allocation_cents)}</div></div>
        </div>
        <div style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => nav('/investor-onboarding')}>Update profile</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="note" style={{ fontWeight: 700, marginBottom: 8 }}>Verification documents</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ marginBottom: 0 }}><label>Type</label>
            <select value={docType} onChange={(e) => setDocType(e.target.value)}>
              <option value="accreditation">Accreditation</option>
              <option value="proof_of_funds">Proof of funds</option>
              <option value="kyc">KYC</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 220 }}><label>URL</label><input value={docUrl} onChange={(e) => setDocUrl(e.target.value)} placeholder="https://…" /></div>
          <button className="btn primary" disabled={busy} onClick={uploadDoc}>Upload</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 6 }}>
        <div className="note" style={{ fontWeight: 700 }}>Matched opportunities</div>
      </div>
      {matches.length === 0 ? <div className="note" style={{ marginBottom: 16 }}>No matched opportunities yet.</div> :
        matches.map((m, i) => (
          <OpportunityMatchCard
            key={m.program?.id ?? i}
            match={m}
            busy={busy}
            onRequestAccess={requestIntro}
            onRequestIntroduction={requestIntro}
            onSignNda={signNda}
          />
        ))}

      <div className="card" style={{ marginBottom: 6, marginTop: 16 }}>
        <div className="note" style={{ fontWeight: 700 }}>Browse open opportunities</div>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Opportunity</th><th>Asset class</th><th>Market</th><th>Min</th></tr></thead>
          <tbody>
            {open.length === 0 ? (
              <tr><td colSpan={4} className="note" style={{ padding: 12 }}>No open opportunities right now.</td></tr>
            ) : open.map((t) => (
              <tr key={t.id}>
                <td><strong>{t.name}</strong></td>
                <td className="note">{t.asset_class ?? '-'}</td>
                <td className="note">{t.location ?? '-'}</td>
                <td>{dollars(t.min_investment_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ComplianceDisclaimer />
    </>
  );
}
