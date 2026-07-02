/**
 * Admin Verification console. ADDITIVE; admin-only.
 * Two sections:
 *   1. Vendor Credentials: review each submitted license / insurance /
 *      compliance doc. Verify / reject / request more info. Verifying a
 *      credential recomputes the vendor's verify_status server-side.
 *   2. Investor Accreditation: verify or reject an investor's accreditation
 *      and pass / fail KYC. Verifying accreditation approves the investor
 *      profile server-side.
 *
 * Every action here is an explicit admin action recorded to verification_audit.
 */
import { useEffect, useState } from 'react';
import { useFeatures } from '../lib/features';
import { apiGet, apiSend } from '../lib/api';

type Credential = {
  id: string;
  company_id?: string;
  company_name?: string;
  type?: string;
  doc_url?: string;
  registry?: string;
  result?: string;
  confidence?: number;
  status?: string;
  scanned_at?: string;
  reviewed_by?: string;
  reviewed_at?: string;
  review_notes?: string;
  vendor_verify_status?: string;
};

type Investor = {
  id: string;
  full_name?: string;
  entity_name?: string;
  email?: string;
  investor_type?: string;
  accreditation_status?: string;
  admin_review_status?: string;
  qualification_id?: string;
  accredited?: string;
  qualified_purchaser?: string;
  proof_of_funds?: boolean;
  kyc_completed?: boolean;
  jurisdiction?: string;
  accreditation_verification_status?: string;
  kyc_status?: string;
  aml_status?: string;
};

const CRED_BADGE: Record<string, string> = {
  pending: 'b-neutral',
  needs_info: 'b-amber',
  verified: 'b-green',
  rejected: 'b-red',
  approved: 'b-green',
  flagged: 'b-red',
};
const ACCR_BADGE: Record<string, string> = {
  not_verified: 'b-neutral',
  verified: 'b-green',
  rejected: 'b-red',
};
const KYC_BADGE: Record<string, string> = {
  not_started: 'b-neutral',
  passed: 'b-green',
  failed: 'b-red',
};
const REVIEW_BADGE: Record<string, string> = {
  pending_review: 'b-amber',
  not_required: 'b-neutral',
  approved: 'b-green',
  rejected: 'b-red',
};

function badge(map: Record<string, string>, v?: string) {
  const k = (v ?? '').toLowerCase();
  return map[k] ?? 'b-neutral';
}

