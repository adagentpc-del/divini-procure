/**
 * Broker / capital-introducer onboarding. A user describes the relationship they
 * want to bring to the platform (type, license, investor network, rev-share
 * terms, compliance notes) and submits it for admin review. Submission posts to
 * /broker/onboard, which always sets status to pending_review. The page shows
 * the current review status returned by /broker/me.
 *
 * Compliance: no "invest now" language anywhere; this is a request to be
 * reviewed as an introducer / broker. The standard disclaimer is always shown.
 */
import { useEffect, useState } from 'react';
import { apiGet, apiSend } from '../lib/api';
import ComplianceDisclaimer from '../components/ComplianceDisclaimer';

type Broker = {
  id: string;
  broker_type?: string;
  license_status?: string;
  license_number?: string;
  investor_network_type?: string;
  rev_share_terms?: string;
  compliance_notes?: string;
  status?: string;
  admin_notes?: string;
};

const STATUS_BADGE: Record<string, string> = {
  pending_review: 'b-amber',
  approved: 'b-green',
  restricted: 'b-amber',
  rejected: 'b-red',
};

export default function BrokerOnboarding() {
  const [broker, setBroker] = useState<Broker | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const [brokerType, setBrokerType] = useState('capital_introducer');
  const [licenseStatus, setLicenseStatus] = useState('not_provided');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [investorNetworkType, setInvestorNetworkType] = useState('');
  const [revShareTerms, setRevShareTerms] = useState('');
  const [complianceNotes, setComplianceNotes] = useState('');

  function hydrate(b: Broker | null) {
    setBroker(b);
    if (b) {
      setBrokerType(b.broker_type ?? 'capital_introducer');
      setLicenseStatus(b.license_status ?? 'not_provided');
      setLicenseNumber(b.license_number ?? '');
      setInvestorNetworkType(b.investor_network_type ?? '');
      setRevShareTerms(b.rev_share_terms ?? '');
      setComplianceNotes(b.compliance_notes ?? '');
    }
  }

  useEffect(() => {
    apiGet<Broker | null>('/broker/me')
      .then(hydrate)
      .catch((e) => setErr(e.message ?? 'Could not load broker profile.'))
      .finally(() => setLoading(false));
  }, []);

  async function submit() {
    setBusy(true); setErr(''); setOk('');
    try {
      const r = await apiSend<{ broker: Broker }>('POST', '/broker/onboard', {
        brokerType,
        licenseStatus,
        licenseNumber: licenseNumber || undefined,
        investorNetworkType: investorNetworkType || undefined,
        revShareTerms: revShareTerms || undefined,
        complianceNotes: complianceNotes || undefined,
      });
      setBroker(r.broker);
      setOk('Submitted for review. An administrator will review your details.');
    } catch (e: any) {
      setErr(e.message ?? 'Could not submit.');
    } finally {
      setBusy(false);
    }
  }

  const status = broker?.status ?? 'pending_review';

  return (
    <>
      <div className="page-head"><div>
        <h1>Broker / capital introducer</h1>
        <div className="sub">Register as a capital introducer, broker, advisor, referral partner, or family office representative. All registrations are reviewed by an administrator before approval.</div>
      </div></div>

      {err && <div className="err">{err}</div>}
      {ok && <div className="ok">{ok}</div>}
      {loading && <div className="note">Loading…</div>}

      {broker && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="note" style={{ fontWeight: 700, marginBottom: 8 }}>Review status</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className={`badge ${STATUS_BADGE[status] ?? 'b-neutral'}`}>{status.replace(/_/g, ' ')}</span>
            {status === 'pending_review' && <span className="note">Your registration is pending review.</span>}
            {status === 'approved' && <span className="note">Your registration is approved.</span>}
            {status === 'restricted' && <span className="note">Your registration has restrictions. See notes below.</span>}
            {status === 'rejected' && <span className="note">Your registration was not approved.</span>}
          </div>
          {broker.admin_notes && <div className="note" style={{ marginTop: 10 }}>Reviewer notes: {broker.admin_notes}</div>}
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="note" style={{ fontWeight: 700, marginBottom: 10 }}>Registration details</div>
        <div className="two">
          <div className="field"><label>Type</label>
            <select value={brokerType} onChange={(e) => setBrokerType(e.target.value)}>
              <option value="capital_introducer">Capital introducer</option>
              <option value="broker">Broker</option>
              <option value="advisor">Advisor</option>
              <option value="referral_partner">Referral partner</option>
              <option value="family_office_rep">Family office representative</option>
            </select>
          </div>
          <div className="field"><label>License status</label>
            <select value={licenseStatus} onChange={(e) => setLicenseStatus(e.target.value)}>
              <option value="not_provided">Not provided</option>
              <option value="not_applicable">Not applicable</option>
              <option value="self_reported">Self-reported</option>
              <option value="pending_verification">Pending verification</option>
            </select>
          </div>
          <div className="field"><label>License number (optional)</label><input value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} /></div>
          <div className="field"><label>Investor network type</label><input value={investorNetworkType} onChange={(e) => setInvestorNetworkType(e.target.value)} placeholder="family offices, RIAs, HNWIs…" /></div>
        </div>
        <div className="field"><label>Revenue share terms</label><textarea rows={2} value={revShareTerms} onChange={(e) => setRevShareTerms(e.target.value)} placeholder="Describe the revenue share / referral terms you are proposing." /></div>
        <div className="field"><label>Compliance notes</label><textarea rows={2} value={complianceNotes} onChange={(e) => setComplianceNotes(e.target.value)} placeholder="Any relevant compliance, registration, or disclosure information." /></div>
      </div>

      <button className="btn primary" disabled={busy} onClick={submit}>
        {broker ? 'Resubmit for review' : 'Submit for review'}
      </button>

      <ComplianceDisclaimer />
    </>
  );
}
