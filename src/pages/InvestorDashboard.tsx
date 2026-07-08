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
import { getMyCredits, getFoundingStatus, getMyReferral, attributeReferral, setInvestorPrivacy, type CreditState } from '../lib/db';

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
  const [credits, setCredits] = useState<CreditState | null>(null);
  const [founder, setFounder] = useState(false);
  const [referral, setReferral] = useState<{ code: string; count: number; creditsEarned: number } | null>(null);
  const [quiet, setQuiet] = useState(false);
  const [digestCount, setDigestCount] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

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
    try {
      const r = await apiGet<{ matches: OpportunityMatch[]; quiet?: boolean; digestCount?: number }>('/investor/matches');
      setMatches(r.matches ?? []);
      setDigestCount(r.quiet ? (r.digestCount ?? 0) : null);
    }
    catch (e: any) { setErr(e.message ?? 'Could not load matches.'); }
  }
  async function loadOpen() {
    try { const r = await apiGet<{ programs: Teaser[] }>('/investment/open'); setOpen(r.programs ?? []); }
    catch { /* open list optional */ }
  }
  async function loadCredits() {
    // Peer-referral attribution: if this user arrived via someone's /ref link,
    // attribute it once (rewards the referrer), then clear it.
    try {
      const ref = localStorage.getItem('procure_peer_ref');
      if (ref) { await attributeReferral(ref); localStorage.removeItem('procure_peer_ref'); }
    } catch { /* ignore */ }
    try { const r = await getMyCredits('investor'); setCredits(r.credits); } catch { /* optional */ }
    try { const f = await getFoundingStatus(); setFounder(!!f.investorFounder); } catch { /* optional */ }
    try { const rr = await getMyReferral(); setReferral(rr); } catch { /* optional */ }
  }
  async function toggleQuiet(next: boolean) {
    setBusy(true); setErr(''); setOk('');
    try {
      await setInvestorPrivacy({ quiet_mode: next });
      setQuiet(next);
      setOk(next ? 'Quiet mode on. You are private and will get matches as a digest.' : 'Quiet mode off. You can browse deals again.');
      await loadMatches();
    } catch (e: any) { setErr(e?.message ?? 'Could not update privacy.'); }
    finally { setBusy(false); }
  }

  useEffect(() => { void loadMe(); }, []);
  useEffect(() => {
    if (me) {
      setQuiet(!!me.profile?.quiet_mode);
      void loadMatches(); void loadOpen(); void loadCredits();
    }
  }, [me]);

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
      setOk('Introduction requested. When the sponsor accepts, contacts are exchanged and you deal directly — Divini is only the introducer.');
      await loadMatches(); await loadCredits();
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

      {credits && (
        <div className="card" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div className="note" style={{ fontWeight: 700 }}>
              Intro credits: <span style={{ color: 'var(--emerald)' }}>{credits.metered ? credits.balance : `${credits.balance}`}</span>
              {!credits.metered && <span className="note"> (unlimited during launch)</span>}
            </div>
            <div className="note" style={{ marginTop: 4 }}>
              Each introduction spends one credit. Earn more by completing your profile, referring a peer, or responding quickly — and {credits.monthlyGrant} refresh each month.
            </div>
          </div>
          {founder && <span className="badge b-green" title="Founding Member — permanent status and perks for early members.">★ Founding Member</span>}
        </div>
      )}

      {referral && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="note" style={{ fontWeight: 700, marginBottom: 6 }}>Refer &amp; earn</div>
          <div className="note" style={{ marginBottom: 8 }}>
            Invite a sponsor or a fellow investor. When they join, you earn intro credits.
            {referral.count > 0 && <> You've referred <strong>{referral.count}</strong> so far.</>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input readOnly value={`${window.location.origin}/ref/${referral.code}`} style={{ flex: 1, minWidth: 240 }} onFocus={(e) => e.currentTarget.select()} />
            <button className="btn" onClick={async () => {
              try { await navigator.clipboard.writeText(`${window.location.origin}/ref/${referral.code}`); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
            }}>{copied ? 'Copied' : 'Copy link'}</button>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div className="note" style={{ fontWeight: 700 }}>Quiet mode {quiet ? '(on)' : '(off)'}</div>
          <div className="note" style={{ marginTop: 4 }}>
            For family offices and private investors: stay invisible and receive matches as a periodic digest instead of browsing. You reach out only when a deal fits.
          </div>
        </div>
        <button className="btn" disabled={busy} onClick={() => toggleQuiet(!quiet)}>
          {quiet ? 'Turn off quiet mode' : 'Turn on quiet mode'}
        </button>
      </div>

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

      {quiet && digestCount !== null ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="note" style={{ fontWeight: 700, marginBottom: 6 }}>Your mandate digest</div>
          <div style={{ fontSize: 34, fontWeight: 800, color: 'var(--emerald)', lineHeight: 1.1 }}>{digestCount}</div>
          <div className="note" style={{ marginTop: 4 }}>
            {digestCount === 1 ? 'deal currently fits your mandate.' : 'deals currently fit your mandate.'} You stay private; turn off quiet mode any time to review and request an introduction.
          </div>
        </div>
      ) : (
        <>
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
        </>
      )}

      <ComplianceDisclaimer />
    </>
  );
}