export default function AdminVerification() {
  const { isAdmin } = useFeatures();
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  // --- vendor credentials ---
  const [credStatus, setCredStatus] = useState('');
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [credNotes, setCredNotes] = useState<Record<string, string>>({});

  // --- investors ---
  const [invStatus, setInvStatus] = useState('');
  const [investors, setInvestors] = useState<Investor[]>([]);
  const [invNotes, setInvNotes] = useState<Record<string, string>>({});

  async function loadCredentials() {
    setErr('');
    try {
      const qs = credStatus ? `?status=${encodeURIComponent(credStatus)}` : '';
      const r = await apiGet<{ credentials: Credential[] }>(`/admin/verification/vendor-credentials${qs}`);
      setCredentials(r.credentials ?? []);
    } catch (e: any) {
      setErr(e.message ?? 'Could not load credentials.');
    }
  }

  async function loadInvestors() {
    setErr('');
    try {
      const qs = invStatus ? `?status=${encodeURIComponent(invStatus)}` : '';
      const r = await apiGet<{ investors: Investor[] }>(`/admin/verification/investors${qs}`);
      setInvestors(r.investors ?? []);
    } catch (e: any) {
      setErr(e.message ?? 'Could not load investors.');
    }
  }

  useEffect(() => {
    if (isAdmin) {
      void loadCredentials();
      void loadInvestors();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  if (!isAdmin) return <div className="card">Admins only.</div>;

  async function reviewCredential(id: string, decision: 'verified' | 'rejected' | 'needs_info') {
    setBusy(true);
    setErr('');
    setOk('');
    try {
      await apiSend('PATCH', `/admin/verification/vendor-credentials/${id}`, {
        decision,
        notes: credNotes[id] || undefined,
      });
      setOk(`Credential ${decision.replace(/_/g, ' ')}.`);
      await loadCredentials();
    } catch (e: any) {
      setErr(e.message ?? 'Could not review credential.');
    } finally {
      setBusy(false);
    }
  }

  async function reviewInvestor(
    id: string,
    body: { accreditationDecision?: 'verified' | 'rejected'; kycDecision?: 'passed' | 'failed' },
  ) {
    setBusy(true);
    setErr('');
    setOk('');
    try {
      await apiSend('PATCH', `/admin/verification/investors/${id}`, {
        ...body,
        notes: invNotes[id] || undefined,
      });
      setOk('Investor verification updated.');
      await loadInvestors();
    } catch (e: any) {
      setErr(e.message ?? 'Could not update investor.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Verification</h1>
          <div className="sub">Admin review of vendor credentials and investor accreditation. Every action is audited.</div>
        </div>
      </div>

      {err && <div className="err">{err}</div>}
      {ok && <div className="ok">{ok}</div>}

      {/* ---- vendor credentials ---- */}
      <div className="sectitle">Vendor credentials</div>
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="two">
          <div className="field">
            <label>Filter by status</label>
            <select value={credStatus} onChange={(e) => setCredStatus(e.target.value)}>
              <option value="">All</option>
              <option value="pending">pending</option>
              <option value="needs_info">needs info</option>
              <option value="verified">verified</option>
              <option value="rejected">rejected</option>
            </select>
          </div>
          <div className="field" style={{ alignSelf: 'end' }}>
            <button className="btn" onClick={loadCredentials}>Apply filter</button>
          </div>
        </div>
      </div>
      <div className="card" style={{ padding: 0, marginBottom: 18 }}>
        <table>
          <thead>
            <tr>
              <th>Vendor</th>
              <th>Type</th>
              <th>Registry</th>
              <th>Doc</th>
              <th>Status</th>
              <th>Vendor status</th>
              <th>Notes / action</th>
            </tr>
          </thead>
          <tbody>
            {credentials.length === 0 && (
              <tr><td colSpan={7} className="note" style={{ padding: 12 }}>No credentials.</td></tr>
            )}
            {credentials.map((c) => (
              <tr key={c.id}>
                <td>{c.company_name ?? c.company_id ?? '-'}</td>
                <td>{(c.type ?? '').replace(/_/g, ' ')}</td>
                <td>{c.registry ?? '-'}</td>
                <td>{c.doc_url ? <a href={c.doc_url} target="_blank" rel="noreferrer">view</a> : '-'}</td>
                <td><span className={`badge ${badge(CRED_BADGE, c.status)}`}>{(c.status ?? '').replace(/_/g, ' ')}</span></td>
                <td><span className={`badge ${badge(CRED_BADGE, c.vendor_verify_status)}`}>{c.vendor_verify_status ?? '-'}</span></td>
                <td style={{ minWidth: 280 }}>
                  <input
                    className="field"
                    style={{ width: '100%', marginBottom: 6 }}
                    placeholder="Review notes (optional)"
                    value={credNotes[c.id] ?? ''}
                    onChange={(e) => setCredNotes((m) => ({ ...m, [c.id]: e.target.value }))}
                  />
                  <div style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn" disabled={busy} onClick={() => reviewCredential(c.id, 'verified')}>Verify</button>{' '}
                    <button className="btn" disabled={busy} onClick={() => reviewCredential(c.id, 'needs_info')}>Needs info</button>{' '}
                    <button className="btn" disabled={busy} onClick={() => reviewCredential(c.id, 'rejected')}>Reject</button>
                  </div>
                  {c.reviewed_by && (
                    <div className="note" style={{ marginTop: 4 }}>
                      Reviewed by {c.reviewed_by}
                      {c.reviewed_at ? ` on ${new Date(c.reviewed_at).toLocaleString()}` : ''}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---- investor accreditation ---- */}
      <div className="sectitle">Investor accreditation</div>
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="two">
          <div className="field">
            <label>Filter by accreditation status</label>
            <select value={invStatus} onChange={(e) => setInvStatus(e.target.value)}>
              <option value="">All</option>
              <option value="not_verified">not verified</option>
              <option value="verified">verified</option>
              <option value="rejected">rejected</option>
            </select>
          </div>
          <div className="field" style={{ alignSelf: 'end' }}>
            <button className="btn" onClick={loadInvestors}>Apply filter</button>
          </div>
        </div>
      </div>
      <div className="card" style={{ padding: 0, marginBottom: 18 }}>
        <table>
          <thead>
            <tr>
              <th>Investor</th>
              <th>Self-reported</th>
              <th>Accreditation</th>
              <th>KYC</th>
              <th>Profile review</th>
              <th>Notes / action</th>
            </tr>
          </thead>
          <tbody>
            {investors.length === 0 && (
              <tr><td colSpan={6} className="note" style={{ padding: 12 }}>No investors.</td></tr>
            )}
            {investors.map((i) => (
              <tr key={i.id}>
                <td>
                  {i.entity_name || i.full_name || i.email || i.id}
                  {i.email && (i.entity_name || i.full_name) ? <div className="note">{i.email}</div> : null}
                </td>
                <td>
                  <div className="note">accredited: {i.accredited ?? i.accreditation_status ?? '-'}</div>
                  <div className="note">QP: {i.qualified_purchaser ?? '-'}</div>
                  <div className="note">proof of funds: {i.proof_of_funds ? 'yes' : 'no'}</div>
                </td>
                <td><span className={`badge ${badge(ACCR_BADGE, i.accreditation_verification_status)}`}>{(i.accreditation_verification_status ?? '').replace(/_/g, ' ')}</span></td>
                <td><span className={`badge ${badge(KYC_BADGE, i.kyc_status)}`}>{(i.kyc_status ?? '').replace(/_/g, ' ')}</span></td>
                <td><span className={`badge ${badge(REVIEW_BADGE, i.admin_review_status)}`}>{(i.admin_review_status ?? '').replace(/_/g, ' ')}</span></td>
                <td style={{ minWidth: 280 }}>
                  <input
                    className="field"
                    style={{ width: '100%', marginBottom: 6 }}
                    placeholder="Review notes (optional)"
                    value={invNotes[i.id] ?? ''}
                    onChange={(e) => setInvNotes((m) => ({ ...m, [i.id]: e.target.value }))}
                  />
                  <div style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn" disabled={busy} onClick={() => reviewInvestor(i.id, { accreditationDecision: 'verified' })}>Verify accred.</button>{' '}
                    <button className="btn" disabled={busy} onClick={() => reviewInvestor(i.id, { accreditationDecision: 'rejected' })}>Reject accred.</button>
                  </div>
                  <div style={{ whiteSpace: 'nowrap', marginTop: 6 }}>
                    <button className="btn" disabled={busy} onClick={() => reviewInvestor(i.id, { kycDecision: 'passed' })}>KYC pass</button>{' '}
                    <button className="btn" disabled={busy} onClick={() => reviewInvestor(i.id, { kycDecision: 'failed' })}>KYC fail</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
